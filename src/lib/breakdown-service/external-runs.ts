import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { formatSourceAge, isStaleSourceNode } from '@/lib/graph/source-freshness';
import type { BreakdownNode } from '@/types/node';
import type { BreakdownEdge } from '@/types/edge';
import type { BreakdownActor } from './actor';
import { requireScope } from './actor';
import { BreakdownServiceError } from './errors';
import { getGraphForActor } from './graphs';
import {
  blockExternalStepSchema,
  createExternalRunSchema,
  finalizeExternalRunSchema,
  submitExternalStepResultSchema,
  uuidSchema,
} from './schemas';
import { auditHeadlessOperation, hashPayload } from './safety';
import { getWorkflowManifestForActor } from './workflows';

type ExternalRunStatus = 'active' | 'completed' | 'blocked' | 'cancelled';
type ExternalRunStepStatus =
  | 'pending'
  | 'ready'
  | 'in_progress'
  | 'submitted'
  | 'blocked'
  | 'skipped';

interface ExternalRunRecord {
  id: string;
  graph_id: string;
  user_id: string;
  status: ExternalRunStatus;
  actor_source: string;
  actor_token_id: string | null;
  client_name: string | null;
  provider_name: string | null;
  manifest_version: string;
  metadata: Record<string, unknown>;
  started_at: string;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ExternalRunStepRecord {
  id: string;
  external_run_id: string;
  graph_id: string;
  node_id: string;
  sequence_index: number;
  status: ExternalRunStepStatus;
  context_version: string;
  output: string | null;
  structured_summary: Record<string, unknown> | null;
  citations: unknown[];
  blocked_reason: string | null;
  required_data: unknown[];
  submitted_by_source: string | null;
  submitted_by_token_id: string | null;
  client_name: string | null;
  provider_name: string | null;
  started_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ExternalStepWorkPacket {
  stepId: string;
  nodeId: string;
  status: ExternalRunStepStatus;
  contextVersion: string;
  node: {
    id: string;
    name: string;
    nodeType: string;
    prompt: string;
    priorOutput: string | null;
    metadata: Record<string, unknown>;
    runStatus: BreakdownNode['run_status'];
    lastRunAt: string | null;
  };
  upstream: Record<string, Array<Record<string, unknown>>>;
  sourceFreshnessWarnings: Array<{
    nodeId: string;
    name: string;
    warning: string;
  }>;
  expectedOutput: unknown;
  acceptanceCriteria: unknown;
  hostToolInstructions: string;
  submission: {
    submitRoute: string;
    blockRoute: string;
    requiredContextVersion: string;
  };
}

function serviceClient() {
  return createServerClient();
}

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BreakdownServiceError(
      'validation_error',
      parsed.error.message,
      400,
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

function contextVersionForNode(input: {
  runId: string;
  manifestVersion: string;
  node: BreakdownNode;
  inboundEdges: BreakdownEdge[];
  upstreamNodes: BreakdownNode[];
}) {
  return hashPayload({
    runId: input.runId,
    manifestVersion: input.manifestVersion,
    nodeId: input.node.id,
    nodeUpdatedAt: input.node.updated_at,
    inboundEdges: input.inboundEdges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.source_node_id,
      edgeType: edge.edge_type,
      updatedAt: edge.updated_at,
    })),
    upstreamNodes: input.upstreamNodes.map((node) => ({
      id: node.id,
      output: node.output,
      runStatus: node.run_status,
      lastRunAt: node.last_run_at,
      updatedAt: node.updated_at,
    })),
  });
}

function hostToolInstructionsForNode(node: BreakdownNode) {
  const metadata = node.metadata as {
    hostToolInstructions?: string;
    requiresCurrentData?: boolean;
    suggestedHostTools?: string[];
  };
  if (metadata.hostToolInstructions) return metadata.hostToolInstructions;

  const text = `${node.name}\n${node.prompt}`.toLowerCase();
  const looksFinancial =
    text.includes('stock') ||
    text.includes('ticker') ||
    text.includes('market data') ||
    text.includes('filing') ||
    text.includes('valuation') ||
    text.includes('financial statement');

  if (metadata.requiresCurrentData || looksFinancial) {
    return [
      'Use current data tools/connectors available in this host console when the step requires fresh facts.',
      'For stock or market-data work, use available tools such as FMP, filings/search, or market-data connectors.',
      'If current data is unavailable, mark the step blocked or submit an explicit data-gap result instead of relying on model memory.',
    ].join(' ');
  }

  return 'Perform this step in the current agent console. Use available host tools when the prompt requires facts beyond the provided context, and submit citations for any external facts used.';
}

async function getRunForActor(actor: BreakdownActor, runId: string): Promise<ExternalRunRecord> {
  const parsedRunId = parseOrThrow(uuidSchema, runId);
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from('external_runs')
    .select('*')
    .eq('id', parsedRunId)
    .eq('user_id', actor.userId)
    .single();

  if (error || !data) {
    throw new BreakdownServiceError('not_found', error?.message ?? 'External run not found', 404);
  }

  return data as ExternalRunRecord;
}

async function getRunSteps(runId: string): Promise<ExternalRunStepRecord[]> {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from('external_run_steps')
    .select('*')
    .eq('external_run_id', runId)
    .order('sequence_index', { ascending: true });

  if (error) {
    throw new BreakdownServiceError('database_error', error.message, 400);
  }

  return (data ?? []) as ExternalRunStepRecord[];
}

async function advanceReadySteps(run: ExternalRunRecord) {
  const graph = await getGraphForActor(
    {
      userId: run.user_id,
      source: 'integration-token',
      scopes: ['graphs:read'],
    },
    run.graph_id,
  );
  const steps = await getRunSteps(run.id);
  const stepByNodeId = new Map(steps.map((step) => [step.node_id, step]));
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const inboundByNodeId = new Map<string, BreakdownEdge[]>();
  for (const node of graph.nodes) inboundByNodeId.set(node.id, []);
  for (const edge of graph.edges) inboundByNodeId.get(edge.target_node_id)?.push(edge);

  const readyStepIds: string[] = [];
  for (const step of steps) {
    if (step.status !== 'pending') continue;
    const inboundEdges = inboundByNodeId.get(step.node_id) ?? [];
    const ready = inboundEdges.every((edge) => {
      const sourceStep = stepByNodeId.get(edge.source_node_id);
      const sourceNode = nodeById.get(edge.source_node_id);
      return (
        sourceStep?.status === 'submitted' ||
        (sourceNode?.run_status === 'success' && Boolean(sourceNode.output))
      );
    });
    if (ready) readyStepIds.push(step.id);
  }

  if (readyStepIds.length > 0) {
    const supabase = serviceClient();
    const { error } = await supabase
      .from('external_run_steps')
      .update({ status: 'ready', updated_at: new Date().toISOString() })
      .in('id', readyStepIds);
    if (error) {
      throw new BreakdownServiceError('database_error', error.message, 400);
    }
  }
}

async function buildExternalStepWorkPacket(input: {
  actor: BreakdownActor;
  run: ExternalRunRecord;
  step: ExternalRunStepRecord;
  markInProgress?: boolean;
}): Promise<ExternalStepWorkPacket> {
  const { actor, run, step, markInProgress = true } = input;
  if (!['ready', 'in_progress', 'submitted', 'blocked'].includes(step.status)) {
    throw new BreakdownServiceError(
      'external_run_state',
      'Step is not ready yet because upstream dependencies are incomplete',
      409,
    );
  }

  const graph = await getGraphForActor(
    { userId: actor.userId, source: actor.source, scopes: ['graphs:read'] },
    run.graph_id,
  );
  const node = graph.nodes.find((candidate) => candidate.id === step.node_id);
  if (!node) {
    throw new BreakdownServiceError('not_found', 'Step node not found', 404);
  }

  const inboundEdges = graph.edges.filter((edge) => edge.target_node_id === node.id);
  const sourceNodes = inboundEdges
    .map((edge) => graph.nodes.find((candidate) => candidate.id === edge.source_node_id))
    .filter((candidate): candidate is BreakdownNode => Boolean(candidate));
  const sourceById = new Map(sourceNodes.map((sourceNode) => [sourceNode.id, sourceNode]));
  const upstreamByEdgeType: Record<string, Array<Record<string, unknown>>> = {};

  for (const edge of inboundEdges) {
    const sourceNode = sourceById.get(edge.source_node_id);
    const group = upstreamByEdgeType[edge.edge_type] ?? [];
    group.push({
      edgeId: edge.id,
      sourceNodeId: edge.source_node_id,
      sourceNodeName: sourceNode?.name ?? 'Unknown node',
      output: sourceNode?.output ?? null,
      runStatus: sourceNode?.run_status ?? 'unknown',
      lastRunAt: sourceNode?.last_run_at ?? null,
      stale: sourceNode ? isStaleSourceNode(sourceNode) : false,
      freshnessWarning:
        sourceNode && isStaleSourceNode(sourceNode)
          ? `${sourceNode.name} is ${formatSourceAge(sourceNode.last_run_at)}. Refresh or cite current data before relying on it.`
          : null,
      condition: edge.condition,
      transform: edge.transform,
    });
    upstreamByEdgeType[edge.edge_type] = group;
  }

  let claimedStatus = step.status;
  if (markInProgress && step.status === 'ready') {
    const supabase = serviceClient();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('external_run_steps')
      .update({ status: 'in_progress', started_at: now, updated_at: now })
      .eq('id', step.id);
    if (error) {
      throw new BreakdownServiceError('database_error', error.message, 400);
    }
    claimedStatus = 'in_progress';
  }

  return {
    stepId: step.id,
    nodeId: step.node_id,
    status: claimedStatus,
    contextVersion: step.context_version,
    node: {
      id: node.id,
      name: node.name,
      nodeType: node.node_type,
      prompt: node.prompt,
      priorOutput: node.output,
      metadata: node.metadata,
      runStatus: node.run_status,
      lastRunAt: node.last_run_at,
    },
    upstream: upstreamByEdgeType,
    sourceFreshnessWarnings: sourceNodes
      .filter((sourceNode) => isStaleSourceNode(sourceNode))
      .map((sourceNode) => ({
        nodeId: sourceNode.id,
        name: sourceNode.name,
        warning: `${sourceNode.name} is ${formatSourceAge(sourceNode.last_run_at)}.`,
      })),
    expectedOutput:
      (node.metadata as { expectedOutput?: unknown; acceptanceCriteria?: unknown })
        .expectedOutput ?? null,
    acceptanceCriteria:
      (node.metadata as { expectedOutput?: unknown; acceptanceCriteria?: unknown })
        .acceptanceCriteria ?? null,
    hostToolInstructions: hostToolInstructionsForNode(node),
    submission: {
      submitRoute: `/api/headless/external-runs/${run.id}/steps/${step.id}/result`,
      blockRoute: `/api/headless/external-runs/${run.id}/steps/${step.id}/block`,
      requiredContextVersion: step.context_version,
    },
  };
}

export async function createExternalRunForActor(
  actor: BreakdownActor,
  graphId: string,
  input: z.input<typeof createExternalRunSchema>,
) {
  requireScope(actor, 'runs:external_execute');
  const parsed = parseOrThrow(createExternalRunSchema, input);
  const manifest = await getWorkflowManifestForActor(actor, graphId, 'external_evaluator');
  const graph = await getGraphForActor(actor, graphId);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const inboundByNodeId = new Map<string, BreakdownEdge[]>();
  for (const node of graph.nodes) inboundByNodeId.set(node.id, []);
  for (const edge of graph.edges) inboundByNodeId.get(edge.target_node_id)?.push(edge);

  const supabase = serviceClient();
  const { data: runData, error: runError } = await supabase
    .from('external_runs')
    .insert({
      graph_id: graph.id,
      user_id: actor.userId,
      status: graph.nodes.length === 0 ? 'completed' : 'active',
      actor_source: actor.source,
      actor_token_id: actor.tokenId ?? null,
      client_name: parsed.clientName ?? null,
      provider_name: parsed.providerName ?? null,
      manifest_version: manifest.version,
      metadata: parsed.metadata ?? {},
      finalized_at: graph.nodes.length === 0 ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (runError || !runData) {
    throw new BreakdownServiceError(
      'database_error',
      runError?.message ?? 'Failed to create external run',
      400,
    );
  }

  const run = runData as ExternalRunRecord;
  const stepRows = manifest.execution.topologicalOrder.map((nodeId, sequenceIndex) => {
    const node = nodeById.get(nodeId)!;
    const inboundEdges = inboundByNodeId.get(nodeId) ?? [];
    const upstreamNodes = inboundEdges
      .map((edge) => nodeById.get(edge.source_node_id))
      .filter((node): node is BreakdownNode => Boolean(node));
    return {
      external_run_id: run.id,
      graph_id: graph.id,
      node_id: nodeId,
      sequence_index: sequenceIndex,
      status: manifest.execution.readyNodeIds.includes(nodeId) ? 'ready' : 'pending',
      context_version: contextVersionForNode({
        runId: run.id,
        manifestVersion: manifest.version,
        node,
        inboundEdges,
        upstreamNodes,
      }),
    };
  });

  if (stepRows.length > 0) {
    const { error: stepsError } = await supabase.from('external_run_steps').insert(stepRows);
    if (stepsError) {
      throw new BreakdownServiceError('database_error', stepsError.message, 400);
    }
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'external_run.create',
    targetType: 'external_run',
    targetId: run.id,
    graphId: graph.id,
    requestSummary: { nodeCount: stepRows.length },
  });

  return {
    runId: run.id,
    graphId: graph.id,
    status: run.status,
    manifest,
  };
}

export async function getExternalRunForActor(actor: BreakdownActor, runId: string) {
  requireScope(actor, 'runs:external_execute');
  const run = await getRunForActor(actor, runId);
  const steps = await getRunSteps(run.id);

  return {
    run,
    steps,
  };
}

export async function getNextExternalStepForActor(actor: BreakdownActor, runId: string) {
  requireScope(actor, 'runs:external_execute');
  const run = await getRunForActor(actor, runId);
  if (run.status !== 'active') {
    return { runId: run.id, status: run.status, step: null };
  }

  await advanceReadySteps(run);
  const steps = await getRunSteps(run.id);
  const step = steps.find((candidate) => candidate.status === 'ready');
  const workPacket = step ? await buildExternalStepWorkPacket({ actor, run, step }) : null;
  return {
    runId: run.id,
    status: run.status,
    step: workPacket,
  };
}

export async function getExternalStepContextForActor(
  actor: BreakdownActor,
  runId: string,
  stepId: string,
) {
  requireScope(actor, 'runs:external_execute');
  const run = await getRunForActor(actor, runId);
  const parsedStepId = parseOrThrow(uuidSchema, stepId);
  const supabase = serviceClient();
  const { data: stepData, error: stepError } = await supabase
    .from('external_run_steps')
    .select('*')
    .eq('id', parsedStepId)
    .eq('external_run_id', run.id)
    .single();

  if (stepError || !stepData) {
    throw new BreakdownServiceError(
      'not_found',
      stepError?.message ?? 'External run step not found',
      404,
    );
  }
  const step = stepData as ExternalRunStepRecord;
  const workPacket = await buildExternalStepWorkPacket({ actor, run, step });

  return {
    runId: run.id,
    ...workPacket,
  };
}

async function assertStepCanReceiveResult(run: ExternalRunRecord, stepId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from('external_run_steps')
    .select('*')
    .eq('id', stepId)
    .eq('external_run_id', run.id)
    .single();
  if (error || !data) {
    throw new BreakdownServiceError(
      'not_found',
      error?.message ?? 'External run step not found',
      404,
    );
  }
  const step = data as ExternalRunStepRecord;
  if (!['ready', 'in_progress'].includes(step.status)) {
    throw new BreakdownServiceError(
      'external_run_state',
      `Step cannot receive a result while it is ${step.status}`,
      409,
    );
  }
  return step;
}

export async function submitExternalStepResultForActor(
  actor: BreakdownActor,
  runId: string,
  stepId: string,
  input: z.input<typeof submitExternalStepResultSchema>,
) {
  requireScope(actor, 'runs:write_results');
  const parsed = parseOrThrow(submitExternalStepResultSchema, input);
  const run = await getRunForActor(actor, runId);
  if (run.status !== 'active') {
    throw new BreakdownServiceError('external_run_state', 'External run is not active', 409);
  }

  const step = await assertStepCanReceiveResult(run, parseOrThrow(uuidSchema, stepId));
  if (step.context_version !== parsed.contextVersion) {
    throw new BreakdownServiceError(
      'stale_context',
      'Step context is stale. Fetch the step context again before submitting a result.',
      409,
    );
  }

  const supabase = serviceClient();
  const { data: nodeData, error: nodeError } = await supabase
    .from('nodes')
    .select('*')
    .eq('id', step.node_id)
    .single();
  if (nodeError || !nodeData) {
    throw new BreakdownServiceError('not_found', nodeError?.message ?? 'Node not found', 404);
  }
  const node = nodeData as BreakdownNode;
  const previousOutput = node.output;
  const lastRunAt = new Date().toISOString();

  const metadata = {
    ...node.metadata,
    externalEvaluator: {
      runId: run.id,
      stepId: step.id,
      clientName: parsed.clientName ?? run.client_name,
      providerName: parsed.providerName ?? run.provider_name,
      submittedAt: lastRunAt,
      citations: parsed.citations,
      structuredSummary: parsed.structuredSummary ?? null,
    },
  };

  const { error: stepUpdateError } = await supabase
    .from('external_run_steps')
    .update({
      status: 'submitted',
      output: parsed.output,
      structured_summary: parsed.structuredSummary ?? null,
      citations: parsed.citations,
      submitted_by_source: actor.source,
      submitted_by_token_id: actor.tokenId ?? null,
      client_name: parsed.clientName ?? run.client_name,
      provider_name: parsed.providerName ?? run.provider_name,
      submitted_at: lastRunAt,
      updated_at: lastRunAt,
    })
    .eq('id', step.id);
  if (stepUpdateError) {
    throw new BreakdownServiceError('database_error', stepUpdateError.message, 400);
  }

  const { error: nodeUpdateError } = await supabase
    .from('nodes')
    .update({
      output: parsed.output,
      metadata,
      run_status: 'success',
      run_error: null,
      last_run_at: lastRunAt,
      updated_at: lastRunAt,
    })
    .eq('id', node.id);
  if (nodeUpdateError) {
    throw new BreakdownServiceError('database_error', nodeUpdateError.message, 400);
  }

  await supabase.from('evaluations').insert({
    node_id: node.id,
    trigger_type: 'external_evaluator',
    trigger_source: actor.source,
    previous_conclusion: previousOutput,
    new_conclusion: parsed.output,
    previous_confidence: null,
    new_confidence: null,
    diff_summary:
      typeof parsed.structuredSummary?.summary === 'string'
        ? parsed.structuredSummary.summary
        : null,
    skill_doc_id: null,
    llm_provider: parsed.providerName ?? run.provider_name,
    llm_model: null,
    prompt_tokens: null,
    completion_tokens: null,
    status: 'applied',
  });

  await advanceReadySteps(run);
  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'external_step.submit_result',
    targetType: 'external_run_step',
    targetId: step.id,
    graphId: run.graph_id,
    requestSummary: { outputBytes: Buffer.byteLength(parsed.output, 'utf8') },
  });

  return {
    runId: run.id,
    stepId: step.id,
    nodeId: node.id,
    status: 'submitted',
    lastRunAt,
  };
}

export async function blockExternalStepForActor(
  actor: BreakdownActor,
  runId: string,
  stepId: string,
  input: z.input<typeof blockExternalStepSchema>,
) {
  requireScope(actor, 'runs:write_results');
  const parsed = parseOrThrow(blockExternalStepSchema, input);
  const run = await getRunForActor(actor, runId);
  if (run.status !== 'active') {
    throw new BreakdownServiceError('external_run_state', 'External run is not active', 409);
  }

  const step = await assertStepCanReceiveResult(run, parseOrThrow(uuidSchema, stepId));
  if (step.context_version !== parsed.contextVersion) {
    throw new BreakdownServiceError('stale_context', 'Step context is stale', 409);
  }

  const now = new Date().toISOString();
  const supabase = serviceClient();
  const { error } = await supabase
    .from('external_run_steps')
    .update({
      status: 'blocked',
      blocked_reason: parsed.reason,
      required_data: parsed.requiredData,
      submitted_by_source: actor.source,
      submitted_by_token_id: actor.tokenId ?? null,
      client_name: parsed.clientName ?? run.client_name,
      provider_name: parsed.providerName ?? run.provider_name,
      submitted_at: now,
      updated_at: now,
    })
    .eq('id', step.id);
  if (error) {
    throw new BreakdownServiceError('database_error', error.message, 400);
  }

  await supabase
    .from('nodes')
    .update({
      run_status: 'skipped',
      run_error: parsed.reason,
      updated_at: now,
    })
    .eq('id', step.node_id);

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'external_step.block',
    targetType: 'external_run_step',
    targetId: step.id,
    graphId: run.graph_id,
    requestSummary: { reason: parsed.reason, requiredDataCount: parsed.requiredData.length },
  });

  return { runId: run.id, stepId: step.id, status: 'blocked' };
}

export async function finalizeExternalRunForActor(
  actor: BreakdownActor,
  runId: string,
  input: z.input<typeof finalizeExternalRunSchema>,
) {
  requireScope(actor, 'runs:external_execute');
  const parsed = parseOrThrow(finalizeExternalRunSchema, input);
  const run = await getRunForActor(actor, runId);
  const steps = await getRunSteps(run.id);
  const incomplete = steps.filter((step) =>
    ['pending', 'ready', 'in_progress'].includes(step.status),
  );
  if (incomplete.length > 0 && !parsed.allowIncomplete) {
    throw new BreakdownServiceError(
      'external_run_state',
      'External run still has incomplete steps',
      409,
      { stepIds: incomplete.map((step) => step.id) },
    );
  }

  const blocked = steps.filter((step) => step.status === 'blocked');
  const status: ExternalRunStatus =
    blocked.length > 0 || incomplete.length > 0 ? 'blocked' : 'completed';
  const now = new Date().toISOString();
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from('external_runs')
    .update({ status, finalized_at: now, updated_at: now })
    .eq('id', run.id)
    .eq('user_id', actor.userId)
    .select()
    .single();

  if (error || !data) {
    throw new BreakdownServiceError(
      'database_error',
      error?.message ?? 'Failed to finalize external run',
      400,
    );
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'external_run.finalize',
    targetType: 'external_run',
    targetId: run.id,
    graphId: run.graph_id,
    requestSummary: { status, incomplete: incomplete.length, blocked: blocked.length },
  });

  return {
    runId: run.id,
    status,
    finalizedAt: now,
    metrics: {
      total: steps.length,
      submitted: steps.filter((step) => step.status === 'submitted').length,
      blocked: blocked.length,
      incomplete: incomplete.length,
    },
  };
}

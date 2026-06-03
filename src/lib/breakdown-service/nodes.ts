import { z } from 'zod';
import { buildRunPrompt, buildSummaryPrompt, type UpstreamInput } from '@/lib/ai/build-prompt';
import { getSummaryModelId, resolveAiModelSelection } from '@/lib/ai/models';
import {
  getAiProviderCredentialsSetupError,
  getProviderSetupPrompt,
  getUserAiProviderApiKey,
} from '@/lib/ai/credentials';
import { createAiCompletion } from '@/lib/ai/provider-completion';
import { fetchWebUrl } from '@/lib/fetch/fetch-web-url';
import { fetchGoogleDoc } from '@/lib/fetch/fetch-google-doc';
import { fetchGoogleSheet } from '@/lib/fetch/fetch-google-sheet';
import { fetchGoogleDriveSource } from '@/lib/integrations/google-drive/export';
import { formatSourceAge, isStaleSourceNode } from '@/lib/graph/source-freshness';
import {
  getDataSourceType,
  isDataSourceNode,
  isGoogleDriveSourceConfig,
} from '@/types/data-source';
import type { BreakdownNode } from '@/types/node';
import type { BreakdownEdge } from '@/types/edge';
import type { Graph } from '@/types/graph';
import type { BreakdownActor } from './actor';
import { requireScope } from './actor';
import { BreakdownServiceError } from './errors';
import { assertGraphAccess, type SupabaseClient } from './graphs';
import { createNodeSchema, runNodeSchema, updateNodeSchema, uuidSchema } from './schemas';
import { auditHeadlessOperation, assertTextByteLimit, HEADLESS_LIMITS } from './safety';
import { createServerClient } from '@/lib/supabase/server';

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

export async function getNodeForActor(
  supabase: SupabaseClient,
  actor: BreakdownActor,
  nodeId: string,
): Promise<{ node: BreakdownNode; graph: Graph }> {
  const parsedNodeId = parseOrThrow(uuidSchema, nodeId);
  const { data, error } = await supabase.from('nodes').select('*').eq('id', parsedNodeId).single();
  if (error || !data) {
    throw new BreakdownServiceError('not_found', error?.message ?? 'Node not found', 404);
  }

  const node = data as BreakdownNode;
  const graph = await assertGraphAccess(supabase, actor, node.graph_id);
  return { node, graph };
}

export async function createNodeForActor(
  actor: BreakdownActor,
  input: z.input<typeof createNodeSchema>,
): Promise<BreakdownNode> {
  requireScope(actor, 'graphs:write');
  const parsed = parseOrThrow(createNodeSchema, input);
  assertTextByteLimit(parsed.prompt, HEADLESS_LIMITS.maxNodePromptBytes, 'Node prompt');

  const supabase = serviceClient();
  await assertGraphAccess(supabase, actor, parsed.graphId);

  const { data, error } = await supabase
    .from('nodes')
    .insert({
      graph_id: parsed.graphId,
      node_type: parsed.nodeType ?? 'default',
      name: parsed.name,
      prompt: parsed.prompt ?? '',
      metadata: parsed.metadata ?? {},
      position_x: parsed.positionX,
      position_y: parsed.positionY,
    })
    .select()
    .single();

  if (error || !data) {
    throw new BreakdownServiceError(
      'database_error',
      error?.message ?? 'Failed to create node',
      400,
    );
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'node.create',
    targetType: 'node',
    targetId: (data as BreakdownNode).id,
    graphId: parsed.graphId,
    requestSummary: { name: parsed.name, nodeType: parsed.nodeType ?? 'default' },
  });

  return data as BreakdownNode;
}

export async function updateNodeForActor(
  actor: BreakdownActor,
  input: z.input<typeof updateNodeSchema>,
): Promise<BreakdownNode> {
  requireScope(actor, 'graphs:write');
  const parsed = parseOrThrow(updateNodeSchema, input);
  assertTextByteLimit(parsed.prompt, HEADLESS_LIMITS.maxNodePromptBytes, 'Node prompt');
  assertTextByteLimit(parsed.output, HEADLESS_LIMITS.maxNodeOutputBytes, 'Node output');

  const supabase = serviceClient();
  const { node } = await getNodeForActor(supabase, actor, parsed.nodeId);
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.prompt !== undefined) updates.prompt = parsed.prompt;
  if (parsed.output !== undefined) updates.output = parsed.output;
  if (parsed.nodeType !== undefined) updates.node_type = parsed.nodeType;
  if (parsed.metadata !== undefined) updates.metadata = parsed.metadata;
  if (parsed.positionX !== undefined) updates.position_x = parsed.positionX;
  if (parsed.positionY !== undefined) updates.position_y = parsed.positionY;
  if (parsed.runStatus !== undefined) updates.run_status = parsed.runStatus;
  if (parsed.runError !== undefined) updates.run_error = parsed.runError;

  const { data, error } = await supabase
    .from('nodes')
    .update(updates)
    .eq('id', parsed.nodeId)
    .select()
    .single();

  if (error || !data) {
    throw new BreakdownServiceError(
      'database_error',
      error?.message ?? 'Failed to update node',
      400,
    );
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'node.update',
    targetType: 'node',
    targetId: parsed.nodeId,
    graphId: node.graph_id,
    requestSummary: Object.keys(updates).reduce<Record<string, true>>((acc, key) => {
      if (key !== 'updated_at') acc[key] = true;
      return acc;
    }, {}),
  });

  return data as BreakdownNode;
}

export async function deleteNodeForActor(actor: BreakdownActor, nodeId: string): Promise<void> {
  requireScope(actor, 'graphs:write');
  const supabase = serviceClient();
  const { node } = await getNodeForActor(supabase, actor, nodeId);

  const { error } = await supabase.from('nodes').delete().eq('id', node.id);
  if (error) {
    throw new BreakdownServiceError('database_error', error.message, 400);
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'node.delete',
    targetType: 'node',
    targetId: node.id,
    graphId: node.graph_id,
    destructive: true,
  });
}

async function runDataSourceNode(
  supabase: SupabaseClient,
  node: BreakdownNode,
  userId: string,
): Promise<{
  output: string;
  lastRunAt: string;
  metadata?: Record<string, unknown>;
}> {
  const sourceType = getDataSourceType(node.node_type);
  if (!sourceType) {
    throw new BreakdownServiceError(
      'validation_error',
      `Unknown source type: ${node.node_type}`,
      400,
    );
  }

  if (sourceType === 'text') {
    if (!node.prompt) {
      throw new BreakdownServiceError(
        'validation_error',
        'No text content. Paste or type your text first.',
        400,
      );
    }

    const lastRunAt = new Date().toISOString();
    await supabase
      .from('nodes')
      .update({
        output: node.prompt,
        run_status: 'success',
        run_error: null,
        last_run_at: lastRunAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', node.id);

    return { output: node.prompt, lastRunAt };
  }

  const metadata = node.metadata ?? {};

  if (isGoogleDriveSourceConfig(metadata)) {
    await supabase
      .from('nodes')
      .update({ run_status: 'running', run_error: null, updated_at: new Date().toISOString() })
      .eq('id', node.id);

    try {
      const result = await fetchGoogleDriveSource(supabase, { node, userId });
      const updatedMetadata = { ...metadata, ...result.metadata };

      await supabase
        .from('nodes')
        .update({
          output: result.content,
          metadata: updatedMetadata,
          run_status: 'success',
          run_error: null,
          last_run_at: result.fetchedAt,
          updated_at: new Date().toISOString(),
        })
        .eq('id', node.id);

      return { output: result.content, lastRunAt: result.fetchedAt, metadata: updatedMetadata };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Google Drive fetch error';
      await supabase
        .from('nodes')
        .update({
          run_status: 'error',
          run_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq('id', node.id);
      throw new BreakdownServiceError('execution_error', message, 400);
    }
  }

  const url = (metadata as { url?: string }).url;
  if (!url) {
    throw new BreakdownServiceError(
      'validation_error',
      'No URL configured. Enter a URL to fetch.',
      400,
    );
  }

  await supabase
    .from('nodes')
    .update({ run_status: 'running', updated_at: new Date().toISOString() })
    .eq('id', node.id);

  try {
    let result: { content: string; fetchedAt: string };

    switch (sourceType) {
      case 'web-url':
        result = await fetchWebUrl(url);
        break;
      case 'google-doc':
        result = await fetchGoogleDoc(url);
        break;
      case 'google-sheet':
        result = await fetchGoogleSheet(url, (metadata as { sheetName?: string }).sheetName);
        break;
      case 'google-presentation':
        throw new Error('Google Presentations require a native Google Drive connection.');
    }

    await supabase
      .from('nodes')
      .update({
        output: result.content,
        run_status: 'success',
        run_error: null,
        last_run_at: result.fetchedAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', node.id);

    return { output: result.content, lastRunAt: result.fetchedAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown fetch error';
    await supabase
      .from('nodes')
      .update({
        run_status: 'error',
        run_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', node.id);
    throw new BreakdownServiceError('execution_error', message, 400);
  }
}

export async function runNodeForActor(
  actor: BreakdownActor,
  input: z.input<typeof runNodeSchema>,
): Promise<{
  output: string;
  summary?: string;
  lastRunAt: string;
  metadata?: Record<string, unknown>;
}> {
  requireScope(actor, 'runs:execute');
  const parsed = parseOrThrow(runNodeSchema, input);
  const supabase = serviceClient();
  const { node: typedNode, graph } = await getNodeForActor(supabase, actor, parsed.nodeId);

  if (isDataSourceNode(typedNode.node_type)) {
    const result = await runDataSourceNode(supabase, typedNode, actor.userId);
    await auditHeadlessOperation(supabase, {
      actor,
      operation: 'node.run_source',
      targetType: 'node',
      targetId: typedNode.id,
      graphId: typedNode.graph_id,
    });
    return result;
  }

  if (!typedNode.prompt.trim()) {
    throw new BreakdownServiceError(
      'validation_error',
      'Node has no prompt. Write a task before running.',
      400,
    );
  }

  const { data: inboundEdges, error: edgesError } = await supabase
    .from('edges')
    .select('*')
    .eq('target_node_id', parsed.nodeId);

  if (edgesError) {
    throw new BreakdownServiceError('database_error', edgesError.message, 400);
  }

  const typedEdges = (inboundEdges ?? []) as BreakdownEdge[];
  const upstreamInputs: UpstreamInput[] = [];

  if (typedEdges.length > 0) {
    const sourceIds = typedEdges.map((edge) => edge.source_node_id);
    const { data: sourceNodes, error: sourceError } = await supabase
      .from('nodes')
      .select('*')
      .in('id', sourceIds);

    if (sourceError) {
      throw new BreakdownServiceError('database_error', sourceError.message, 400);
    }

    const sourceMap = new Map<string, BreakdownNode>();
    for (const sourceNode of (sourceNodes ?? []) as BreakdownNode[]) {
      sourceMap.set(sourceNode.id, sourceNode);
    }

    const unavailableInputs: string[] = [];
    const staleInputs: string[] = [];

    for (const edge of typedEdges) {
      const sourceNode = sourceMap.get(edge.source_node_id);
      if (!sourceNode) {
        unavailableInputs.push('Unknown node');
        continue;
      }

      if (sourceNode.run_status !== 'success' || !sourceNode.output) {
        unavailableInputs.push(sourceNode.name);
        continue;
      }

      if (isStaleSourceNode(sourceNode)) {
        staleInputs.push(`${sourceNode.name} (${formatSourceAge(sourceNode.last_run_at)})`);
        continue;
      }

      upstreamInputs.push({
        nodeName: sourceNode.name,
        nodeOutput: sourceNode.output,
        edgeType: edge.edge_type,
      });
    }

    if (unavailableInputs.length > 0) {
      throw new BreakdownServiceError(
        'upstream_not_ready',
        `Upstream input not ready: ${unavailableInputs.join(', ')}. Run or refresh it first.`,
        409,
      );
    }

    if (staleInputs.length > 0) {
      throw new BreakdownServiceError(
        'upstream_not_ready',
        `Stale source input: ${staleInputs.join(', ')}. Use Run All or refresh the source before running this node.`,
        409,
      );
    }
  }

  const { providerId, modelId: executionModel } = resolveAiModelSelection({
    providerId: graph.llm_provider,
    modelId: parsed.llmModel ?? graph.llm_model,
  });

  let apiKey: string | null;
  try {
    apiKey = await getUserAiProviderApiKey(supabase, { userId: actor.userId, providerId });
  } catch (err) {
    throw new BreakdownServiceError(
      'validation_error',
      getAiProviderCredentialsSetupError(err),
      400,
    );
  }

  if (!apiKey) {
    throw new BreakdownServiceError('validation_error', getProviderSetupPrompt(providerId), 400);
  }

  await supabase
    .from('nodes')
    .update({ run_status: 'running', updated_at: new Date().toISOString() })
    .eq('id', parsed.nodeId);

  const previousOutput = typedNode.output;
  const prompt = buildRunPrompt(typedNode.prompt, upstreamInputs);

  try {
    const response = await createAiCompletion({
      apiKey,
      providerId,
      modelId: executionModel,
      maxTokens: 4096,
      system:
        'You are a reasoning assistant in a node-based analysis tool. Produce clear, structured output.',
      prompt,
    });

    const output = response.output;
    let summary: string | undefined;
    try {
      const summaryResponse = await createAiCompletion({
        apiKey,
        providerId,
        modelId: getSummaryModelId(providerId),
        maxTokens: 150,
        prompt: buildSummaryPrompt(output),
      });
      summary = summaryResponse.output.trim() || undefined;
    } catch {
      // Summary is non-critical; proceed without it.
    }

    const updatedMetadata = { ...typedNode.metadata, ...(summary ? { summary } : {}) };
    const lastRunAt = new Date().toISOString();

    await supabase
      .from('nodes')
      .update({
        output,
        metadata: updatedMetadata,
        run_status: 'success',
        run_error: null,
        last_run_at: lastRunAt,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.nodeId);

    await supabase.from('evaluations').insert({
      node_id: parsed.nodeId,
      trigger_type: actor.source === 'clerk-session' ? 'manual' : 'headless_run',
      trigger_source: actor.source,
      previous_conclusion: previousOutput,
      new_conclusion: output,
      previous_confidence: null,
      new_confidence: null,
      diff_summary: summary ?? null,
      skill_doc_id: null,
      llm_provider: providerId,
      llm_model: executionModel,
      prompt_tokens: response.inputTokens,
      completion_tokens: response.outputTokens,
      status: 'applied',
    });

    await auditHeadlessOperation(supabase, {
      actor,
      operation: 'node.run',
      targetType: 'node',
      targetId: typedNode.id,
      graphId: typedNode.graph_id,
      responseSummary: { modelId: executionModel, providerId },
    });

    return { output, summary, lastRunAt };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during AI evaluation';

    await supabase
      .from('nodes')
      .update({
        run_status: 'error',
        run_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.nodeId);

    throw new BreakdownServiceError('execution_error', message, 400);
  }
}

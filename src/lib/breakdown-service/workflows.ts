import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import {
  DEFAULT_AI_PROVIDER_ID,
  getAiProviderOption,
  getProviderForModel,
} from '@/lib/ai/models';
import { sortTopologically } from '@/lib/graph/topological-sort';
import { isStaleSourceNode, formatSourceAge } from '@/lib/graph/source-freshness';
import type { Graph } from '@/types/graph';
import type { BreakdownNode } from '@/types/node';
import type { BreakdownEdge } from '@/types/edge';
import type { BreakdownActor } from './actor';
import { requireScope } from './actor';
import { BreakdownServiceError } from './errors';
import { getGraphForActor } from './graphs';
import { importGraphSchema } from './schemas';
import { auditHeadlessOperation } from './safety';

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

export interface HeadlessGraphExport {
  version: 'breakdown.headless.graph.v1';
  exportedAt: string;
  graph: {
    id: string;
    name: string;
    description: string | null;
    llmProvider: string | null;
    llmModel: string | null;
    createdAt: string;
    updatedAt: string;
  };
  nodes: Array<{
    id: string;
    name: string;
    nodeType: string;
    prompt: string;
    output: string | null;
    structuredOutput: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
    runStatus: string;
    runError: string | null;
    lastRunAt: string | null;
    position: { x: number; y: number };
    createdAt: string;
    updatedAt: string;
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: string;
    weight: number;
    condition: string | null;
    transform: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface WorkflowManifest {
  graphId: string;
  version: string;
  graph: {
    name: string;
    description: string | null;
    llmProvider: string | null;
    llmModel: string | null;
    updatedAt: string;
  };
  nodes: Array<{
    id: string;
    name: string;
    nodeType: string;
    prompt: string;
    output: string | null;
    structuredOutput: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
    runStatus: string;
    runError: string | null;
    lastRunAt: string | null;
    position: { x: number; y: number };
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
    edgeType: string;
    weight: number;
    condition: string | null;
    transform: string | null;
  }>;
  execution: {
    mode: 'internal_runner' | 'external_evaluator';
    topologicalOrder: string[];
    readyNodeIds: string[];
    blockedNodeIds: string[];
    sourceFreshnessWarnings: Array<{ nodeId: string; name: string; warning: string }>;
  };
}

function getManifestVersion(graph: Graph, nodes: BreakdownNode[], edges: BreakdownEdge[]) {
  const latestUpdatedAt = [
    graph.updated_at,
    ...nodes.map((node) => node.updated_at),
    ...edges.map((edge) => edge.updated_at),
  ]
    .filter(Boolean)
    .sort()
    .at(-1);
  return `graph:${graph.id}:${latestUpdatedAt ?? graph.updated_at}:${nodes.length}:${edges.length}`;
}

function validateAcyclic(nodes: BreakdownNode[], edges: BreakdownEdge[]) {
  const { sortedNodes, unsortedNodeIds } = sortTopologically(
    nodes,
    edges.map((edge) => ({ source: edge.source_node_id, target: edge.target_node_id })),
  );

  if (unsortedNodeIds.length > 0) {
    throw new BreakdownServiceError(
      'conflict',
      'Graph contains a cycle and cannot be used as a DAG workflow',
      409,
      { nodeIds: unsortedNodeIds },
    );
  }

  return sortedNodes;
}

function cleanImportString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resolveImportAiSelection(graph: { llmProvider?: string | null; llmModel?: string | null }) {
  const provider = cleanImportString(graph.llmProvider);
  const model = cleanImportString(graph.llmModel);
  const llmModel = model ?? getAiProviderOption(provider).defaultModelId;
  const llmProvider = provider ?? getProviderForModel(llmModel) ?? DEFAULT_AI_PROVIDER_ID;
  return { llmProvider, llmModel };
}

function getReadyNodeIds(nodes: BreakdownNode[], edges: BreakdownEdge[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const inbound = new Map<string, BreakdownEdge[]>();
  for (const node of nodes) inbound.set(node.id, []);
  for (const edge of edges) inbound.get(edge.target_node_id)?.push(edge);

  return nodes
    .filter((node) => {
      const incoming = inbound.get(node.id) ?? [];
      return incoming.every((edge) => {
        const sourceNode = nodeMap.get(edge.source_node_id);
        return sourceNode?.run_status === 'success' && Boolean(sourceNode.output);
      });
    })
    .map((node) => node.id);
}

export async function exportGraphForActor(
  actor: BreakdownActor,
  graphId: string,
): Promise<HeadlessGraphExport> {
  requireScope(actor, 'graphs:read');
  const graphWithData = await getGraphForActor(actor, graphId);
  const { nodes, edges, ...graph } = graphWithData;

  return {
    version: 'breakdown.headless.graph.v1',
    exportedAt: new Date().toISOString(),
    graph: {
      id: graph.id,
      name: graph.name,
      description: graph.description,
      llmProvider: graph.llm_provider,
      llmModel: graph.llm_model,
      createdAt: graph.created_at,
      updatedAt: graph.updated_at,
    },
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      nodeType: node.node_type,
      prompt: node.prompt,
      output: node.output,
      structuredOutput: node.structured_output ?? null,
      metadata: node.metadata,
      runStatus: node.run_status,
      runError: node.run_error,
      lastRunAt: node.last_run_at,
      position: { x: node.position_x, y: node.position_y },
      createdAt: node.created_at,
      updatedAt: node.updated_at,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.source_node_id,
      targetNodeId: edge.target_node_id,
      edgeType: edge.edge_type,
      weight: edge.weight,
      condition: edge.condition,
      transform: edge.transform,
      createdAt: edge.created_at,
      updatedAt: edge.updated_at,
    })),
  };
}

export async function getWorkflowManifestForActor(
  actor: BreakdownActor,
  graphId: string,
  mode: 'internal_runner' | 'external_evaluator' = 'external_evaluator',
): Promise<WorkflowManifest> {
  requireScope(actor, 'graphs:read');
  const graphWithData = await getGraphForActor(actor, graphId);
  const { nodes, edges, ...graph } = graphWithData;
  const sortedNodes = validateAcyclic(nodes, edges);
  const sourceFreshnessWarnings = nodes
    .filter((node) => isStaleSourceNode(node))
    .map((node) => ({
      nodeId: node.id,
      name: node.name,
      warning: `${node.name} is ${formatSourceAge(node.last_run_at)} and should be refreshed before dependent reasoning.`,
    }));

  return {
    graphId: graph.id,
    version: getManifestVersion(graph, nodes, edges),
    graph: {
      name: graph.name,
      description: graph.description,
      llmProvider: graph.llm_provider,
      llmModel: graph.llm_model,
      updatedAt: graph.updated_at,
    },
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      nodeType: node.node_type,
      prompt: node.prompt,
      output: node.output,
      structuredOutput: node.structured_output ?? null,
      metadata: node.metadata,
      runStatus: node.run_status,
      runError: node.run_error,
      lastRunAt: node.last_run_at,
      position: { x: node.position_x, y: node.position_y },
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sourceNodeId: edge.source_node_id,
      targetNodeId: edge.target_node_id,
      edgeType: edge.edge_type,
      weight: edge.weight,
      condition: edge.condition,
      transform: edge.transform,
    })),
    execution: {
      mode,
      topologicalOrder: sortedNodes.map((node) => node.id),
      readyNodeIds: getReadyNodeIds(nodes, edges),
      blockedNodeIds: nodes
        .filter((node) => node.run_status === 'error' || node.run_status === 'skipped')
        .map((node) => node.id),
      sourceFreshnessWarnings,
    },
  };
}

export async function importGraphForActor(
  actor: BreakdownActor,
  input: z.input<typeof importGraphSchema>,
): Promise<{ graphId: string; nodeIdMap: Record<string, string>; edgeCount: number }> {
  requireScope(actor, 'graphs:write');
  const parsed = parseOrThrow(importGraphSchema, input);
  const importNodes = parsed.nodes.map(
    (node, index) =>
      ({
        id: node.id ?? `import-node-${index}`,
        graph_id: 'import',
        node_type: node.nodeType,
        name: node.name,
        prompt: node.prompt,
        output: node.output ?? null,
        structured_output: node.structuredOutput ?? null,
        metadata: node.metadata,
        run_status: node.runStatus,
        run_error: node.runError ?? null,
        last_run_at: node.lastRunAt ?? null,
        position_x: node.position.x,
        position_y: node.position.y,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }) as BreakdownNode,
  );
  const importEdges = parsed.edges.map(
    (edge, index) =>
      ({
        id: edge.id ?? `import-edge-${index}`,
        graph_id: 'import',
        source_node_id: edge.sourceNodeId,
        target_node_id: edge.targetNodeId,
        edge_type: edge.edgeType,
        weight: edge.weight,
        condition: edge.condition ?? null,
        transform: edge.transform ?? null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }) as BreakdownEdge,
  );

  const importNodeIds = new Set(importNodes.map((node) => node.id));
  for (const edge of importEdges) {
    if (!importNodeIds.has(edge.source_node_id) || !importNodeIds.has(edge.target_node_id)) {
      throw new BreakdownServiceError(
        'validation_error',
        'Import edge references an unknown node id',
        400,
        { edgeId: edge.id },
      );
    }
  }
  validateAcyclic(importNodes, importEdges);

  const supabase = serviceClient();
  let graphId = parsed.graphId;
  const aiSelection = resolveImportAiSelection(parsed.graph);
  if (parsed.mode === 'replace') {
    if (!graphId) {
      throw new BreakdownServiceError(
        'validation_error',
        'graphId is required in replace mode',
        400,
      );
    }
    await getGraphForActor(actor, graphId);
    const { error: graphUpdateError } = await supabase
      .from('graphs')
      .update({
        name: parsed.graph.name,
        description: parsed.graph.description ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', graphId)
      .eq('user_id', actor.userId);
    if (graphUpdateError) {
      throw new BreakdownServiceError('database_error', graphUpdateError.message, 400);
    }
    const { error: deleteError } = await supabase.from('nodes').delete().eq('graph_id', graphId);
    if (deleteError) {
      throw new BreakdownServiceError('database_error', deleteError.message, 400);
    }
  } else {
    const { data: graph, error } = await supabase
      .from('graphs')
      .insert({
        user_id: actor.userId,
        name: parsed.graph.name,
        description: parsed.graph.description ?? null,
        llm_provider: aiSelection.llmProvider,
        llm_model: aiSelection.llmModel,
      })
      .select('id')
      .single();
    if (error || !graph) {
      throw new BreakdownServiceError(
        'database_error',
        error?.message ?? 'Failed to import graph',
        400,
      );
    }
    graphId = (graph as { id: string }).id;
  }

  const nodeIdMap: Record<string, string> = {};
  for (const node of importNodes) {
    const { data, error } = await supabase
      .from('nodes')
      .insert({
        graph_id: graphId,
        node_type: node.node_type,
        name: node.name,
        prompt: node.prompt,
        output: node.output,
        structured_output: node.structured_output ?? null,
        metadata: node.metadata,
        run_status: node.run_status,
        run_error: node.run_error,
        last_run_at: node.last_run_at,
        position_x: node.position_x,
        position_y: node.position_y,
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new BreakdownServiceError(
        'database_error',
        error?.message ?? 'Failed to import node',
        400,
      );
    }
    nodeIdMap[node.id] = (data as { id: string }).id;
  }

  for (const edge of importEdges) {
    const { error } = await supabase.from('edges').insert({
      graph_id: graphId,
      source_node_id: nodeIdMap[edge.source_node_id],
      target_node_id: nodeIdMap[edge.target_node_id],
      edge_type: edge.edge_type,
      weight: edge.weight,
      condition: edge.condition,
      transform: edge.transform,
    });
    if (error) {
      throw new BreakdownServiceError('database_error', error.message, 400);
    }
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: parsed.mode === 'replace' ? 'graph.import_replace' : 'graph.import_create',
    targetType: 'graph',
    targetId: graphId,
    graphId,
    destructive: parsed.mode === 'replace',
    requestSummary: { nodeCount: importNodes.length, edgeCount: importEdges.length },
  });

  return { graphId: graphId!, nodeIdMap, edgeCount: importEdges.length };
}

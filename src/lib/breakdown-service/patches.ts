import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { sortTopologically } from '@/lib/graph/topological-sort';
import type { BreakdownNode } from '@/types/node';
import type { BreakdownEdge } from '@/types/edge';
import type { BreakdownActor } from './actor';
import { requireScope } from './actor';
import { BreakdownServiceError } from './errors';
import { getGraphForActor } from './graphs';
import { createNodeForActor, deleteNodeForActor, updateNodeForActor } from './nodes';
import { createEdgeForActor, deleteEdgeForActor, updateEdgeForActor } from './edges';
import { applyGraphPatchSchema } from './schemas';
import { auditHeadlessOperation, HEADLESS_LIMITS } from './safety';

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

type ParsedPatch = z.infer<typeof applyGraphPatchSchema>;

export interface GraphPatchResult {
  dryRun: boolean;
  summary: string;
  changes: Array<{
    op: string;
    target: string;
    description: string;
    destructive: boolean;
  }>;
  createdNodeIds: Record<string, string>;
  applied: boolean;
}

function assertGraphIsAcyclic(nodes: BreakdownNode[], edges: BreakdownEdge[]) {
  const { unsortedNodeIds } = sortTopologically(
    nodes,
    edges.map((edge) => ({ source: edge.source_node_id, target: edge.target_node_id })),
  );
  if (unsortedNodeIds.length > 0) {
    throw new BreakdownServiceError('conflict', 'Patch would create a cycle', 409, {
      nodeIds: unsortedNodeIds,
    });
  }
}

function findNode(nodes: BreakdownNode[], nodeId: string) {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new BreakdownServiceError('validation_error', `Unknown node id: ${nodeId}`, 400);
  }
  return node;
}

function findEdge(edges: BreakdownEdge[], edgeId: string) {
  const edge = edges.find((candidate) => candidate.id === edgeId);
  if (!edge) {
    throw new BreakdownServiceError('validation_error', `Unknown edge id: ${edgeId}`, 400);
  }
  return edge;
}

function resolvePatchNodeRef(
  nodes: BreakdownNode[],
  clientNodeIds: Set<string>,
  nodeId: string | undefined,
  clientId: string | undefined,
) {
  if (nodeId && clientId) {
    throw new BreakdownServiceError(
      'validation_error',
      'Use either nodeId or clientId for a patch endpoint, not both',
      400,
    );
  }
  if (nodeId) {
    findNode(nodes, nodeId);
    return nodeId;
  }
  if (clientId) {
    if (!clientNodeIds.has(clientId)) {
      throw new BreakdownServiceError(
        'validation_error',
        `Unknown client node id: ${clientId}`,
        400,
      );
    }
    return `client:${clientId}`;
  }
  throw new BreakdownServiceError(
    'validation_error',
    'Patch edge endpoint is missing a node reference',
    400,
  );
}

function simulatePatch(
  graphId: string,
  nodes: BreakdownNode[],
  edges: BreakdownEdge[],
  patch: ParsedPatch,
): GraphPatchResult {
  if (patch.operations.length > HEADLESS_LIMITS.maxPatchOperations) {
    throw new BreakdownServiceError('payload_too_large', 'Patch has too many operations', 413);
  }

  const simulatedNodes = nodes.map((node) => ({ ...node }));
  const simulatedEdges = edges.map((edge) => ({ ...edge }));
  const clientNodeIds = new Set<string>();
  const changes: GraphPatchResult['changes'] = [];

  for (const operation of patch.operations) {
    switch (operation.op) {
      case 'add_node': {
        const clientId = operation.clientId ?? `node-${clientNodeIds.size + 1}`;
        if (clientNodeIds.has(clientId)) {
          throw new BreakdownServiceError(
            'validation_error',
            `Duplicate client node id: ${clientId}`,
            400,
          );
        }
        clientNodeIds.add(clientId);
        simulatedNodes.push({
          id: `client:${clientId}`,
          graph_id: graphId,
          node_type: operation.nodeType ?? 'default',
          name: operation.name,
          prompt: operation.prompt ?? '',
          output: null,
          metadata: operation.metadata ?? {},
          run_status: 'idle',
          run_error: null,
          last_run_at: null,
          position_x: operation.positionX ?? 0,
          position_y: operation.positionY ?? 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        changes.push({
          op: operation.op,
          target: clientId,
          description: `Add node "${operation.name}"`,
          destructive: false,
        });
        break;
      }
      case 'update_node': {
        const node = findNode(simulatedNodes, operation.nodeId);
        if (operation.name !== undefined) node.name = operation.name;
        if (operation.prompt !== undefined) node.prompt = operation.prompt;
        if (operation.nodeType !== undefined) node.node_type = operation.nodeType;
        if (operation.metadata !== undefined) node.metadata = operation.metadata;
        if (operation.positionX !== undefined) node.position_x = operation.positionX;
        if (operation.positionY !== undefined) node.position_y = operation.positionY;
        changes.push({
          op: operation.op,
          target: operation.nodeId,
          description: `Update node "${node.name}"`,
          destructive: false,
        });
        break;
      }
      case 'delete_node': {
        const node = findNode(simulatedNodes, operation.nodeId);
        const nodeIndex = simulatedNodes.findIndex(
          (candidate) => candidate.id === operation.nodeId,
        );
        simulatedNodes.splice(nodeIndex, 1);
        for (let index = simulatedEdges.length - 1; index >= 0; index--) {
          if (
            simulatedEdges[index].source_node_id === operation.nodeId ||
            simulatedEdges[index].target_node_id === operation.nodeId
          ) {
            simulatedEdges.splice(index, 1);
          }
        }
        changes.push({
          op: operation.op,
          target: operation.nodeId,
          description: `Delete node "${node.name}" and its incident edges`,
          destructive: true,
        });
        break;
      }
      case 'add_edge': {
        const sourceNodeId = resolvePatchNodeRef(
          simulatedNodes,
          clientNodeIds,
          operation.sourceNodeId,
          operation.sourceClientId,
        );
        const targetNodeId = resolvePatchNodeRef(
          simulatedNodes,
          clientNodeIds,
          operation.targetNodeId,
          operation.targetClientId,
        );
        if (sourceNodeId === targetNodeId) {
          throw new BreakdownServiceError('validation_error', 'Patch cannot add a self edge', 400);
        }
        simulatedEdges.push({
          id: `patch-edge-${simulatedEdges.length + 1}`,
          graph_id: graphId,
          source_node_id: sourceNodeId,
          target_node_id: targetNodeId,
          edge_type: operation.edgeType as BreakdownEdge['edge_type'],
          weight: operation.weight ?? 1,
          condition: operation.condition ?? null,
          transform: operation.transform ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        changes.push({
          op: operation.op,
          target: `${sourceNodeId}->${targetNodeId}`,
          description: `Add ${operation.edgeType} edge`,
          destructive: false,
        });
        break;
      }
      case 'update_edge': {
        const edge = findEdge(simulatedEdges, operation.edgeId);
        if (operation.sourceNodeId !== undefined) {
          findNode(simulatedNodes, operation.sourceNodeId);
          edge.source_node_id = operation.sourceNodeId;
        }
        if (operation.targetNodeId !== undefined) {
          findNode(simulatedNodes, operation.targetNodeId);
          edge.target_node_id = operation.targetNodeId;
        }
        if (operation.edgeType !== undefined)
          edge.edge_type = operation.edgeType as BreakdownEdge['edge_type'];
        if (operation.weight !== undefined) edge.weight = operation.weight;
        if (operation.condition !== undefined) edge.condition = operation.condition;
        if (operation.transform !== undefined) edge.transform = operation.transform;
        changes.push({
          op: operation.op,
          target: operation.edgeId,
          description: `Update edge ${operation.edgeId}`,
          destructive: false,
        });
        break;
      }
      case 'delete_edge': {
        findEdge(simulatedEdges, operation.edgeId);
        const edgeIndex = simulatedEdges.findIndex(
          (candidate) => candidate.id === operation.edgeId,
        );
        simulatedEdges.splice(edgeIndex, 1);
        changes.push({
          op: operation.op,
          target: operation.edgeId,
          description: `Delete edge ${operation.edgeId}`,
          destructive: true,
        });
        break;
      }
    }
  }

  assertGraphIsAcyclic(simulatedNodes, simulatedEdges);
  const destructiveCount = changes.filter((change) => change.destructive).length;
  return {
    dryRun: patch.dryRun,
    summary: `${changes.length} change${changes.length === 1 ? '' : 's'} prepared; ${destructiveCount} destructive.`,
    changes,
    createdNodeIds: {},
    applied: false,
  };
}

export async function applyGraphPatchForActor(
  actor: BreakdownActor,
  graphId: string,
  input: z.input<typeof applyGraphPatchSchema>,
): Promise<GraphPatchResult> {
  requireScope(actor, 'graphs:write');
  const parsed = parseOrThrow(applyGraphPatchSchema, input);
  const graph = await getGraphForActor(actor, graphId);
  const simulated = simulatePatch(graph.id, graph.nodes, graph.edges, parsed);

  if (parsed.dryRun) {
    return simulated;
  }

  const createdNodeIds: Record<string, string> = {};
  for (const operation of parsed.operations) {
    switch (operation.op) {
      case 'add_node': {
        const node = await createNodeForActor(actor, {
          graphId: graph.id,
          name: operation.name,
          prompt: operation.prompt,
          nodeType: operation.nodeType,
          metadata: operation.metadata,
          positionX: operation.positionX ?? 0,
          positionY: operation.positionY ?? 0,
        });
        if (operation.clientId) createdNodeIds[operation.clientId] = node.id;
        break;
      }
      case 'update_node':
        await updateNodeForActor(actor, {
          nodeId: operation.nodeId,
          name: operation.name,
          prompt: operation.prompt,
          nodeType: operation.nodeType,
          metadata: operation.metadata,
          positionX: operation.positionX,
          positionY: operation.positionY,
        });
        break;
      case 'delete_node':
        await deleteNodeForActor(actor, operation.nodeId);
        break;
      case 'add_edge': {
        const sourceNodeId =
          operation.sourceNodeId ?? createdNodeIds[operation.sourceClientId ?? ''];
        const targetNodeId =
          operation.targetNodeId ?? createdNodeIds[operation.targetClientId ?? ''];
        if (!sourceNodeId || !targetNodeId) {
          throw new BreakdownServiceError(
            'validation_error',
            'Patch add_edge references a node that was not created',
            400,
          );
        }
        await createEdgeForActor(actor, {
          graphId: graph.id,
          sourceNodeId,
          targetNodeId,
          edgeType: operation.edgeType,
          weight: operation.weight,
          condition: operation.condition,
          transform: operation.transform,
        });
        break;
      }
      case 'update_edge':
        await updateEdgeForActor(actor, {
          edgeId: operation.edgeId,
          sourceNodeId: operation.sourceNodeId,
          targetNodeId: operation.targetNodeId,
          edgeType: operation.edgeType,
          weight: operation.weight,
          condition: operation.condition,
          transform: operation.transform,
        });
        break;
      case 'delete_edge':
        await deleteEdgeForActor(actor, operation.edgeId);
        break;
    }
  }

  const supabase = createServerClient();
  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'graph.patch_apply',
    targetType: 'graph',
    targetId: graph.id,
    graphId: graph.id,
    destructive: simulated.changes.some((change) => change.destructive),
    requestSummary: { operationCount: parsed.operations.length },
  });

  return {
    ...simulated,
    dryRun: false,
    createdNodeIds,
    applied: true,
  };
}

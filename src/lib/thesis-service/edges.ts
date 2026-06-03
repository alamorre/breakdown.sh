import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { wouldCreateCycle } from '@/lib/graph/detect-cycle';
import type { ThesisEdge } from '@/types/edge';
import type { ThesisNode } from '@/types/node';
import type { ThesisActor } from './actor';
import { requireScope } from './actor';
import { ThesisServiceError } from './errors';
import { assertGraphAccess, type SupabaseClient } from './graphs';
import { createEdgeSchema, updateEdgeSchema, uuidSchema } from './schemas';
import { auditHeadlessOperation } from './safety';

function serviceClient() {
  return createServerClient();
}

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ThesisServiceError('validation_error', parsed.error.message, 400, parsed.error.flatten());
  }
  return parsed.data;
}

async function getEdgeForActor(
  supabase: SupabaseClient,
  actor: ThesisActor,
  edgeId: string,
): Promise<ThesisEdge> {
  const parsedEdgeId = parseOrThrow(uuidSchema, edgeId);
  const { data, error } = await supabase.from('edges').select('*').eq('id', parsedEdgeId).single();
  if (error || !data) {
    throw new ThesisServiceError('not_found', error?.message ?? 'Edge not found', 404);
  }

  const edge = data as ThesisEdge;
  await assertGraphAccess(supabase, actor, edge.graph_id);
  return edge;
}

async function assertEndpointNodes(
  supabase: SupabaseClient,
  graphId: string,
  sourceNodeId: string,
  targetNodeId: string,
) {
  if (sourceNodeId === targetNodeId) {
    throw new ThesisServiceError('validation_error', 'Edges cannot connect a node to itself', 400);
  }

  const { data, error } = await supabase
    .from('nodes')
    .select('id,graph_id')
    .in('id', [sourceNodeId, targetNodeId]);

  if (error) {
    throw new ThesisServiceError('database_error', error.message, 400);
  }

  const nodes = (data ?? []) as Pick<ThesisNode, 'id' | 'graph_id'>[];
  const source = nodes.find((node) => node.id === sourceNodeId);
  const target = nodes.find((node) => node.id === targetNodeId);

  if (!source || !target || source.graph_id !== graphId || target.graph_id !== graphId) {
    throw new ThesisServiceError(
      'validation_error',
      'Both edge endpoints must be nodes in the target graph',
      400,
    );
  }
}

async function assertAcyclicEdge(
  supabase: SupabaseClient,
  graphId: string,
  sourceNodeId: string,
  targetNodeId: string,
  ignoredEdgeId?: string,
) {
  const { data, error } = await supabase
    .from('edges')
    .select('id,source_node_id,target_node_id')
    .eq('graph_id', graphId);

  if (error) {
    throw new ThesisServiceError('database_error', error.message, 400);
  }

  const existingEdges = ((data ?? []) as ThesisEdge[])
    .filter((edge) => edge.id !== ignoredEdgeId)
    .map((edge) => ({ source: edge.source_node_id, target: edge.target_node_id }));

  if (wouldCreateCycle(existingEdges, sourceNodeId, targetNodeId)) {
    throw new ThesisServiceError(
      'conflict',
      'Edge would create a cycle. Breakdown graphs must stay acyclic.',
      409,
    );
  }
}

export async function createEdgeForActor(
  actor: ThesisActor,
  input: z.input<typeof createEdgeSchema>,
): Promise<ThesisEdge> {
  requireScope(actor, 'graphs:write');
  const parsed = parseOrThrow(createEdgeSchema, input);
  const supabase = serviceClient();
  await assertGraphAccess(supabase, actor, parsed.graphId);
  await assertEndpointNodes(supabase, parsed.graphId, parsed.sourceNodeId, parsed.targetNodeId);
  await assertAcyclicEdge(supabase, parsed.graphId, parsed.sourceNodeId, parsed.targetNodeId);

  const { data, error } = await supabase
    .from('edges')
    .insert({
      graph_id: parsed.graphId,
      source_node_id: parsed.sourceNodeId,
      target_node_id: parsed.targetNodeId,
      edge_type: parsed.edgeType,
      weight: parsed.weight ?? 1,
      condition: parsed.condition ?? null,
      transform: parsed.transform ?? null,
    })
    .select()
    .single();

  if (error || !data) {
    throw new ThesisServiceError('database_error', error?.message ?? 'Failed to create edge', 400);
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'edge.create',
    targetType: 'edge',
    targetId: (data as ThesisEdge).id,
    graphId: parsed.graphId,
    requestSummary: { edgeType: parsed.edgeType },
  });

  return data as ThesisEdge;
}

export async function updateEdgeForActor(
  actor: ThesisActor,
  input: z.input<typeof updateEdgeSchema>,
): Promise<ThesisEdge> {
  requireScope(actor, 'graphs:write');
  const parsed = parseOrThrow(updateEdgeSchema, input);
  const supabase = serviceClient();
  const existing = await getEdgeForActor(supabase, actor, parsed.edgeId);

  const nextSourceId = parsed.sourceNodeId ?? existing.source_node_id;
  const nextTargetId = parsed.targetNodeId ?? existing.target_node_id;
  await assertEndpointNodes(supabase, existing.graph_id, nextSourceId, nextTargetId);
  await assertAcyclicEdge(supabase, existing.graph_id, nextSourceId, nextTargetId, existing.id);

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.sourceNodeId !== undefined) updates.source_node_id = parsed.sourceNodeId;
  if (parsed.targetNodeId !== undefined) updates.target_node_id = parsed.targetNodeId;
  if (parsed.edgeType !== undefined) updates.edge_type = parsed.edgeType;
  if (parsed.weight !== undefined) updates.weight = parsed.weight;
  if (parsed.condition !== undefined) updates.condition = parsed.condition;
  if (parsed.transform !== undefined) updates.transform = parsed.transform;

  const { data, error } = await supabase
    .from('edges')
    .update(updates)
    .eq('id', existing.id)
    .select()
    .single();

  if (error || !data) {
    throw new ThesisServiceError('database_error', error?.message ?? 'Failed to update edge', 400);
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'edge.update',
    targetType: 'edge',
    targetId: existing.id,
    graphId: existing.graph_id,
  });

  return data as ThesisEdge;
}

export async function deleteEdgeForActor(actor: ThesisActor, edgeId: string): Promise<void> {
  requireScope(actor, 'graphs:write');
  const supabase = serviceClient();
  const edge = await getEdgeForActor(supabase, actor, edgeId);

  const { error } = await supabase.from('edges').delete().eq('id', edge.id);
  if (error) {
    throw new ThesisServiceError('database_error', error.message, 400);
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'edge.delete',
    targetType: 'edge',
    targetId: edge.id,
    graphId: edge.graph_id,
    destructive: true,
  });
}

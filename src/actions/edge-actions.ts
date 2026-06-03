'use server';

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import type { BreakdownEdge } from '@/types/edge';

const createEdgeSchema = z.object({
  graphId: z.string().uuid(),
  sourceNodeId: z.string().uuid(),
  targetNodeId: z.string().uuid(),
  edgeType: z.string().min(1),
});

const updateEdgeSchema = z.object({
  edgeId: z.string().uuid(),
  edgeType: z.string().min(1).optional(),
  weight: z.number().min(0).max(1).optional(),
});

const deleteEdgeSchema = z.object({
  edgeId: z.string().uuid(),
});

async function getUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return userId;
}

export async function createEdge(
  input: z.infer<typeof createEdgeSchema>,
): Promise<{ data: BreakdownEdge | null; error: string | null }> {
  await getUserId();
  const parsed = createEdgeSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('edges')
    .insert({
      graph_id: parsed.data.graphId,
      source_node_id: parsed.data.sourceNodeId,
      target_node_id: parsed.data.targetNodeId,
      edge_type: parsed.data.edgeType,
    })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as BreakdownEdge, error: null };
}

export async function updateEdge(
  input: z.infer<typeof updateEdgeSchema>,
): Promise<{ data: BreakdownEdge | null; error: string | null }> {
  await getUserId();
  const parsed = updateEdgeSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.edgeType !== undefined) updates.edge_type = parsed.data.edgeType;
  if (parsed.data.weight !== undefined) updates.weight = parsed.data.weight;

  const { data, error } = await supabase
    .from('edges')
    .update(updates)
    .eq('id', parsed.data.edgeId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as BreakdownEdge, error: null };
}

export async function deleteEdge(
  input: z.infer<typeof deleteEdgeSchema>,
): Promise<{ error: string | null }> {
  await getUserId();
  const parsed = deleteEdgeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.message };
  }

  const supabase = createServerClient();
  const { error } = await supabase.from('edges').delete().eq('id', parsed.data.edgeId);

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

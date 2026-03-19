'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import type { Graph } from '@/types/graph';
import type { ThesisNode } from '@/types/node';
import type { ThesisEdge } from '@/types/edge';

const createGraphSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
});

const updateGraphSchema = z.object({
  graphId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
});

const deleteGraphSchema = z.object({
  graphId: z.string().uuid(),
});

const getGraphSchema = z.object({
  graphId: z.string().uuid(),
});

async function getUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return userId;
}

export async function createGraph(
  input: z.infer<typeof createGraphSchema>,
): Promise<{ data: Graph | null; error: string | null }> {
  const userId = await getUserId();
  const parsed = createGraphSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('graphs')
    .insert({
      user_id: userId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
    })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  revalidatePath('/dashboard');
  return { data: data as Graph, error: null };
}

export async function getUserGraphs(): Promise<{
  data: Graph[];
  error: string | null;
}> {
  const userId = await getUserId();
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('graphs')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: (data ?? []) as Graph[], error: null };
}

export async function updateGraph(
  input: z.infer<typeof updateGraphSchema>,
): Promise<{ data: Graph | null; error: string | null }> {
  const userId = await getUserId();
  const parsed = updateGraphSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();
  const updates: Record<string, string> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;

  const { data, error } = await supabase
    .from('graphs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', parsed.data.graphId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  revalidatePath('/dashboard');
  return { data: data as Graph, error: null };
}

export async function deleteGraph(
  input: z.infer<typeof deleteGraphSchema>,
): Promise<{ error: string | null }> {
  const userId = await getUserId();
  const parsed = deleteGraphSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.message };
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from('graphs')
    .delete()
    .eq('id', parsed.data.graphId)
    .eq('user_id', userId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath('/dashboard');
  return { error: null };
}

export async function getGraph(input: z.infer<typeof getGraphSchema>): Promise<{
  data: { graph: Graph; nodes: ThesisNode[]; edges: ThesisEdge[] } | null;
  error: string | null;
}> {
  const userId = await getUserId();
  const parsed = getGraphSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();

  const { data: graph, error: graphError } = await supabase
    .from('graphs')
    .select('*')
    .eq('id', parsed.data.graphId)
    .eq('user_id', userId)
    .single();

  if (graphError) {
    return { data: null, error: graphError.message };
  }

  const [nodesResult, edgesResult] = await Promise.all([
    supabase.from('nodes').select('*').eq('graph_id', parsed.data.graphId),
    supabase.from('edges').select('*').eq('graph_id', parsed.data.graphId),
  ]);

  if (nodesResult.error) {
    return { data: null, error: nodesResult.error.message };
  }
  if (edgesResult.error) {
    return { data: null, error: edgesResult.error.message };
  }

  return {
    data: {
      graph: graph as Graph,
      nodes: (nodesResult.data ?? []) as ThesisNode[],
      edges: (edgesResult.data ?? []) as ThesisEdge[],
    },
    error: null,
  };
}

export async function updateGraphName(
  graphId: string,
  name: string,
): Promise<{ error: string | null }> {
  const result = await updateGraph({ graphId, name });
  return { error: result.error };
}

export async function batchUpdateNodePositions(
  updates: { nodeId: string; x: number; y: number }[],
): Promise<{ error: string | null }> {
  await getUserId();
  const supabase = createServerClient();

  for (const { nodeId, x, y } of updates) {
    const { error } = await supabase
      .from('nodes')
      .update({
        position_x: x,
        position_y: y,
        updated_at: new Date().toISOString(),
      })
      .eq('id', nodeId);

    if (error) {
      return { error: error.message };
    }
  }

  return { error: null };
}

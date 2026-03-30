'use server';

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import type { ThesisNode } from '@/types/node';

const createNodeSchema = z.object({
  graphId: z.string().uuid(),
  nodeType: z.string().min(1),
  name: z.string().min(1).max(200),
  positionX: z.number(),
  positionY: z.number(),
});

const updateNodeSchema = z.object({
  nodeId: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  conclusion: z.string().max(10000).nullable().optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z
    .array(
      z.object({
        id: z.string(),
        content: z.string(),
        source: z.string().optional(),
        added_at: z.string(),
      }),
    )
    .optional(),
  assumptions: z.array(z.string()).optional(),
  collapsed: z.boolean().optional(),
});

const deleteNodeSchema = z.object({
  nodeId: z.string().uuid(),
});

async function getUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return userId;
}

export async function createNode(
  input: z.infer<typeof createNodeSchema>,
): Promise<{ data: ThesisNode | null; error: string | null }> {
  await getUserId();
  const parsed = createNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('nodes')
    .insert({
      graph_id: parsed.data.graphId,
      node_type: parsed.data.nodeType,
      name: parsed.data.name,
      position_x: parsed.data.positionX,
      position_y: parsed.data.positionY,
    })
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ThesisNode, error: null };
}

export async function updateNode(
  input: z.infer<typeof updateNodeSchema>,
): Promise<{ data: ThesisNode | null; error: string | null }> {
  await getUserId();
  const parsed = updateNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  const supabase = createServerClient();
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.conclusion !== undefined) updates.conclusion = parsed.data.conclusion;
  if (parsed.data.confidence !== undefined) updates.confidence = parsed.data.confidence;
  if (parsed.data.evidence !== undefined) updates.evidence = parsed.data.evidence;
  if (parsed.data.assumptions !== undefined) updates.assumptions = parsed.data.assumptions;
  if (parsed.data.collapsed !== undefined) updates.collapsed = parsed.data.collapsed;

  const { data, error } = await supabase
    .from('nodes')
    .update(updates)
    .eq('id', parsed.data.nodeId)
    .select()
    .single();

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as ThesisNode, error: null };
}

export async function deleteNode(
  input: z.infer<typeof deleteNodeSchema>,
): Promise<{ error: string | null }> {
  await getUserId();
  const parsed = deleteNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.message };
  }

  const supabase = createServerClient();
  const { error } = await supabase.from('nodes').delete().eq('id', parsed.data.nodeId);

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

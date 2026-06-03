'use server';

import { z } from 'zod';
import { resolveClerkActor } from '@/lib/thesis-service/actor';
import { getErrorResponse } from '@/lib/thesis-service/errors';
import {
  createNodeForActor,
  deleteNodeForActor,
  runNodeForActor,
  updateNodeForActor,
} from '@/lib/thesis-service/nodes';
import { createNodeSchema, runNodeSchema, updateNodeSchema, uuidSchema } from '@/lib/thesis-service/schemas';
import type { ThesisNode } from '@/types/node';

function actionError(err: unknown) {
  const error = getErrorResponse(err);
  if (error.code === 'unauthorized') {
    throw new Error(error.message);
  }
  return error.message;
}

export async function createNode(
  input: z.input<typeof createNodeSchema>,
): Promise<{ data: ThesisNode | null; error: string | null }> {
  try {
    const actor = await resolveClerkActor();
    return { data: await createNodeForActor(actor, input), error: null };
  } catch (err) {
    return { data: null, error: actionError(err) };
  }
}

export async function updateNode(
  input: z.input<typeof updateNodeSchema>,
): Promise<{ data: ThesisNode | null; error: string | null }> {
  try {
    const actor = await resolveClerkActor();
    return { data: await updateNodeForActor(actor, input), error: null };
  } catch (err) {
    return { data: null, error: actionError(err) };
  }
}

export async function deleteNode(input: { nodeId: string }): Promise<{ error: string | null }> {
  try {
    const actor = await resolveClerkActor();
    await deleteNodeForActor(actor, uuidSchema.parse(input.nodeId));
    return { error: null };
  } catch (err) {
    return { error: actionError(err) };
  }
}

export async function runNode(input: z.input<typeof runNodeSchema>): Promise<{
  data: {
    output: string;
    summary?: string;
    lastRunAt: string;
    metadata?: Record<string, unknown>;
  } | null;
  error: string | null;
}> {
  try {
    const actor = await resolveClerkActor();
    return { data: await runNodeForActor(actor, input), error: null };
  } catch (err) {
    return { data: null, error: actionError(err) };
  }
}

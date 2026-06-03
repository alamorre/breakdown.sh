'use server';

import { z } from 'zod';
import { resolveClerkActor } from '@/lib/breakdown-service/actor';
import { getErrorResponse } from '@/lib/breakdown-service/errors';
import {
  createEdgeForActor,
  deleteEdgeForActor,
  updateEdgeForActor,
} from '@/lib/breakdown-service/edges';
import { createEdgeSchema, updateEdgeSchema, uuidSchema } from '@/lib/breakdown-service/schemas';
import type { BreakdownEdge } from '@/types/edge';

function actionError(err: unknown) {
  const error = getErrorResponse(err);
  if (error.code === 'unauthorized') {
    throw new Error(error.message);
  }
  return error.message;
}

export async function createEdge(
  input: z.input<typeof createEdgeSchema>,
): Promise<{ data: BreakdownEdge | null; error: string | null }> {
  try {
    const actor = await resolveClerkActor();
    return { data: await createEdgeForActor(actor, input), error: null };
  } catch (err) {
    return { data: null, error: actionError(err) };
  }
}

export async function updateEdge(
  input: z.input<typeof updateEdgeSchema>,
): Promise<{ data: BreakdownEdge | null; error: string | null }> {
  try {
    const actor = await resolveClerkActor();
    return { data: await updateEdgeForActor(actor, input), error: null };
  } catch (err) {
    return { data: null, error: actionError(err) };
  }
}

export async function deleteEdge(input: { edgeId: string }): Promise<{ error: string | null }> {
  try {
    const actor = await resolveClerkActor();
    await deleteEdgeForActor(actor, uuidSchema.parse(input.edgeId));
    return { error: null };
  } catch (err) {
    return { error: actionError(err) };
  }
}

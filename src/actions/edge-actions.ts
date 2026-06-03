'use server';

import { z } from 'zod';
import { resolveClerkActor } from '@/lib/thesis-service/actor';
import { getErrorResponse } from '@/lib/thesis-service/errors';
import {
  createEdgeForActor,
  deleteEdgeForActor,
  updateEdgeForActor,
} from '@/lib/thesis-service/edges';
import { createEdgeSchema, updateEdgeSchema, uuidSchema } from '@/lib/thesis-service/schemas';
import type { ThesisEdge } from '@/types/edge';

function actionError(err: unknown) {
  const error = getErrorResponse(err);
  if (error.code === 'unauthorized') {
    throw new Error(error.message);
  }
  return error.message;
}

export async function createEdge(
  input: z.input<typeof createEdgeSchema>,
): Promise<{ data: ThesisEdge | null; error: string | null }> {
  try {
    const actor = await resolveClerkActor();
    return { data: await createEdgeForActor(actor, input), error: null };
  } catch (err) {
    return { data: null, error: actionError(err) };
  }
}

export async function updateEdge(
  input: z.input<typeof updateEdgeSchema>,
): Promise<{ data: ThesisEdge | null; error: string | null }> {
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

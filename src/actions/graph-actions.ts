'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { resolveClerkActor } from '@/lib/thesis-service/actor';
import { getErrorResponse } from '@/lib/thesis-service/errors';
import {
  createGraphForActor,
  deleteGraphForActor,
  getGraphForActor,
  listGraphsForActor,
  updateGraphForActor,
} from '@/lib/thesis-service/graphs';
import { updateNodeForActor } from '@/lib/thesis-service/nodes';
import { createGraphSchema, updateGraphSchema, uuidSchema } from '@/lib/thesis-service/schemas';
import type { Graph } from '@/types/graph';
import type { ThesisNode } from '@/types/node';
import type { ThesisEdge } from '@/types/edge';

function actionError(err: unknown) {
  const error = getErrorResponse(err);
  if (error.code === 'unauthorized') {
    throw new Error(error.message);
  }
  return error.message;
}

export async function createGraph(
  input: z.input<typeof createGraphSchema>,
): Promise<{ data: Graph | null; error: string | null }> {
  try {
    const actor = await resolveClerkActor();
    const data = await createGraphForActor(actor, input);
    revalidatePath('/dashboard');
    return { data, error: null };
  } catch (err) {
    return { data: null, error: actionError(err) };
  }
}

export async function getUserGraphs(): Promise<{
  data: Graph[];
  error: string | null;
}> {
  try {
    const actor = await resolveClerkActor();
    return { data: await listGraphsForActor(actor), error: null };
  } catch (err) {
    return { data: [], error: actionError(err) };
  }
}

export async function updateGraph(
  input: z.input<typeof updateGraphSchema>,
): Promise<{ data: Graph | null; error: string | null }> {
  try {
    const actor = await resolveClerkActor();
    const data = await updateGraphForActor(actor, input);
    revalidatePath('/dashboard');
    revalidatePath(`/graph/${input.graphId}`);
    return { data, error: null };
  } catch (err) {
    return { data: null, error: actionError(err) };
  }
}

export async function deleteGraph(input: { graphId: string }): Promise<{ error: string | null }> {
  try {
    const graphId = uuidSchema.parse(input.graphId);
    const actor = await resolveClerkActor();
    await deleteGraphForActor(actor, graphId);
    revalidatePath('/dashboard');
    return { error: null };
  } catch (err) {
    return { error: actionError(err) };
  }
}

export async function getGraph(input: { graphId: string }): Promise<{
  data: { graph: Graph; nodes: ThesisNode[]; edges: ThesisEdge[] } | null;
  error: string | null;
}> {
  try {
    const graphId = uuidSchema.parse(input.graphId);
    const actor = await resolveClerkActor();
    const graphWithData = await getGraphForActor(actor, graphId);
    const { nodes, edges, ...graph } = graphWithData;
    return { data: { graph, nodes, edges }, error: null };
  } catch (err) {
    return { data: null, error: actionError(err) };
  }
}

export async function updateGraphName(
  graphId: string,
  name: string,
): Promise<{ error: string | null }> {
  const result = await updateGraph({ graphId, name });
  return { error: result.error };
}

export async function updateGraphModel(
  graphId: string,
  llmModel: z.input<typeof updateGraphSchema>['llmModel'],
): Promise<{ data: Graph | null; error: string | null }> {
  if (!llmModel) {
    return { data: null, error: 'Model is required' };
  }

  return updateGraph({ graphId, llmModel });
}

export async function batchUpdateNodePositions(
  updates: { nodeId: string; x: number; y: number }[],
): Promise<{ error: string | null }> {
  try {
    const actor = await resolveClerkActor();
    for (const { nodeId, x, y } of updates) {
      await updateNodeForActor(actor, { nodeId, positionX: x, positionY: y });
    }
    return { error: null };
  } catch (err) {
    return { error: actionError(err) };
  }
}

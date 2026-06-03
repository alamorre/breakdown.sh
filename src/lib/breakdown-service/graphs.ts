import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { DEFAULT_AI_MODEL_ID, DEFAULT_AI_PROVIDER_ID, getProviderForModel } from '@/lib/ai/models';
import {
  getActiveAiProviderCredential,
  getAiProviderCredentialsSetupError,
  getProviderSetupPrompt,
  hasAiProviderCredentialEncryption,
} from '@/lib/ai/credentials';
import type { Graph, GraphWithData } from '@/types/graph';
import type { BreakdownNode } from '@/types/node';
import type { BreakdownEdge } from '@/types/edge';
import type { BreakdownActor } from './actor';
import { requireScope } from './actor';
import { BreakdownServiceError } from './errors';
import { auditHeadlessOperation } from './safety';
import { createGraphSchema, updateGraphSchema, uuidSchema } from './schemas';

export type SupabaseClient = ReturnType<typeof createServerClient>;

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

export async function assertGraphAccess(
  supabase: SupabaseClient,
  actor: BreakdownActor,
  graphId: string,
): Promise<Graph> {
  const parsedGraphId = parseOrThrow(uuidSchema, graphId);
  const { data, error } = await supabase
    .from('graphs')
    .select('*')
    .eq('id', parsedGraphId)
    .eq('user_id', actor.userId)
    .single();

  if (error || !data) {
    throw new BreakdownServiceError('not_found', error?.message ?? 'Graph not found', 404);
  }

  return data as Graph;
}

export async function listGraphsForActor(actor: BreakdownActor): Promise<Graph[]> {
  requireScope(actor, 'graphs:read');
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from('graphs')
    .select('*')
    .eq('user_id', actor.userId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new BreakdownServiceError('database_error', error.message, 400);
  }

  return (data ?? []) as Graph[];
}

export async function createGraphForActor(
  actor: BreakdownActor,
  input: z.input<typeof createGraphSchema>,
): Promise<Graph> {
  requireScope(actor, 'graphs:write');
  const parsed = parseOrThrow(createGraphSchema, input);
  const supabase = serviceClient();
  const llmModel = parsed.llmModel ?? DEFAULT_AI_MODEL_ID;
  const llmProvider = getProviderForModel(llmModel);

  const { data, error } = await supabase
    .from('graphs')
    .insert({
      user_id: actor.userId,
      name: parsed.name,
      description: parsed.description ?? null,
      llm_provider: llmProvider ?? DEFAULT_AI_PROVIDER_ID,
      llm_model: llmModel,
    })
    .select()
    .single();

  if (error || !data) {
    throw new BreakdownServiceError(
      'database_error',
      error?.message ?? 'Failed to create graph',
      400,
    );
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'graph.create',
    targetType: 'graph',
    targetId: (data as Graph).id,
    graphId: (data as Graph).id,
    requestSummary: { name: parsed.name },
  });

  return data as Graph;
}

export async function getGraphForActor(
  actor: BreakdownActor,
  graphId: string,
): Promise<GraphWithData> {
  requireScope(actor, 'graphs:read');
  const supabase = serviceClient();
  const graph = await assertGraphAccess(supabase, actor, graphId);

  const [nodesResult, edgesResult] = await Promise.all([
    supabase.from('nodes').select('*').eq('graph_id', graph.id),
    supabase.from('edges').select('*').eq('graph_id', graph.id),
  ]);

  if (nodesResult.error) {
    throw new BreakdownServiceError('database_error', nodesResult.error.message, 400);
  }
  if (edgesResult.error) {
    throw new BreakdownServiceError('database_error', edgesResult.error.message, 400);
  }

  return {
    ...graph,
    nodes: (nodesResult.data ?? []) as BreakdownNode[],
    edges: (edgesResult.data ?? []) as BreakdownEdge[],
  };
}

export async function updateGraphForActor(
  actor: BreakdownActor,
  input: z.input<typeof updateGraphSchema>,
): Promise<Graph> {
  requireScope(actor, 'graphs:write');
  const parsed = parseOrThrow(updateGraphSchema, input);
  const supabase = serviceClient();
  await assertGraphAccess(supabase, actor, parsed.graphId);

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (parsed.name !== undefined) updates.name = parsed.name;
  if (parsed.description !== undefined) updates.description = parsed.description;
  if (parsed.llmModel !== undefined) {
    const providerId = getProviderForModel(parsed.llmModel);
    if (!hasAiProviderCredentialEncryption()) {
      throw new BreakdownServiceError(
        'validation_error',
        'Stored provider keys are not configured for this deployment.',
        400,
      );
    }

    try {
      const credential = await getActiveAiProviderCredential(supabase, {
        userId: actor.userId,
        providerId,
      });
      if (!credential) {
        throw new BreakdownServiceError(
          'validation_error',
          getProviderSetupPrompt(providerId),
          400,
        );
      }
    } catch (err) {
      if (err instanceof BreakdownServiceError) throw err;
      throw new BreakdownServiceError(
        'validation_error',
        getAiProviderCredentialsSetupError(err),
        400,
      );
    }

    updates.llm_provider = providerId;
    updates.llm_model = parsed.llmModel;
  }

  const { data, error } = await supabase
    .from('graphs')
    .update(updates)
    .eq('id', parsed.graphId)
    .eq('user_id', actor.userId)
    .select()
    .single();

  if (error || !data) {
    throw new BreakdownServiceError(
      'database_error',
      error?.message ?? 'Failed to update graph',
      400,
    );
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'graph.update',
    targetType: 'graph',
    targetId: parsed.graphId,
    graphId: parsed.graphId,
    requestSummary: Object.keys(updates).reduce<Record<string, true>>((acc, key) => {
      if (key !== 'updated_at') acc[key] = true;
      return acc;
    }, {}),
  });

  return data as Graph;
}

export async function deleteGraphForActor(actor: BreakdownActor, graphId: string): Promise<void> {
  requireScope(actor, 'graphs:write');
  const supabase = serviceClient();
  const graph = await assertGraphAccess(supabase, actor, graphId);

  const { error } = await supabase
    .from('graphs')
    .delete()
    .eq('id', graph.id)
    .eq('user_id', actor.userId);
  if (error) {
    throw new BreakdownServiceError('database_error', error.message, 400);
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'graph.delete',
    targetType: 'graph',
    targetId: graph.id,
    graphId: graph.id,
    destructive: true,
  });
}

import { z } from 'zod';
import type { createServerClient } from '@/lib/supabase/server';
import {
  EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES,
  externalConsoleBootstrapSchema,
} from '@/lib/headless/onboarding';
import type { ThesisActor } from './actor';
import { ThesisServiceError } from './errors';
import { mintIntegrationToken, type PublicIntegrationTokenRecord } from './tokens';
import { importGraphForActor } from './workflows';
import { importGraphAndCreateExternalRunForActor } from './workflow-runs';

type SupabaseClient = ReturnType<typeof createServerClient>;

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ThesisServiceError('validation_error', parsed.error.message, 400, parsed.error.flatten());
  }
  return parsed.data;
}

function serializeToken(record: PublicIntegrationTokenRecord) {
  return {
    id: record.id,
    name: record.name,
    tokenPrefix: record.token_prefix,
    scopes: record.scopes,
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at,
    revokedAt: record.revoked_at,
  };
}

function defaultTokenName(input: { clientName: string; providerName?: string }) {
  return `${input.providerName ?? input.clientName} external console`;
}

type BootstrappedWorkflow =
  | Awaited<ReturnType<typeof importGraphAndCreateExternalRunForActor>>
  | {
      graphId: string;
      graphUrl: string;
      nodeIdMap: Record<string, string>;
      edgeCount: number;
      manifest: null;
      externalRun: null;
    };

export async function bootstrapExternalConsoleForActor(
  supabase: SupabaseClient,
  actor: ThesisActor,
  input: unknown,
  origin: string,
) {
  const parsed = parseOrThrow(externalConsoleBootstrapSchema, input);
  let workflow: null | BootstrappedWorkflow = null;

  if (parsed.workflow) {
    if (parsed.workflow.createExternalRun) {
      workflow = await importGraphAndCreateExternalRunForActor(
        actor,
        {
          importGraph: parsed.workflow.importGraph,
          externalRun: {
            clientName: parsed.workflow.externalRun?.clientName ?? parsed.clientName,
            providerName: parsed.workflow.externalRun?.providerName ?? parsed.providerName,
            metadata: {
              ...(parsed.workflow.externalRun?.metadata ?? {}),
              onboardedVia: 'headless-onboarding',
            },
          },
        },
        origin,
      );
    } else {
      const imported = await importGraphForActor(actor, parsed.workflow.importGraph);
      workflow = {
        graphId: imported.graphId,
        graphUrl: `${origin}/graph/${imported.graphId}`,
        nodeIdMap: imported.nodeIdMap,
        edgeCount: imported.edgeCount,
        manifest: null,
        externalRun: null,
      };
    }
  }

  const { token, record } = await mintIntegrationToken(supabase, {
    userId: actor.userId,
    name: parsed.tokenName ?? defaultTokenName(parsed),
    scopes: parsed.scopes,
  });

  return {
    token,
    tokenRecord: serializeToken(record),
    sessionContext: {
      clientName: parsed.clientName,
      providerName: parsed.providerName ?? null,
      mcpUrl: `${origin}/api/mcp`,
      headlessApiBaseUrl: `${origin}/api/headless`,
      scopes: parsed.scopes,
      defaultScopes: EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES,
      authorizationHeader: `Bearer ${token}`,
    },
    workflow,
  };
}

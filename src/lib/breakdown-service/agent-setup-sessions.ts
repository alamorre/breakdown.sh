import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import type { createServerClient } from '@/lib/supabase/server';
import {
  EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES,
  externalConsoleBootstrapSchema,
  type ExternalConsoleBootstrapInput,
} from '@/lib/headless/onboarding';
import type { BreakdownActor } from './actor';
import { BreakdownServiceError } from './errors';
import { bootstrapExternalConsoleForActor } from './onboarding';

type SupabaseClient = ReturnType<typeof createServerClient>;

const AGENT_SETUP_SESSION_SELECT =
  'id,user_code,exchange_secret_hash,client_name,provider_name,token_name,scopes,workflow,status,created_at,expires_at,approved_by_user_id,approved_at,exchanged_at,token_id';
const SETUP_SECRET_PREFIX = 'bds';
const SETUP_SECRET_BYTES = 32;
const SETUP_SECRET_PREFIX_BYTES = 6;

export const AGENT_SETUP_SESSION_TTL_MINUTES = 15;

export const agentSetupSessionParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export const approveAgentSetupSessionSchema = z.object({
  userCode: z.string().trim().min(1).max(32).optional(),
});

export const exchangeAgentSetupSessionSchema = z.object({
  exchangeSecret: z.string().trim().min(1).max(256),
});

export type AgentSetupSessionStatus =
  | 'pending'
  | 'approved'
  | 'exchanging'
  | 'exchanged'
  | 'cancelled'
  | 'expired';

type AgentSetupWorkflow = NonNullable<z.output<typeof externalConsoleBootstrapSchema>['workflow']>;
type AgentSetupScope = z.output<typeof externalConsoleBootstrapSchema>['scopes'][number];

interface AgentSetupSessionRecord {
  id: string;
  user_code: string;
  exchange_secret_hash: string;
  client_name: string;
  provider_name: string | null;
  token_name: string | null;
  scopes: AgentSetupScope[];
  workflow: AgentSetupWorkflow | null;
  status: AgentSetupSessionStatus;
  created_at: string;
  expires_at: string;
  approved_by_user_id: string | null;
  approved_at: string | null;
  exchanged_at: string | null;
  token_id: string | null;
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

function hashSetupSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

function createSetupExchangeSecret() {
  const prefix = randomBytes(SETUP_SECRET_PREFIX_BYTES).toString('base64url');
  const secret = randomBytes(SETUP_SECRET_BYTES).toString('base64url');
  return `${SETUP_SECRET_PREFIX}_${prefix}_${secret}`;
}

function createUserCode() {
  return randomBytes(4)
    .toString('hex')
    .toUpperCase()
    .replace(/^(.{4})(.{4})$/, '$1-$2');
}

function setupExpiresAt() {
  return new Date(Date.now() + AGENT_SETUP_SESSION_TTL_MINUTES * 60 * 1000).toISOString();
}

function normalizeUserCode(value: string) {
  return value.trim().toUpperCase();
}

function isTerminalStatus(status: AgentSetupSessionStatus) {
  return status === 'exchanged' || status === 'cancelled' || status === 'expired';
}

function isExpired(record: Pick<AgentSetupSessionRecord, 'expires_at' | 'status'>) {
  if (isTerminalStatus(record.status)) {
    return false;
  }

  return Date.parse(record.expires_at) <= Date.now();
}

function publicStatus(record: AgentSetupSessionRecord): AgentSetupSessionStatus {
  return isExpired(record) ? 'expired' : record.status;
}

function serializeAgentSetupSession(record: AgentSetupSessionRecord, origin?: string) {
  const setupPath = `/agent/setup/${record.id}?code=${encodeURIComponent(record.user_code)}`;
  const statusPath = `/api/integrations/agent-setup-sessions/${record.id}`;
  const exchangePath = `/api/integrations/agent-setup-sessions/${record.id}/exchange`;

  return {
    id: record.id,
    userCode: record.user_code,
    clientName: record.client_name,
    providerName: record.provider_name,
    tokenName: record.token_name,
    scopes: record.scopes,
    status: publicStatus(record),
    createdAt: record.created_at,
    expiresAt: record.expires_at,
    approvedAt: record.approved_at,
    exchangedAt: record.exchanged_at,
    approveUrl: origin ? `${origin}${setupPath}` : setupPath,
    statusUrl: origin ? `${origin}${statusPath}` : statusPath,
    exchangeUrl: origin ? `${origin}${exchangePath}` : exchangePath,
  };
}

function bootstrapInputFromSession(record: AgentSetupSessionRecord): ExternalConsoleBootstrapInput {
  return {
    clientName: record.client_name,
    ...(record.provider_name ? { providerName: record.provider_name } : {}),
    ...(record.token_name ? { tokenName: record.token_name } : {}),
    scopes: record.scopes,
    ...(record.workflow ? { workflow: record.workflow } : {}),
  };
}

async function readAgentSetupSession(
  supabase: SupabaseClient,
  sessionId: string,
): Promise<AgentSetupSessionRecord> {
  const { data, error } = await supabase
    .from('agent_setup_sessions')
    .select(AGENT_SETUP_SESSION_SELECT)
    .eq('id', sessionId)
    .single();

  if (error || !data) {
    throw new BreakdownServiceError('not_found', 'Agent setup session not found', 404);
  }

  return data as AgentSetupSessionRecord;
}

async function updateSessionStatus(
  supabase: SupabaseClient,
  sessionId: string,
  status: AgentSetupSessionStatus,
) {
  await supabase.from('agent_setup_sessions').update({ status }).eq('id', sessionId);
}

export async function createAgentSetupSession(
  supabase: SupabaseClient,
  input: unknown,
  origin: string,
) {
  const parsed = parseOrThrow(externalConsoleBootstrapSchema, input);
  const exchangeSecret = createSetupExchangeSecret();
  const userCode = createUserCode();
  const { data, error } = await supabase
    .from('agent_setup_sessions')
    .insert({
      user_code: userCode,
      exchange_secret_hash: hashSetupSecret(exchangeSecret),
      client_name: parsed.clientName,
      provider_name: parsed.providerName ?? null,
      token_name: parsed.tokenName ?? null,
      scopes: parsed.scopes,
      workflow: parsed.workflow ?? null,
      expires_at: setupExpiresAt(),
    })
    .select(AGENT_SETUP_SESSION_SELECT)
    .single();

  if (error || !data) {
    throw new BreakdownServiceError(
      'database_error',
      error?.message ?? 'Failed to create agent setup session',
      400,
    );
  }

  const session = serializeAgentSetupSession(data as AgentSetupSessionRecord, origin);
  return {
    ...session,
    exchangeSecret,
    defaultScopes: EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES,
  };
}

export async function getAgentSetupSession(
  supabase: SupabaseClient,
  input: unknown,
  origin: string,
) {
  const { sessionId } = parseOrThrow(agentSetupSessionParamsSchema, input);
  const record = await readAgentSetupSession(supabase, sessionId);
  return serializeAgentSetupSession(record, origin);
}

export async function approveAgentSetupSession(
  supabase: SupabaseClient,
  actor: BreakdownActor,
  params: unknown,
  input: unknown,
  origin: string,
) {
  const { sessionId } = parseOrThrow(agentSetupSessionParamsSchema, params);
  const body = parseOrThrow(approveAgentSetupSessionSchema, input);
  const record = await readAgentSetupSession(supabase, sessionId);

  if (body.userCode && normalizeUserCode(body.userCode) !== record.user_code) {
    throw new BreakdownServiceError('validation_error', 'Agent setup code does not match', 400);
  }

  if (isExpired(record)) {
    await updateSessionStatus(supabase, sessionId, 'expired');
    throw new BreakdownServiceError('conflict', 'Agent setup session has expired', 409);
  }

  if (record.status === 'approved' && record.approved_by_user_id === actor.userId) {
    return serializeAgentSetupSession(record, origin);
  }

  if (record.status !== 'pending') {
    throw new BreakdownServiceError(
      'conflict',
      `Agent setup session is already ${record.status}`,
      409,
    );
  }

  const approvedAt = new Date().toISOString();
  const { data, error } = await supabase
    .from('agent_setup_sessions')
    .update({
      status: 'approved',
      approved_by_user_id: actor.userId,
      approved_at: approvedAt,
    })
    .eq('id', sessionId)
    .eq('status', 'pending')
    .select(AGENT_SETUP_SESSION_SELECT)
    .single();

  if (error || !data) {
    throw new BreakdownServiceError('conflict', 'Agent setup session could not be approved', 409);
  }

  return serializeAgentSetupSession(data as AgentSetupSessionRecord, origin);
}

export async function exchangeAgentSetupSession(
  supabase: SupabaseClient,
  params: unknown,
  input: unknown,
  origin: string,
) {
  const { sessionId } = parseOrThrow(agentSetupSessionParamsSchema, params);
  const body = parseOrThrow(exchangeAgentSetupSessionSchema, input);
  const record = await readAgentSetupSession(supabase, sessionId);

  if (hashSetupSecret(body.exchangeSecret) !== record.exchange_secret_hash) {
    throw new BreakdownServiceError('unauthorized', 'Invalid agent setup exchange secret', 401);
  }

  if (isExpired(record)) {
    await updateSessionStatus(supabase, sessionId, 'expired');
    throw new BreakdownServiceError('conflict', 'Agent setup session has expired', 409);
  }

  if (record.status === 'pending') {
    throw new BreakdownServiceError(
      'conflict',
      'Agent setup session has not been approved yet',
      409,
    );
  }

  if (record.status !== 'approved' || !record.approved_by_user_id) {
    throw new BreakdownServiceError(
      'conflict',
      `Agent setup session is already ${record.status}`,
      409,
    );
  }

  const { data: claimed, error: claimError } = await supabase
    .from('agent_setup_sessions')
    .update({ status: 'exchanging' })
    .eq('id', sessionId)
    .eq('status', 'approved')
    .select(AGENT_SETUP_SESSION_SELECT)
    .single();

  if (claimError || !claimed) {
    throw new BreakdownServiceError('conflict', 'Agent setup session could not be exchanged', 409);
  }

  const claimedRecord = claimed as AgentSetupSessionRecord;
  const approvedActor: BreakdownActor = {
    userId: claimedRecord.approved_by_user_id as string,
    source: 'clerk-session',
    scopes: claimedRecord.scopes,
  };

  try {
    const bootstrap = await bootstrapExternalConsoleForActor(
      supabase,
      approvedActor,
      bootstrapInputFromSession(claimedRecord),
      origin,
    );
    const exchangedAt = new Date().toISOString();

    await supabase
      .from('agent_setup_sessions')
      .update({
        status: 'exchanged',
        exchanged_at: exchangedAt,
        token_id: bootstrap.tokenRecord.id,
      })
      .eq('id', sessionId)
      .eq('status', 'exchanging');

    return {
      ...bootstrap,
      setupSession: serializeAgentSetupSession(
        {
          ...claimedRecord,
          status: 'exchanged',
          exchanged_at: exchangedAt,
          token_id: bootstrap.tokenRecord.id,
        },
        origin,
      ),
    };
  } catch (err) {
    await supabase
      .from('agent_setup_sessions')
      .update({ status: 'approved' })
      .eq('id', sessionId)
      .eq('status', 'exchanging');
    throw err;
  }
}

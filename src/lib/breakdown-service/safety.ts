import { createHash } from 'crypto';
import type { createServerClient } from '@/lib/supabase/server';
import type { BreakdownActor } from './actor';
import { BreakdownServiceError } from './errors';

type SupabaseClient = ReturnType<typeof createServerClient>;

export const HEADLESS_LIMITS = {
  maxJsonBodyBytes: 512 * 1024,
  maxNodePromptBytes: 100 * 1024,
  maxNodeOutputBytes: 512 * 1024,
  maxStepContextBytes: 768 * 1024,
  maxPatchOperations: 100,
};

const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT_BY_SOURCE: Record<BreakdownActor['source'], number> = {
  'clerk-session': 600,
  'integration-token': 240,
  'oauth-client': 240,
};

const rateBuckets = new Map<string, { count: number; resetAt: number }>();

export function assertTextByteLimit(
  value: string | null | undefined,
  limit: number,
  label: string,
) {
  if (!value) return;
  if (Buffer.byteLength(value, 'utf8') > limit) {
    throw new BreakdownServiceError('payload_too_large', `${label} is too large`, 413, {
      limitBytes: limit,
    });
  }
}

export function hashPayload(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(value ?? null), 'utf8')
    .digest('hex');
}

export function checkHeadlessRateLimit(actor: BreakdownActor) {
  const now = Date.now();
  const key = `${actor.source}:${actor.tokenId ?? actor.userId}`;
  const bucket = rateBuckets.get(key);
  const limit = RATE_LIMIT_BY_SOURCE[actor.source];

  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    throw new BreakdownServiceError('rate_limited', 'Too many headless requests', 429, {
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    });
  }
}

export async function auditHeadlessOperation(
  supabase: SupabaseClient,
  input: {
    actor: BreakdownActor;
    operation: string;
    targetType: string;
    targetId?: string | null;
    graphId?: string | null;
    destructive?: boolean;
    idempotencyKey?: string | null;
    requestSummary?: Record<string, unknown>;
    responseSummary?: Record<string, unknown>;
  },
) {
  await supabase.from('headless_audit_logs').insert({
    user_id: input.actor.userId,
    actor_source: input.actor.source,
    actor_token_id: input.actor.tokenId ?? null,
    operation: input.operation,
    target_type: input.targetType,
    target_id: input.targetId ?? null,
    graph_id: input.graphId ?? null,
    destructive: input.destructive ?? false,
    idempotency_key: input.idempotencyKey ?? null,
    request_summary: input.requestSummary ?? {},
    response_summary: input.responseSummary ?? {},
  });
}

export async function getIdempotentResponse(
  supabase: SupabaseClient,
  input: {
    actor: BreakdownActor;
    key: string | null;
    method: string;
    path: string;
    requestHash: string;
  },
): Promise<{ status: number; body: unknown } | null> {
  if (!input.key) return null;

  const { data, error } = await supabase
    .from('headless_idempotency_keys')
    .select('request_hash,response_status,response_body,completed_at')
    .eq('user_id', input.actor.userId)
    .eq('key', input.key)
    .single();

  if (error || !data) return null;

  const record = data as {
    request_hash: string;
    response_status: number | null;
    response_body: unknown;
    completed_at: string | null;
  };

  if (record.request_hash !== input.requestHash) {
    throw new BreakdownServiceError(
      'idempotency_conflict',
      'Idempotency key was already used with a different request body',
      409,
    );
  }

  if (record.completed_at && record.response_status && record.response_body !== null) {
    return {
      status: record.response_status,
      body: record.response_body,
    };
  }

  throw new BreakdownServiceError(
    'idempotency_conflict',
    'An idempotent request with this key is still in progress',
    409,
  );
}

export async function reserveIdempotencyKey(
  supabase: SupabaseClient,
  input: {
    actor: BreakdownActor;
    key: string | null;
    method: string;
    path: string;
    requestHash: string;
  },
) {
  if (!input.key) return;

  const { error } = await supabase.from('headless_idempotency_keys').insert({
    user_id: input.actor.userId,
    key: input.key,
    method: input.method,
    path: input.path,
    request_hash: input.requestHash,
  });

  if (error) {
    const replay = await getIdempotentResponse(supabase, input);
    if (replay) return;
    throw new BreakdownServiceError('idempotency_conflict', error.message, 409);
  }
}

export async function completeIdempotencyKey(
  supabase: SupabaseClient,
  input: {
    actor: BreakdownActor;
    key: string | null;
    status: number;
    body: unknown;
  },
) {
  if (!input.key) return;

  await supabase
    .from('headless_idempotency_keys')
    .update({
      response_status: input.status,
      response_body: input.body,
      completed_at: new Date().toISOString(),
    })
    .eq('user_id', input.actor.userId)
    .eq('key', input.key);
}

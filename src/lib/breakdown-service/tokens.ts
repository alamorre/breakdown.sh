import { createHash, randomBytes } from 'crypto';
import { z } from 'zod';
import type { createServerClient } from '@/lib/supabase/server';
import type { BreakdownActor } from './actor';
import { BreakdownServiceError } from './errors';
import { ALL_BREAKDOWN_SCOPES, BREAKDOWN_SCOPES, type BreakdownScope } from './scopes';

type SupabaseClient = ReturnType<typeof createServerClient>;

const TOKEN_PREFIX = 'bdk';
const TOKEN_SECRET_BYTES = 32;
const PUBLIC_TOKEN_SELECT =
  'id,user_id,name,token_prefix,scopes,purpose,created_by_user_id,created_at,last_used_at,revoked_at,expires_at';

export const INTEGRATION_TOKEN_PURPOSES = ['mcp_client', 'release_test'] as const;
export type IntegrationTokenPurpose = (typeof INTEGRATION_TOKEN_PURPOSES)[number];

const DEFAULT_TOKEN_PURPOSE: IntegrationTokenPurpose = 'mcp_client';

export const createIntegrationTokenSchema = z.object({
  userId: z.string().min(1),
  name: z.string().min(1).max(100),
  scopes: z.array(z.enum(BREAKDOWN_SCOPES)).min(1).default(ALL_BREAKDOWN_SCOPES),
  purpose: z.enum(INTEGRATION_TOKEN_PURPOSES).default(DEFAULT_TOKEN_PURPOSE),
  createdByUserId: z.string().min(1).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

export const revokeIntegrationTokenSchema = z.object({
  tokenId: z.string().uuid(),
});

export const revokeIntegrationTokensByPurposeSchema = z.object({
  purpose: z.enum(INTEGRATION_TOKEN_PURPOSES),
});

export interface IntegrationTokenRecord {
  id: string;
  user_id: string;
  name: string;
  token_hash: string;
  token_prefix: string;
  scopes: BreakdownScope[];
  purpose: IntegrationTokenPurpose;
  created_by_user_id: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
}

export type PublicIntegrationTokenRecord = Omit<IntegrationTokenRecord, 'token_hash'>;

export function hashIntegrationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function createRawIntegrationToken(): { token: string; tokenPrefix: string } {
  const secret = randomBytes(TOKEN_SECRET_BYTES).toString('base64url');
  const prefix = randomBytes(6).toString('base64url');
  return {
    token: `${TOKEN_PREFIX}_${prefix}_${secret}`,
    tokenPrefix: `${TOKEN_PREFIX}_${prefix}`,
  };
}

export async function mintIntegrationToken(
  supabase: SupabaseClient,
  input: z.input<typeof createIntegrationTokenSchema>,
): Promise<{
  token: string;
  record: Omit<IntegrationTokenRecord, 'token_hash'>;
}> {
  const parsed = createIntegrationTokenSchema.safeParse(input);
  if (!parsed.success) {
    throw new BreakdownServiceError(
      'validation_error',
      parsed.error.message,
      400,
      parsed.error.flatten(),
    );
  }

  const { token, tokenPrefix } = createRawIntegrationToken();
  const tokenHash = hashIntegrationToken(token);
  const { data, error } = await supabase
    .from('integration_tokens')
    .insert({
      user_id: parsed.data.userId,
      name: parsed.data.name,
      token_hash: tokenHash,
      token_prefix: tokenPrefix,
      scopes: parsed.data.scopes,
      purpose: parsed.data.purpose,
      created_by_user_id: parsed.data.createdByUserId ?? parsed.data.userId,
      expires_at: parsed.data.expiresAt ?? null,
    })
    .select(PUBLIC_TOKEN_SELECT)
    .single();

  if (error || !data) {
    throw new BreakdownServiceError(
      'database_error',
      error?.message ?? 'Failed to create integration token',
      400,
    );
  }

  return {
    token,
    record: data as PublicIntegrationTokenRecord,
  };
}

export async function listIntegrationTokens(
  supabase: SupabaseClient,
  userId: string,
): Promise<PublicIntegrationTokenRecord[]> {
  const { data, error } = await supabase
    .from('integration_tokens')
    .select(PUBLIC_TOKEN_SELECT)
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    throw new BreakdownServiceError('database_error', error.message, 400);
  }

  return (data ?? []) as PublicIntegrationTokenRecord[];
}

export async function resolveIntegrationToken(
  supabase: SupabaseClient,
  token: string,
): Promise<BreakdownActor> {
  if (!token.startsWith(`${TOKEN_PREFIX}_`)) {
    throw new BreakdownServiceError('unauthorized', 'Invalid bearer token', 401);
  }

  const tokenHash = hashIntegrationToken(token);
  const { data, error } = await supabase
    .from('integration_tokens')
    .select('id,user_id,name,scopes,revoked_at,expires_at')
    .eq('token_hash', tokenHash)
    .single();

  if (error || !data) {
    throw new BreakdownServiceError('unauthorized', 'Invalid bearer token', 401);
  }

  const record = data as Pick<
    IntegrationTokenRecord,
    'id' | 'user_id' | 'name' | 'scopes' | 'revoked_at' | 'expires_at'
  >;
  if (record.revoked_at) {
    throw new BreakdownServiceError('unauthorized', 'Integration token has been revoked', 401);
  }
  if (record.expires_at && new Date(record.expires_at).getTime() <= Date.now()) {
    throw new BreakdownServiceError('unauthorized', 'Integration token has expired', 401);
  }

  await supabase
    .from('integration_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', record.id)
    .is('revoked_at', null);

  return {
    userId: record.user_id,
    source: 'integration-token',
    scopes: record.scopes,
    tokenId: record.id,
    tokenName: record.name,
  };
}

export async function revokeIntegrationToken(
  supabase: SupabaseClient,
  actor: { userId: string },
  input: z.input<typeof revokeIntegrationTokenSchema>,
): Promise<void> {
  const parsed = revokeIntegrationTokenSchema.safeParse(input);
  if (!parsed.success) {
    throw new BreakdownServiceError(
      'validation_error',
      parsed.error.message,
      400,
      parsed.error.flatten(),
    );
  }

  const { error } = await supabase
    .from('integration_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', parsed.data.tokenId)
    .eq('user_id', actor.userId)
    .is('revoked_at', null);

  if (error) {
    throw new BreakdownServiceError('database_error', error.message, 400);
  }
}

export async function revokeActiveIntegrationTokensByPurpose(
  supabase: SupabaseClient,
  actor: { userId: string },
  input: z.input<typeof revokeIntegrationTokensByPurposeSchema>,
): Promise<void> {
  const parsed = revokeIntegrationTokensByPurposeSchema.safeParse(input);
  if (!parsed.success) {
    throw new BreakdownServiceError(
      'validation_error',
      parsed.error.message,
      400,
      parsed.error.flatten(),
    );
  }

  const { error } = await supabase
    .from('integration_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('user_id', actor.userId)
    .eq('purpose', parsed.data.purpose)
    .is('revoked_at', null);

  if (error) {
    throw new BreakdownServiceError('database_error', error.message, 400);
  }
}

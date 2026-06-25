import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { BreakdownServiceError } from './errors';
import { resolveIntegrationToken } from './tokens';
import { ALL_BREAKDOWN_SCOPES, type BreakdownScope } from './scopes';

export type BreakdownActorSource = 'clerk-session' | 'integration-token' | 'oauth-client';

export interface BreakdownActor {
  userId: string;
  source: BreakdownActorSource;
  scopes: BreakdownScope[];
  tokenId?: string;
  tokenName?: string;
  clientId?: string;
}

export const actorSourceSchema = z.enum(['clerk-session', 'integration-token', 'oauth-client']);

export async function resolveClerkActor(
  scopes: BreakdownScope[] = ALL_BREAKDOWN_SCOPES,
): Promise<BreakdownActor> {
  const { userId } = await auth();
  if (!userId) {
    throw new BreakdownServiceError('unauthorized', 'Unauthorized', 401);
  }

  return {
    userId,
    source: 'clerk-session',
    scopes,
  };
}

export function readBearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) {
    return match[1].trim();
  }

  const url = new URL(request.url);
  const queryToken = url.searchParams.get('access_token') ?? url.searchParams.get('token');
  if (!queryToken) {
    throw new BreakdownServiceError('unauthorized', 'Missing bearer token', 401);
  }

  return queryToken.trim();
}

export async function resolveHeadlessActor(
  request: Request,
  requiredScopes: BreakdownScope | BreakdownScope[],
): Promise<BreakdownActor> {
  const token = readBearerToken(request);
  const supabase = createServerClient();
  const actor = await resolveIntegrationToken(supabase, token);
  const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];

  for (const scope of scopes) {
    requireScope(actor, scope);
  }

  return actor;
}

export function requireScope(actor: BreakdownActor, scope: BreakdownScope) {
  if (!actor.scopes.includes(scope)) {
    throw new BreakdownServiceError('forbidden', `Missing required scope: ${scope}`, 403, {
      requiredScope: scope,
      actorScopes: actor.scopes,
    });
  }
}

export function assertSameUser(actor: BreakdownActor, userId: string) {
  if (actor.userId !== userId) {
    throw new BreakdownServiceError('not_found', 'Resource not found', 404);
  }
}

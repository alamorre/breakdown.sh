import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { ThesisServiceError } from './errors';
import { resolveIntegrationToken } from './tokens';
import { ALL_THESIS_SCOPES, type ThesisScope } from './scopes';

export type ThesisActorSource = 'clerk-session' | 'integration-token' | 'oauth-client';

export interface ThesisActor {
  userId: string;
  source: ThesisActorSource;
  scopes: ThesisScope[];
  tokenId?: string;
  tokenName?: string;
  clientId?: string;
}

export const actorSourceSchema = z.enum(['clerk-session', 'integration-token', 'oauth-client']);

export async function resolveClerkActor(scopes: ThesisScope[] = ALL_THESIS_SCOPES): Promise<ThesisActor> {
  const { userId } = await auth();
  if (!userId) {
    throw new ThesisServiceError('unauthorized', 'Unauthorized', 401);
  }

  return {
    userId,
    source: 'clerk-session',
    scopes,
  };
}

function readBearerToken(request: Request): string {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) {
    throw new ThesisServiceError('unauthorized', 'Missing bearer token', 401);
  }

  return match[1].trim();
}

export async function resolveHeadlessActor(
  request: Request,
  requiredScopes: ThesisScope | ThesisScope[],
): Promise<ThesisActor> {
  const token = readBearerToken(request);
  const supabase = createServerClient();
  const actor = await resolveIntegrationToken(supabase, token);
  const scopes = Array.isArray(requiredScopes) ? requiredScopes : [requiredScopes];

  for (const scope of scopes) {
    requireScope(actor, scope);
  }

  return actor;
}

export function requireScope(actor: ThesisActor, scope: ThesisScope) {
  if (!actor.scopes.includes(scope)) {
    throw new ThesisServiceError(
      'forbidden',
      `Missing required scope: ${scope}`,
      403,
      { requiredScope: scope, actorScopes: actor.scopes },
    );
  }
}

export function assertSameUser(actor: ThesisActor, userId: string) {
  if (actor.userId !== userId) {
    throw new ThesisServiceError('not_found', 'Resource not found', 404);
  }
}

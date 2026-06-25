import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase/server';
import { BreakdownServiceError } from '@/lib/breakdown-service/errors';
import {
  listIntegrationTokens,
  mintIntegrationToken,
  revokeIntegrationToken,
  type PublicIntegrationTokenRecord,
} from '@/lib/breakdown-service/tokens';
import { ALL_BREAKDOWN_SCOPES } from '@/lib/breakdown-service/scopes';

export const dynamic = 'force-dynamic';

function isTokenStorageConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function serializeToken(record: PublicIntegrationTokenRecord) {
  return {
    id: record.id,
    name: record.name,
    tokenPrefix: record.token_prefix,
    scopes: record.scopes,
    purpose: record.purpose,
    createdByUserId: record.created_by_user_id,
    createdAt: record.created_at,
    lastUsedAt: record.last_used_at,
    revokedAt: record.revoked_at,
    expiresAt: record.expires_at,
  };
}

function errorResponse(err: unknown) {
  if (err instanceof BreakdownServiceError) {
    return Response.json({ error: err.message }, { status: err.status });
  }

  return Response.json(
    { error: err instanceof Error ? err.message : 'Failed to rotate integration token' },
    { status: 500 },
  );
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isTokenStorageConfigured()) {
    return Response.json(
      {
        configured: false,
        scopes: ALL_BREAKDOWN_SCOPES,
        error: 'Integration token storage is not configured for this deployment.',
      },
      { status: 400 },
    );
  }

  const { tokenId } = await params;

  try {
    const supabase = createServerClient();
    const currentTokens = await listIntegrationTokens(supabase, userId);
    const currentToken = currentTokens.find((token) => token.id === tokenId);

    if (!currentToken) {
      throw new BreakdownServiceError('not_found', 'Integration token not found', 404);
    }

    const { token, record } = await mintIntegrationToken(supabase, {
      userId,
      name: currentToken.name,
      scopes: currentToken.scopes,
      purpose: currentToken.purpose,
      createdByUserId: userId,
      expiresAt: currentToken.expires_at,
    });

    if (!currentToken.revoked_at) {
      await revokeIntegrationToken(supabase, { userId }, { tokenId: currentToken.id });
    }

    return Response.json(
      {
        token,
        record: serializeToken(record),
        rotatedTokenId: currentToken.id,
      },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

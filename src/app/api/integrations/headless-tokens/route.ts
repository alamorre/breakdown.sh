import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import {
  listIntegrationTokens,
  mintIntegrationToken,
  type PublicIntegrationTokenRecord,
} from '@/lib/breakdown-service/tokens';
import { ALL_BREAKDOWN_SCOPES, BREAKDOWN_SCOPES } from '@/lib/breakdown-service/scopes';
import { BreakdownServiceError } from '@/lib/breakdown-service/errors';

export const dynamic = 'force-dynamic';

const createTokenBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(BREAKDOWN_SCOPES)).min(1).default(ALL_BREAKDOWN_SCOPES),
});

function isTokenStorageConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
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

function storageNotConfiguredResponse(status = 200) {
  return Response.json(
    {
      configured: false,
      scopes: ALL_BREAKDOWN_SCOPES,
      tokens: [],
      error: 'Integration token storage is not configured for this deployment.',
    },
    { status },
  );
}

function errorResponse(err: unknown) {
  if (err instanceof BreakdownServiceError) {
    return Response.json({ error: err.message }, { status: err.status });
  }

  return Response.json(
    { error: err instanceof Error ? err.message : 'Failed to manage integration tokens' },
    { status: 500 },
  );
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isTokenStorageConfigured()) {
    return storageNotConfiguredResponse();
  }

  try {
    const supabase = createServerClient();
    const tokens = await listIntegrationTokens(supabase, userId);
    return Response.json({
      configured: true,
      scopes: ALL_BREAKDOWN_SCOPES,
      tokens: tokens.map(serializeToken),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isTokenStorageConfigured()) {
    return storageNotConfiguredResponse(400);
  }

  const body = createTokenBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return Response.json({ error: body.error.message }, { status: 400 });
  }

  try {
    const supabase = createServerClient();
    const { token, record } = await mintIntegrationToken(supabase, {
      userId,
      name: body.data.name,
      scopes: body.data.scopes,
    });

    return Response.json(
      {
        token,
        record: serializeToken(record),
      },
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { BreakdownServiceError } from '@/lib/breakdown-service/errors';
import {
  renameIntegrationToken,
  revokeIntegrationToken,
  type PublicIntegrationTokenRecord,
} from '@/lib/breakdown-service/tokens';

export const dynamic = 'force-dynamic';

const renameTokenBodySchema = z.object({
  name: z.string().trim().min(1).max(100),
});

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
    { error: err instanceof Error ? err.message : 'Failed to manage integration token' },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = renameTokenBodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return Response.json({ error: body.error.message }, { status: 400 });
  }

  const { tokenId } = await params;

  try {
    const supabase = createServerClient();
    const record = await renameIntegrationToken(
      supabase,
      { userId },
      { tokenId, name: body.data.name },
    );
    return Response.json({ token: serializeToken(record) });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { tokenId } = await params;

  try {
    const supabase = createServerClient();
    await revokeIntegrationToken(supabase, { userId }, { tokenId });
    return Response.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

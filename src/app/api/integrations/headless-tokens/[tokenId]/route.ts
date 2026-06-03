import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase/server';
import { ThesisServiceError } from '@/lib/thesis-service/errors';
import { revokeIntegrationToken } from '@/lib/thesis-service/tokens';

export const dynamic = 'force-dynamic';

function errorResponse(err: unknown) {
  if (err instanceof ThesisServiceError) {
    return Response.json({ error: err.message }, { status: err.status });
  }

  return Response.json(
    { error: err instanceof Error ? err.message : 'Failed to revoke integration token' },
    { status: 500 },
  );
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

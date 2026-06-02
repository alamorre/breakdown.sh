import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  getActiveGoogleDriveConnection,
  getValidGoogleDriveAccessToken,
} from '@/lib/integrations/google-drive/connections';
import { isGoogleDriveConfigured } from '@/lib/integrations/google-drive/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configured = isGoogleDriveConfigured();
  if (!configured) {
    return Response.json({
      configured,
      connected: false,
      connection: null,
    });
  }

  const supabase = createServerClient();
  const connection = await getActiveGoogleDriveConnection(supabase, userId);

  return Response.json({
    configured,
    connected: Boolean(connection),
    connection: connection
      ? {
          id: connection.id,
          accountEmail: connection.account_email,
          scopes: connection.scopes,
          lastConnectedAt: connection.last_connected_at,
          lastRefreshAt: connection.last_refresh_at,
          expiresAt: connection.access_token_expires_at,
        }
      : null,
  });
}

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isGoogleDriveConfigured()) {
    return Response.json({ error: 'Google Drive is not configured' }, { status: 400 });
  }

  const supabase = createServerClient();
  const connection = await getActiveGoogleDriveConnection(supabase, userId);
  if (!connection) {
    return Response.json({ error: 'Google Drive is not connected' }, { status: 404 });
  }

  try {
    await getValidGoogleDriveAccessToken(supabase, connection);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to refresh Google Drive token' },
      { status: 400 },
    );
  }
}

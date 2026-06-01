import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  getActiveGoogleDriveConnection,
  getValidGoogleDriveAccessToken,
} from '@/lib/integrations/google-drive/connections';
import { getGoogleDrivePickerConfig } from '@/lib/integrations/google-drive/config';

export const dynamic = 'force-dynamic';

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  const connection = await getActiveGoogleDriveConnection(supabase, userId);
  if (!connection) {
    return Response.json({ error: 'Google Drive is not connected' }, { status: 404 });
  }

  try {
    const accessToken = await getValidGoogleDriveAccessToken(supabase, connection);
    const pickerConfig = getGoogleDrivePickerConfig();

    return Response.json({
      accessToken,
      apiKey: pickerConfig.apiKey,
      appId: pickerConfig.appId,
      connection: {
        id: connection.id,
        accountEmail: connection.account_email,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : 'Failed to prepare Google Drive picker' },
      { status: 400 },
    );
  }
}

import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase/server';
import { disconnectGoogleDrive } from '@/lib/integrations/google-drive/connections';

export const dynamic = 'force-dynamic';

export async function POST() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServerClient();
  await disconnectGoogleDrive(supabase, { userId });

  return Response.json({ ok: true });
}

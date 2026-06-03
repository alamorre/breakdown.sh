import { auth } from '@clerk/nextjs/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  getAiProviderCredentialsSetupError,
  hasAiProviderCredentialEncryption,
  isMissingAiProviderCredentialsTableError,
  listAiProviderCredentialStatuses,
} from '@/lib/ai/credentials';

export const dynamic = 'force-dynamic';

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const configured = hasAiProviderCredentialEncryption();
  if (!configured) {
    return Response.json({
      configured,
      providers: [],
      error: 'Stored provider keys are not configured for this deployment.',
    });
  }

  try {
    const supabase = createServerClient();
    const providers = await listAiProviderCredentialStatuses(supabase, userId);
    return Response.json({ configured, providers });
  } catch (err) {
    return Response.json(
      {
        configured,
        providers: [],
        error: getAiProviderCredentialsSetupError(err),
      },
      { status: isMissingAiProviderCredentialsTableError(err) ? 503 : 500 },
    );
  }
}

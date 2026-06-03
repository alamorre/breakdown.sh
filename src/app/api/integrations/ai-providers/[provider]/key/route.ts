import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import {
  getAiProviderCredentialsSetupError,
  getActiveAiProviderCredential,
  hasAiProviderCredentialEncryption,
  isMissingAiProviderCredentialsTableError,
  removeAiProviderCredential,
  upsertAiProviderCredential,
  validateAiProviderApiKey,
} from '@/lib/ai/credentials';
import { getAiProviderOption, isAiProviderId, type AiProviderId } from '@/lib/ai/models';
import { createServerClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  apiKey: z.string().trim().min(8).max(500),
});

async function getProvider(params: Promise<{ provider: string }>): Promise<AiProviderId | null> {
  const { provider } = await params;
  return isAiProviderId(provider) ? provider : null;
}

function credentialResponse(
  credential: {
    id: string;
    api_key_hint: string;
    last_validated_at: string | null;
    updated_at: string;
  } | null,
) {
  return {
    connected: Boolean(credential),
    credential: credential
      ? {
          id: credential.id,
          apiKeyHint: credential.api_key_hint,
          lastValidatedAt: credential.last_validated_at,
          updatedAt: credential.updated_at,
        }
      : null,
  };
}

export async function PUT(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const providerId = await getProvider(params);
  if (!providerId) {
    return Response.json({ error: 'Unknown AI provider' }, { status: 404 });
  }

  if (!hasAiProviderCredentialEncryption()) {
    return Response.json(
      { error: 'Stored provider keys are not configured for this deployment.' },
      { status: 400 },
    );
  }

  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return Response.json({ error: body.error.message }, { status: 400 });
  }

  const provider = getAiProviderOption(providerId);
  const isValid = await validateAiProviderApiKey(providerId, body.data.apiKey);
  if (!isValid) {
    return Response.json(
      { error: `${provider.label} could not validate that API key.` },
      { status: 400 },
    );
  }

  try {
    const supabase = createServerClient();
    const credential = await upsertAiProviderCredential(supabase, {
      userId,
      providerId,
      apiKey: body.data.apiKey,
    });

    return Response.json(credentialResponse(credential));
  } catch (err) {
    return Response.json(
      { error: getAiProviderCredentialsSetupError(err) },
      { status: isMissingAiProviderCredentialsTableError(err) ? 503 : 400 },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const providerId = await getProvider(params);
  if (!providerId) {
    return Response.json({ error: 'Unknown AI provider' }, { status: 404 });
  }

  try {
    const supabase = createServerClient();
    await removeAiProviderCredential(supabase, { userId, providerId });
    const credential = await getActiveAiProviderCredential(supabase, { userId, providerId });

    return Response.json(credentialResponse(credential));
  } catch (err) {
    return Response.json(
      { error: getAiProviderCredentialsSetupError(err) },
      { status: isMissingAiProviderCredentialsTableError(err) ? 503 : 400 },
    );
  }
}

import type { createServerClient } from '@/lib/supabase/server';
import { createClaudeClient } from '@/lib/ai/claude';
import {
  AI_PROVIDER_OPTIONS,
  getAiProviderOption,
  isAiProviderId,
  type AiProviderId,
} from '@/lib/ai/models';
import { decryptSecret, encryptSecret } from '@/lib/security/crypto';
import {
  getIntegrationTokenEncryptionKey,
  hasIntegrationTokenEncryptionKey,
} from '@/lib/security/encryption-key';

export const AI_PROVIDER_CREDENTIALS_MIGRATION =
  'supabase/migrations/20260603000000_user_ai_provider_credentials.sql';

export type UserAiProviderCredential = {
  id: string;
  user_id: string;
  provider: AiProviderId;
  encrypted_api_key: string;
  api_key_hint: string;
  last_validated_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

type SupabaseClient = ReturnType<typeof createServerClient>;

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

export function isMissingAiProviderCredentialsTableError(err: unknown): boolean {
  const message = getErrorMessage(err).toLowerCase();

  return (
    message.includes('user_ai_provider_credentials') &&
    (message.includes('does not exist') ||
      message.includes('schema cache') ||
      message.includes('could not find') ||
      message.includes('42p01') ||
      message.includes('pgrst205'))
  );
}

export function getAiProviderCredentialsSetupError(err: unknown): string {
  if (isMissingAiProviderCredentialsTableError(err)) {
    return `AI provider key storage is not ready. Apply ${AI_PROVIDER_CREDENTIALS_MIGRATION}.`;
  }

  return err instanceof Error ? err.message : 'AI provider credentials could not be loaded.';
}

export function getProviderSetupPrompt(providerId: AiProviderId): string {
  const provider = getAiProviderOption(providerId);
  return `Add your ${provider.label} API key in Settings before running ${provider.label} models.`;
}

export function hasAiProviderCredentialEncryption(): boolean {
  return hasIntegrationTokenEncryptionKey();
}

export function getApiKeyHint(apiKey: string): string {
  const trimmed = apiKey.trim();
  return trimmed.length <= 4 ? 'saved' : `ending in ${trimmed.slice(-4)}`;
}

export async function getActiveAiProviderCredential(
  supabase: SupabaseClient,
  input: { userId: string; providerId: AiProviderId },
): Promise<UserAiProviderCredential | null> {
  const { data, error } = await supabase
    .from('user_ai_provider_credentials')
    .select('*')
    .eq('user_id', input.userId)
    .eq('provider', input.providerId)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as UserAiProviderCredential | null) ?? null;
}

export async function listAiProviderCredentialStatuses(
  supabase: SupabaseClient,
  userId: string,
): Promise<
  Array<{
    provider: AiProviderId;
    connected: boolean;
    credential: {
      id: string;
      apiKeyHint: string;
      lastValidatedAt: string | null;
      updatedAt: string;
    } | null;
  }>
> {
  const { data, error } = await supabase
    .from('user_ai_provider_credentials')
    .select('id,provider,api_key_hint,last_validated_at,updated_at')
    .eq('user_id', userId)
    .is('revoked_at', null);

  if (error) {
    throw new Error(error.message);
  }

  const byProvider = new Map(
    (
      (data ?? []) as Array<{
        id: string;
        provider: string;
        api_key_hint: string;
        last_validated_at: string | null;
        updated_at: string;
      }>
    )
      .filter((row) => isAiProviderId(row.provider))
      .map((row) => [
        row.provider,
        {
          id: row.id,
          apiKeyHint: row.api_key_hint,
          lastValidatedAt: row.last_validated_at,
          updatedAt: row.updated_at,
        },
      ]),
  );

  return AI_PROVIDER_OPTIONS.map((providerOption) => {
    const provider = providerOption.id;
    const credential = byProvider.get(provider);
    return {
      provider,
      connected: Boolean(credential),
      credential: credential ?? null,
    };
  });
}

export async function upsertAiProviderCredential(
  supabase: SupabaseClient,
  input: {
    userId: string;
    providerId: AiProviderId;
    apiKey: string;
  },
): Promise<UserAiProviderCredential> {
  const encryptionKey = getIntegrationTokenEncryptionKey();
  const now = new Date().toISOString();
  const payload = {
    user_id: input.userId,
    provider: input.providerId,
    encrypted_api_key: encryptSecret(input.apiKey, encryptionKey),
    api_key_hint: getApiKeyHint(input.apiKey),
    last_validated_at: now,
    revoked_at: null,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('user_ai_provider_credentials')
    .upsert(payload, { onConflict: 'user_id,provider' })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to save AI provider key');
  }

  return data as UserAiProviderCredential;
}

export async function removeAiProviderCredential(
  supabase: SupabaseClient,
  input: { userId: string; providerId: AiProviderId },
): Promise<void> {
  const { error } = await supabase
    .from('user_ai_provider_credentials')
    .update({
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .eq('provider', input.providerId)
    .is('revoked_at', null);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getUserAiProviderApiKey(
  supabase: SupabaseClient,
  input: { userId: string; providerId: AiProviderId },
): Promise<string | null> {
  const credential = await getActiveAiProviderCredential(supabase, input);
  if (!credential) {
    return null;
  }

  return decryptSecret(
    credential.encrypted_api_key,
    getIntegrationTokenEncryptionKey(),
    `${credential.provider} API key`,
  );
}

async function validateAnthropicKey(apiKey: string): Promise<boolean> {
  try {
    await createClaudeClient(apiKey).models.list({ limit: 1 });
    return true;
  } catch {
    return false;
  }
}

async function validateOpenAiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function validateGeminiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
      headers: { 'x-goog-api-key': apiKey },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function validateAiProviderApiKey(
  providerId: AiProviderId,
  apiKey: string,
): Promise<boolean> {
  switch (providerId) {
    case 'anthropic':
      return validateAnthropicKey(apiKey);
    case 'openai':
      return validateOpenAiKey(apiKey);
    case 'gemini':
      return validateGeminiKey(apiKey);
  }
}

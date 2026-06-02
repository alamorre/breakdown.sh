import type { createServerClient } from '@/lib/supabase/server';
import {
  decryptGoogleDriveToken,
  encryptGoogleDriveToken,
} from '@/lib/integrations/google-drive/crypto';
import { getGoogleDriveServerConfig } from '@/lib/integrations/google-drive/config';
import {
  getTokenExpiry,
  parseScopeList,
  refreshGoogleDriveAccessToken,
  type GoogleOAuthTokenResponse,
  type GoogleUserInfo,
} from '@/lib/integrations/google-drive/oauth';

export type GoogleDriveConnection = {
  id: string;
  user_id: string;
  google_subject: string;
  account_email: string;
  scopes: string[];
  encrypted_access_token: string | null;
  encrypted_refresh_token: string;
  access_token_expires_at: string | null;
  last_connected_at: string;
  last_refresh_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

type SupabaseClient = ReturnType<typeof createServerClient>;

function isAccessTokenFresh(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return false;

  return expiresMs - Date.now() > 60_000;
}

export async function getActiveGoogleDriveConnection(
  supabase: SupabaseClient,
  userId: string,
): Promise<GoogleDriveConnection | null> {
  const { data, error } = await supabase
    .from('google_drive_connections')
    .select('*')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('last_connected_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as GoogleDriveConnection | null) ?? null;
}

export async function getGoogleDriveConnectionById(
  supabase: SupabaseClient,
  input: { userId: string; connectionId: string },
): Promise<GoogleDriveConnection | null> {
  const { data, error } = await supabase
    .from('google_drive_connections')
    .select('*')
    .eq('id', input.connectionId)
    .eq('user_id', input.userId)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as GoogleDriveConnection | null) ?? null;
}

export async function upsertGoogleDriveConnection(
  supabase: SupabaseClient,
  input: {
    userId: string;
    token: GoogleOAuthTokenResponse;
    userInfo: GoogleUserInfo;
  },
): Promise<GoogleDriveConnection> {
  if (!input.token.refresh_token) {
    throw new Error('Google did not return a refresh token. Try connecting Google Drive again.');
  }

  const { encryptionKey } = getGoogleDriveServerConfig();
  const now = new Date().toISOString();
  const payload = {
    user_id: input.userId,
    google_subject: input.userInfo.sub,
    account_email: input.userInfo.email,
    scopes: parseScopeList(input.token.scope),
    encrypted_access_token: encryptGoogleDriveToken(input.token.access_token, encryptionKey),
    encrypted_refresh_token: encryptGoogleDriveToken(input.token.refresh_token, encryptionKey),
    access_token_expires_at: getTokenExpiry(input.token.expires_in),
    last_connected_at: now,
    last_refresh_at: now,
    revoked_at: null,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('google_drive_connections')
    .upsert(payload, { onConflict: 'user_id,google_subject' })
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to save Google Drive connection');
  }

  return data as GoogleDriveConnection;
}

export async function disconnectGoogleDrive(
  supabase: SupabaseClient,
  input: { userId: string },
): Promise<void> {
  const { error } = await supabase
    .from('google_drive_connections')
    .update({
      revoked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', input.userId)
    .is('revoked_at', null);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getValidGoogleDriveAccessToken(
  supabase: SupabaseClient,
  connection: GoogleDriveConnection,
): Promise<string> {
  const { encryptionKey } = getGoogleDriveServerConfig();

  if (connection.encrypted_access_token && isAccessTokenFresh(connection.access_token_expires_at)) {
    return decryptGoogleDriveToken(connection.encrypted_access_token, encryptionKey);
  }

  const refreshToken = decryptGoogleDriveToken(connection.encrypted_refresh_token, encryptionKey);
  const refreshed = await refreshGoogleDriveAccessToken(refreshToken);
  const encryptedAccessToken = encryptGoogleDriveToken(refreshed.access_token, encryptionKey);
  const expiresAt = getTokenExpiry(refreshed.expires_in);
  const now = new Date().toISOString();

  const { error } = await supabase
    .from('google_drive_connections')
    .update({
      encrypted_access_token: encryptedAccessToken,
      access_token_expires_at: expiresAt,
      last_refresh_at: now,
      updated_at: now,
    })
    .eq('id', connection.id);

  if (error) {
    throw new Error(error.message);
  }

  connection.encrypted_access_token = encryptedAccessToken;
  connection.access_token_expires_at = expiresAt;
  connection.last_refresh_at = now;
  connection.updated_at = now;

  return refreshed.access_token;
}

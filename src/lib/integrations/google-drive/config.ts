import {
  getIntegrationTokenEncryptionKey,
  hasIntegrationTokenEncryptionKey,
  PRIMARY_KEY_NAME,
} from '@/lib/security/encryption-key';

export const GOOGLE_DRIVE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
] as const;

export const GOOGLE_DRIVE_OAUTH_STATE_COOKIE = 'breakdown_google_drive_oauth_state';
export const GOOGLE_DRIVE_OAUTH_RETURN_COOKIE = 'breakdown_google_drive_oauth_return_to';

export type GoogleDriveServerConfig = {
  clientId: string;
  clientSecret: string;
  encryptionKey: string;
};

export type GoogleDrivePickerConfig = {
  apiKey: string;
  appId: string;
};

export function getGoogleDriveServerConfig(): GoogleDriveServerConfig {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  if (!clientId || !clientSecret || !hasIntegrationTokenEncryptionKey()) {
    throw new Error(
      `Missing Google Drive server configuration. Set GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, and ${PRIMARY_KEY_NAME}.`,
    );
  }

  return { clientId, clientSecret, encryptionKey: getIntegrationTokenEncryptionKey() };
}

export function getGoogleDrivePickerConfig(): GoogleDrivePickerConfig {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY;
  const appId = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_APP_ID;

  if (!apiKey || !appId) {
    throw new Error(
      'Missing Google Drive Picker configuration. Set NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY and NEXT_PUBLIC_GOOGLE_DRIVE_APP_ID.',
    );
  }

  return { apiKey, appId };
}

export function isGoogleDriveConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_DRIVE_CLIENT_ID &&
    process.env.GOOGLE_DRIVE_CLIENT_SECRET &&
    hasIntegrationTokenEncryptionKey() &&
    process.env.NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY &&
    process.env.NEXT_PUBLIC_GOOGLE_DRIVE_APP_ID,
  );
}

export function getGoogleDriveRedirectUri(requestUrl: string): string {
  return new URL('/api/integrations/google-drive/callback', requestUrl).toString();
}

export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value) return '/dashboard';

  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('/') && !decoded.startsWith('//')) {
      return decoded;
    }
  } catch {
    if (value.startsWith('/') && !value.startsWith('//')) {
      return value;
    }
  }

  return '/dashboard';
}

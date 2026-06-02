import { GOOGLE_DRIVE_SCOPES, getGoogleDriveServerConfig } from './config';

const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

export type GoogleOAuthTokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  id_token?: string;
};

export type GoogleUserInfo = {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
};

export function buildGoogleDriveAuthorizationUrl(input: {
  redirectUri: string;
  state: string;
}): string {
  const { clientId } = getGoogleDriveServerConfig();
  const url = new URL(GOOGLE_OAUTH_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_DRIVE_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', input.state);

  return url.toString();
}

export async function exchangeGoogleDriveCode(input: {
  code: string;
  redirectUri: string;
}): Promise<GoogleOAuthTokenResponse> {
  const { clientId, clientSecret } = getGoogleDriveServerConfig();
  const body = new URLSearchParams({
    code: input.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = (await response.json().catch(() => null)) as GoogleOAuthTokenResponse | null;
  if (!response.ok || !data?.access_token) {
    throw new Error('Failed to connect Google Drive');
  }

  return data;
}

export async function refreshGoogleDriveAccessToken(
  refreshToken: string,
): Promise<GoogleOAuthTokenResponse> {
  const { clientId, clientSecret } = getGoogleDriveServerConfig();
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  });

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const data = (await response.json().catch(() => null)) as GoogleOAuthTokenResponse | null;
  if (!response.ok || !data?.access_token) {
    throw new Error('Reconnect Google Drive to continue.');
  }

  return data;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<GoogleUserInfo> {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const data = (await response.json().catch(() => null)) as GoogleUserInfo | null;
  if (!response.ok || !data?.sub || !data?.email) {
    throw new Error('Failed to load connected Google account');
  }

  return data;
}

export function getTokenExpiry(expiresInSeconds: number | undefined): string {
  const expiresIn = expiresInSeconds ?? 3600;
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

export function parseScopeList(scopeText: string | undefined): string[] {
  if (!scopeText) return [...GOOGLE_DRIVE_SCOPES];
  return scopeText.split(/\s+/).filter(Boolean);
}

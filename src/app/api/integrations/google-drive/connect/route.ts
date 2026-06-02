import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import {
  GOOGLE_DRIVE_OAUTH_RETURN_COOKIE,
  GOOGLE_DRIVE_OAUTH_STATE_COOKIE,
  getGoogleDriveRedirectUri,
  isGoogleDriveConfigured,
  sanitizeReturnTo,
} from '@/lib/integrations/google-drive/config';
import { buildGoogleDriveAuthorizationUrl } from '@/lib/integrations/google-drive/oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }

  const requestUrl = new URL(request.url);
  const returnTo = sanitizeReturnTo(requestUrl.searchParams.get('returnTo'));
  if (!isGoogleDriveConfigured()) {
    const redirectUrl = new URL(returnTo, request.url);
    redirectUrl.searchParams.set('googleDrive', 'error');
    return NextResponse.redirect(redirectUrl);
  }

  const state = crypto.randomUUID();
  const redirectUri = getGoogleDriveRedirectUri(request.url);
  const authUrl = buildGoogleDriveAuthorizationUrl({ redirectUri, state });
  const response = NextResponse.redirect(authUrl);

  response.cookies.set(GOOGLE_DRIVE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: requestUrl.protocol === 'https:',
    path: '/',
    maxAge: 10 * 60,
  });
  response.cookies.set(GOOGLE_DRIVE_OAUTH_RETURN_COOKIE, returnTo, {
    httpOnly: true,
    sameSite: 'lax',
    secure: requestUrl.protocol === 'https:',
    path: '/',
    maxAge: 10 * 60,
  });

  return response;
}

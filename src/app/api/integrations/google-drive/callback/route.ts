import { auth } from '@clerk/nextjs/server';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import {
  GOOGLE_DRIVE_OAUTH_RETURN_COOKIE,
  GOOGLE_DRIVE_OAUTH_STATE_COOKIE,
  getGoogleDriveRedirectUri,
  sanitizeReturnTo,
} from '@/lib/integrations/google-drive/config';
import {
  exchangeGoogleDriveCode,
  fetchGoogleUserInfo,
} from '@/lib/integrations/google-drive/oauth';
import { upsertGoogleDriveConnection } from '@/lib/integrations/google-drive/connections';

export const dynamic = 'force-dynamic';

function redirectWithStatus(requestUrl: string, returnTo: string, status: 'connected' | 'error') {
  const redirectUrl = new URL(returnTo, requestUrl);
  redirectUrl.searchParams.set('googleDrive', status);
  return NextResponse.redirect(redirectUrl);
}

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', request.url));
  }

  const cookieStore = await cookies();
  const returnTo = sanitizeReturnTo(cookieStore.get(GOOGLE_DRIVE_OAUTH_RETURN_COOKIE)?.value);
  const responseWithCookiesCleared = (response: NextResponse) => {
    response.cookies.delete(GOOGLE_DRIVE_OAUTH_STATE_COOKIE);
    response.cookies.delete(GOOGLE_DRIVE_OAUTH_RETURN_COOKIE);
    return response;
  };

  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  const expectedState = cookieStore.get(GOOGLE_DRIVE_OAUTH_STATE_COOKIE)?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return responseWithCookiesCleared(redirectWithStatus(request.url, returnTo, 'error'));
  }

  try {
    const token = await exchangeGoogleDriveCode({
      code,
      redirectUri: getGoogleDriveRedirectUri(request.url),
    });
    const userInfo = await fetchGoogleUserInfo(token.access_token);
    const supabase = createServerClient();
    await upsertGoogleDriveConnection(supabase, { userId, token, userInfo });

    return responseWithCookiesCleared(redirectWithStatus(request.url, returnTo, 'connected'));
  } catch {
    return responseWithCookiesCleared(redirectWithStatus(request.url, returnTo, 'error'));
  }
}

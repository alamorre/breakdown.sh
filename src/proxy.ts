import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

const isPublicRoute = createRouteMatcher([
  '/',
  '/.well-known/ai-plugin.json',
  '/.well-known/openapi.json',
  '/api',
  '/docs(.*)',
  '/mcp',
  '/openapi.json',
  '/privacy',
  '/terms-of-service',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/headless(.*)',
  '/api/integrations/agent-setup-sessions(.*)',
  '/api/integrations/headless-onboarding(.*)',
  '/api/mcp(.*)',
]);

export const proxy = clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    const { userId } = await auth();
    if (!userId) {
      const signInUrl = new URL('/sign-in', request.url);
      signInUrl.searchParams.set('redirect_url', request.url);
      return NextResponse.redirect(signInUrl);
    }
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};

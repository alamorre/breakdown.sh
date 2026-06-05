import { createServerClient } from '@/lib/supabase/server';
import { BreakdownServiceError, getErrorResponse } from '@/lib/breakdown-service/errors';
import { createAgentSetupSession } from '@/lib/breakdown-service/agent-setup-sessions';
import { getExternalConsoleOnboardingMetadata } from '@/lib/headless/onboarding';

export const dynamic = 'force-dynamic';

const SETUP_RATE_LIMIT_WINDOW_MS = 60_000;
const SETUP_RATE_LIMIT_MAX = 20;
const setupRateLimits = new Map<string, { count: number; resetAt: number }>();

function isTokenStorageConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function originFor(request: Request) {
  return new URL(request.url).origin;
}

function clientKeyFor(request: Request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function checkSetupRateLimit(request: Request) {
  const key = clientKeyFor(request);
  const now = Date.now();
  const bucket = setupRateLimits.get(key);

  if (!bucket || bucket.resetAt <= now) {
    setupRateLimits.set(key, { count: 1, resetAt: now + SETUP_RATE_LIMIT_WINDOW_MS });
    return;
  }

  bucket.count += 1;
  if (bucket.count > SETUP_RATE_LIMIT_MAX) {
    throw new BreakdownServiceError('rate_limited', 'Too many agent setup requests', 429, {
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    });
  }
}

function storageNotConfiguredResponse() {
  return Response.json(
    {
      error: {
        code: 'validation_error',
        message: 'Integration token storage is not configured for this deployment.',
      },
    },
    { status: 400 },
  );
}

function errorResponse(err: unknown) {
  const error = getErrorResponse(err);
  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    },
    { status: error.status },
  );
}

export async function GET(request: Request) {
  const origin = originFor(request);
  return Response.json({
    configured: isTokenStorageConfigured(),
    ...getExternalConsoleOnboardingMetadata(origin),
  });
}

export async function POST(request: Request) {
  if (!isTokenStorageConfigured()) {
    return storageNotConfiguredResponse();
  }

  try {
    checkSetupRateLimit(request);
    const body = await request.json().catch(() => ({}));
    const supabase = createServerClient();
    return Response.json(await createAgentSetupSession(supabase, body, originFor(request)), {
      status: 201,
    });
  } catch (err) {
    return errorResponse(err);
  }
}

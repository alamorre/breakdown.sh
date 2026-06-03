import { createServerClient } from '@/lib/supabase/server';
import { getExternalConsoleOnboardingMetadata } from '@/lib/headless/onboarding';
import { resolveClerkActor } from '@/lib/thesis-service/actor';
import { getErrorResponse } from '@/lib/thesis-service/errors';
import { bootstrapExternalConsoleForActor } from '@/lib/thesis-service/onboarding';

export const dynamic = 'force-dynamic';

function isTokenStorageConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function originFor(request: Request) {
  return new URL(request.url).origin;
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
  return Response.json({
    configured: isTokenStorageConfigured(),
    ...getExternalConsoleOnboardingMetadata(originFor(request)),
  });
}

export async function POST(request: Request) {
  try {
    const actor = await resolveClerkActor();
    if (!isTokenStorageConfigured()) {
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

    const body = await request.json().catch(() => ({}));
    const supabase = createServerClient();
    return Response.json(
      await bootstrapExternalConsoleForActor(supabase, actor, body, originFor(request)),
      { status: 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

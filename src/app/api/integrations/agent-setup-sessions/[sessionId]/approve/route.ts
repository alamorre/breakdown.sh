import { createServerClient } from '@/lib/supabase/server';
import { resolveClerkActor } from '@/lib/breakdown-service/actor';
import { getErrorResponse } from '@/lib/breakdown-service/errors';
import { approveAgentSetupSession } from '@/lib/breakdown-service/agent-setup-sessions';

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
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

    const { sessionId } = await params;
    const body = await request.json().catch(() => ({}));
    const supabase = createServerClient();
    return Response.json(
      await approveAgentSetupSession(supabase, actor, { sessionId }, body, originFor(request)),
    );
  } catch (err) {
    return errorResponse(err);
  }
}

import { blockExternalStepForActor } from '@/lib/breakdown-service/external-runs';
import { blockExternalStepSchema } from '@/lib/breakdown-service/schemas';
import { withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string; stepId: string }> },
) {
  const { runId, stepId } = await params;
  return withHeadlessJson(
    request,
    'runs:write_results',
    blockExternalStepSchema,
    (actor, body) => blockExternalStepForActor(actor, runId, stepId, body),
    { idempotent: true },
  );
}

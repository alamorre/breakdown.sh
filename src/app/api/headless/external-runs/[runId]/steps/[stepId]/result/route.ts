import { submitExternalStepResultForActor } from '@/lib/thesis-service/external-runs';
import { submitExternalStepResultSchema } from '@/lib/thesis-service/schemas';
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
    submitExternalStepResultSchema,
    (actor, body) => submitExternalStepResultForActor(actor, runId, stepId, body),
    { idempotent: true },
  );
}

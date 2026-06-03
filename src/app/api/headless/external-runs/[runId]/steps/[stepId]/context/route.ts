import { getExternalStepContextForActor } from '@/lib/breakdown-service/external-runs';
import { withHeadlessActor } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string; stepId: string }> },
) {
  const { runId, stepId } = await params;
  return withHeadlessActor(request, 'runs:external_execute', (actor) =>
    getExternalStepContextForActor(actor, runId, stepId),
  );
}

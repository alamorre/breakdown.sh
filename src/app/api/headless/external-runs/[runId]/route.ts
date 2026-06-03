import { getExternalRunForActor } from '@/lib/breakdown-service/external-runs';
import { withHeadlessActor } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return withHeadlessActor(request, 'runs:external_execute', (actor) =>
    getExternalRunForActor(actor, runId),
  );
}

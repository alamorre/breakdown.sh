import { finalizeExternalRunForActor } from '@/lib/breakdown-service/external-runs';
import { finalizeExternalRunSchema } from '@/lib/breakdown-service/schemas';
import { withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  return withHeadlessJson(
    request,
    'runs:external_execute',
    finalizeExternalRunSchema,
    (actor, body) => finalizeExternalRunForActor(actor, runId, body),
  );
}

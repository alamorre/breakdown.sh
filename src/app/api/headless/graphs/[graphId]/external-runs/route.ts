import { createExternalRunForActor } from '@/lib/thesis-service/external-runs';
import { createExternalRunSchema } from '@/lib/thesis-service/schemas';
import { withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  return withHeadlessJson(
    request,
    'runs:external_execute',
    createExternalRunSchema,
    (actor, body) => createExternalRunForActor(actor, graphId, body),
    { idempotent: true },
  );
}

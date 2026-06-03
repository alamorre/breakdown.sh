import { runGraphForActor } from '@/lib/breakdown-service/runs';
import { runGraphSchema } from '@/lib/breakdown-service/schemas';
import { withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  return withHeadlessJson(
    request,
    'runs:execute',
    runGraphSchema.omit({ graphId: true }),
    (actor, body) => runGraphForActor(actor, { graphId, runId: body.runId }),
  );
}

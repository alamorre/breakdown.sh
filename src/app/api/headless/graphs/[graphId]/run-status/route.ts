import { getRunStatusForActor } from '@/lib/thesis-service/runs';
import { withHeadlessActor } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  return withHeadlessActor(request, 'graphs:read', (actor) => getRunStatusForActor(actor, graphId));
}

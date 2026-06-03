import { exportGraphForActor } from '@/lib/breakdown-service/workflows';
import { withHeadlessActor } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  return withHeadlessActor(request, 'graphs:read', (actor) => exportGraphForActor(actor, graphId));
}

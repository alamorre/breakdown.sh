import { cancelGraphRunForActor } from '@/lib/thesis-service/runs';
import { withHeadlessActor } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  return withHeadlessActor(request, 'runs:cancel', (actor) => cancelGraphRunForActor(actor, graphId));
}

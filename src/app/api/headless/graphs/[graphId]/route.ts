import {
  deleteGraphForActor,
  getGraphForActor,
  updateGraphForActor,
} from '@/lib/breakdown-service/graphs';
import { updateGraphSchema } from '@/lib/breakdown-service/schemas';
import { withHeadlessActor, withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  return withHeadlessActor(request, 'graphs:read', (actor) => getGraphForActor(actor, graphId));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ graphId: string }> },
) {
  const { graphId } = await params;
  return withHeadlessJson(
    request,
    'graphs:write',
    updateGraphSchema.omit({ graphId: true }),
    (actor, body) => updateGraphForActor(actor, { graphId, ...body }),
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ graphId: string }> },
) {
  const { graphId } = await params;
  return withHeadlessActor(request, 'graphs:write', async (actor) => {
    await deleteGraphForActor(actor, graphId);
    return { ok: true };
  });
}

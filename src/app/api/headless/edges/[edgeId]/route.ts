import { deleteEdgeForActor, updateEdgeForActor } from '@/lib/thesis-service/edges';
import { updateEdgeSchema } from '@/lib/thesis-service/schemas';
import { withHeadlessActor, withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ edgeId: string }> },
) {
  const { edgeId } = await params;
  return withHeadlessJson(request, 'graphs:write', updateEdgeSchema.omit({ edgeId: true }), (actor, body) =>
    updateEdgeForActor(actor, { edgeId, ...body }),
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ edgeId: string }> },
) {
  const { edgeId } = await params;
  return withHeadlessActor(request, 'graphs:write', async (actor) => {
    await deleteEdgeForActor(actor, edgeId);
    return { ok: true };
  });
}

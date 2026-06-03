import { deleteNodeForActor, updateNodeForActor } from '@/lib/thesis-service/nodes';
import { updateNodeSchema } from '@/lib/thesis-service/schemas';
import { withHeadlessActor, withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> },
) {
  const { nodeId } = await params;
  return withHeadlessJson(request, 'graphs:write', updateNodeSchema.omit({ nodeId: true }), (actor, body) =>
    updateNodeForActor(actor, { nodeId, ...body }),
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ nodeId: string }> },
) {
  const { nodeId } = await params;
  return withHeadlessActor(request, 'graphs:write', async (actor) => {
    await deleteNodeForActor(actor, nodeId);
    return { ok: true };
  });
}

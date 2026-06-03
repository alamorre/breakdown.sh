import { createNodeForActor } from '@/lib/thesis-service/nodes';
import { createNodeSchema } from '@/lib/thesis-service/schemas';
import { withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  return withHeadlessJson(
    request,
    'graphs:write',
    createNodeSchema.omit({ graphId: true }),
    (actor, body) => createNodeForActor(actor, { graphId, ...body }),
    { idempotent: true },
  );
}

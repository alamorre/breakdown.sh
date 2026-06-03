import { createEdgeForActor } from '@/lib/thesis-service/edges';
import { createEdgeSchema } from '@/lib/thesis-service/schemas';
import { withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  return withHeadlessJson(
    request,
    'graphs:write',
    createEdgeSchema.omit({ graphId: true }),
    (actor, body) => createEdgeForActor(actor, { graphId, ...body }),
    { idempotent: true },
  );
}

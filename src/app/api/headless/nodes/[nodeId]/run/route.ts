import { runNodeForActor } from '@/lib/breakdown-service/nodes';
import { runNodeSchema } from '@/lib/breakdown-service/schemas';
import { withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ nodeId: string }> }) {
  const { nodeId } = await params;
  return withHeadlessJson(
    request,
    'runs:execute',
    runNodeSchema.omit({ nodeId: true }),
    (actor, body) => runNodeForActor(actor, { nodeId, ...body }),
  );
}

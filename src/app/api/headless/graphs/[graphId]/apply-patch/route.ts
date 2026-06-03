import { applyGraphPatchForActor } from '@/lib/thesis-service/patches';
import { applyGraphPatchSchema } from '@/lib/thesis-service/schemas';
import { withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ graphId: string }> }) {
  const { graphId } = await params;
  return withHeadlessJson(
    request,
    'graphs:write',
    applyGraphPatchSchema,
    (actor, body) => applyGraphPatchForActor(actor, graphId, body),
    { idempotent: true },
  );
}

import { importGraphForActor } from '@/lib/thesis-service/workflows';
import { importGraphSchema } from '@/lib/thesis-service/schemas';
import { withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return withHeadlessJson(
    request,
    'graphs:write',
    importGraphSchema,
    (actor, body) => importGraphForActor(actor, body),
    { idempotent: true },
  );
}

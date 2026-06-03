import { createGraphForActor, listGraphsForActor } from '@/lib/breakdown-service/graphs';
import { createGraphSchema } from '@/lib/breakdown-service/schemas';
import { withHeadlessActor, withHeadlessJson } from '@/lib/headless/response';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return withHeadlessActor(request, 'graphs:read', (actor) => listGraphsForActor(actor));
}

export async function POST(request: Request) {
  return withHeadlessJson(
    request,
    'graphs:write',
    createGraphSchema,
    (actor, body) => createGraphForActor(actor, body),
    { idempotent: true },
  );
}

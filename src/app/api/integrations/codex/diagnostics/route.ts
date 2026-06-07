import { resolveHeadlessActor } from '@/lib/breakdown-service/actor';
import { checkHeadlessRateLimit } from '@/lib/breakdown-service/safety';
import {
  createCodexAuthFailureDiagnostics,
  createCodexReadyDiagnostics,
} from '@/lib/headless/codex-diagnostics';

export const dynamic = 'force-dynamic';

function originFor(request: Request) {
  return new URL(request.url).origin;
}

export async function GET(request: Request) {
  const origin = originFor(request);

  try {
    const actor = await resolveHeadlessActor(request, []);
    checkHeadlessRateLimit(actor);
    return Response.json({ data: createCodexReadyDiagnostics(actor, origin), error: null });
  } catch (err) {
    return Response.json({ data: createCodexAuthFailureDiagnostics(err, origin), error: null });
  }
}

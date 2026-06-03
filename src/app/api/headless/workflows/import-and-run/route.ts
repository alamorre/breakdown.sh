import { withHeadlessJson } from '@/lib/headless/response';
import {
  importAndRunExternalWorkflowSchema,
  importGraphAndCreateExternalRunForActor,
} from '@/lib/breakdown-service/workflow-runs';

export const dynamic = 'force-dynamic';

function originFor(request: Request) {
  return new URL(request.url).origin;
}

export async function POST(request: Request) {
  return withHeadlessJson(
    request,
    ['graphs:write', 'runs:external_execute'],
    importAndRunExternalWorkflowSchema,
    (actor, body) => importGraphAndCreateExternalRunForActor(actor, body, originFor(request)),
    { idempotent: true },
  );
}

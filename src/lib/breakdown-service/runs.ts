import { createServerClient } from '@/lib/supabase/server';
import { cancelRun } from '@/lib/graph/run-cancellation';
import { getGraphRunStatus, runGraphWithScheduler } from '@/lib/graph/run-graph-execution';
import type { BreakdownActor } from './actor';
import { requireScope } from './actor';
import { BreakdownServiceError } from './errors';
import { assertGraphAccess } from './graphs';
import { auditHeadlessOperation } from './safety';

export async function getRunStatusForActor(actor: BreakdownActor, graphId: string) {
  requireScope(actor, 'graphs:read');
  return getGraphRunStatus(graphId, actor);
}

export async function runGraphForActor(
  actor: BreakdownActor,
  input: { graphId: string; runId: string },
) {
  requireScope(actor, 'runs:execute');
  const result = await runGraphWithScheduler({ ...input, actor });
  const supabase = createServerClient();
  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'graph.run',
    targetType: 'graph',
    targetId: input.graphId,
    graphId: input.graphId,
    requestSummary: { runId: input.runId },
    responseSummary: result.data
      ? {
          total: result.data.metrics.total,
          succeeded: result.data.metrics.succeeded,
          failed: result.data.metrics.failed,
          cancelled: result.data.cancelled,
        }
      : { error: result.error },
  });
  return result;
}

export async function cancelGraphRunForActor(actor: BreakdownActor, graphId: string) {
  requireScope(actor, 'runs:cancel');
  const supabase = createServerClient();
  await assertGraphAccess(supabase, actor, graphId);

  try {
    await cancelRun(supabase, { graphId });
  } catch (err) {
    throw new BreakdownServiceError(
      'execution_error',
      err instanceof Error ? err.message : 'Failed to cancel run',
      400,
    );
  }

  await auditHeadlessOperation(supabase, {
    actor,
    operation: 'graph.run_cancel',
    targetType: 'graph',
    targetId: graphId,
    graphId,
  });

  return { ok: true };
}

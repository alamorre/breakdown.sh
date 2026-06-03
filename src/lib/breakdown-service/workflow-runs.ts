import { z } from 'zod';
import type { BreakdownActor } from './actor';
import { requireScope } from './actor';
import { BreakdownServiceError } from './errors';
import { createExternalRunForActor, getNextExternalStepForActor } from './external-runs';
import { createExternalRunSchema, importGraphSchema } from './schemas';
import { importGraphForActor } from './workflows';

export const importAndRunExternalWorkflowSchema = z.object({
  importGraph: importGraphSchema,
  externalRun: createExternalRunSchema.optional(),
});

function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new BreakdownServiceError(
      'validation_error',
      parsed.error.message,
      400,
      parsed.error.flatten(),
    );
  }
  return parsed.data;
}

function graphUrl(graphId: string, origin?: string) {
  return origin ? `${origin}/graph/${graphId}` : `/graph/${graphId}`;
}

export async function importGraphAndCreateExternalRunForActor(
  actor: BreakdownActor,
  input: unknown,
  origin?: string,
) {
  requireScope(actor, 'graphs:write');
  requireScope(actor, 'runs:external_execute');

  const parsed = parseOrThrow(importAndRunExternalWorkflowSchema, input);
  const imported = await importGraphForActor(actor, parsed.importGraph);
  const run = await createExternalRunForActor(actor, imported.graphId, parsed.externalRun ?? {});
  const nextStep = await getNextExternalStepForActor(actor, run.runId);

  return {
    graphId: imported.graphId,
    graphUrl: graphUrl(imported.graphId, origin),
    nodeIdMap: imported.nodeIdMap,
    edgeCount: imported.edgeCount,
    manifest: run.manifest,
    externalRun: {
      runId: run.runId,
      status: run.status,
      runResourceUri: `breakdown://external-runs/${run.runId}`,
      nextStep,
    },
  };
}

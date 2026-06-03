import { z } from 'zod';
import { type ThesisScope } from '@/lib/thesis-service/scopes';
import { createExternalRunSchema, importGraphSchema } from '@/lib/thesis-service/schemas';

export const EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES = [
  'graphs:read',
  'graphs:write',
  'runs:external_execute',
  'runs:write_results',
] as const satisfies readonly [ThesisScope, ...ThesisScope[]];

const externalConsoleScopeSchema = z.enum(EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES);

export const externalConsoleBootstrapSchema = z.object({
  clientName: z.string().trim().min(1).max(100).default('External console'),
  providerName: z.string().trim().min(1).max(100).optional(),
  tokenName: z.string().trim().min(1).max(100).optional(),
  scopes: z.array(externalConsoleScopeSchema).min(1).default([...EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES]),
  workflow: z
    .object({
      importGraph: importGraphSchema,
      createExternalRun: z.boolean().default(true),
      externalRun: createExternalRunSchema.optional(),
    })
    .optional(),
});

export type ExternalConsoleBootstrapInput = z.input<typeof externalConsoleBootstrapSchema>;
export type ExternalConsoleBootstrapBody = z.output<typeof externalConsoleBootstrapSchema>;

export function getExternalConsoleOnboardingMetadata(origin: string) {
  return {
    name: 'Breakdown',
    version: 'headless-onboarding.v1',
    capabilities: [
      'session_bootstrap',
      'mcp_streamable_http',
      'rest_headless_api',
      'graph_import',
      'external_evaluator_runs',
      'step_result_submit',
      'step_blocked_data_gap',
    ],
    endpoints: {
      signInUrl: `${origin}/sign-in`,
      signUpUrl: `${origin}/sign-up`,
      bootstrapUrl: `${origin}/api/integrations/headless-onboarding`,
      mcpUrl: `${origin}/api/mcp`,
      headlessApiBaseUrl: `${origin}/api/headless`,
    },
    auth: {
      bootstrap: 'clerk-session',
      mcp: 'bearer-token',
      defaultScopes: EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES,
      allowedBootstrapScopes: EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES,
    },
    firstRun: {
      supportedWorkflowModes: ['none', 'importGraph', 'importGraphAndCreateExternalRun'],
      resultShape: ['token', 'sessionContext', 'workflow.graphId', 'workflow.externalRun.runId'],
    },
  };
}

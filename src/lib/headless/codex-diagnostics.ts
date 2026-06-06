import type { BreakdownActor } from '@/lib/breakdown-service/actor';
import { getErrorResponse } from '@/lib/breakdown-service/errors';
import type { BreakdownScope } from '@/lib/breakdown-service/scopes';
import { EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES } from '@/lib/headless/onboarding';

export const CODEX_DIAGNOSTIC_TOOL = 'diagnose_breakdown_setup';

export const CODEX_EXTERNAL_EVALUATOR_TOOLS = [
  'create_external_run',
  'get_next_step',
  'get_step_context',
  'submit_step_result',
  'mark_step_blocked',
  'finalize_external_run',
  'summarize_run_delta',
] as const;

export const CODEX_EXTERNAL_EVALUATOR_REQUIRED_SCOPES = [
  'graphs:read',
  'runs:external_execute',
  'runs:write_results',
] as const satisfies readonly BreakdownScope[];

type DiagnosticState =
  | 'ready'
  | 'missing_token'
  | 'invalid_token'
  | 'revoked_token'
  | 'expired_token'
  | 'missing_scope'
  | 'auth_error';

type CheckStatus = 'pass' | 'fail' | 'warning' | 'unknown';

interface DiagnosticCheck {
  id: string;
  status: CheckStatus;
  message: string;
  details?: unknown;
}

function absoluteUrl(origin: string, path: string) {
  return `${origin}${path}`;
}

function setupLinks(origin: string) {
  return {
    docsUrl: absoluteUrl(origin, '/docs/codex-plugin'),
    mcpAccessUrl: absoluteUrl(origin, '/mcp'),
    agentSetupSessionsUrl: absoluteUrl(origin, '/api/integrations/agent-setup-sessions'),
    diagnosticsUrl: absoluteUrl(origin, '/api/integrations/codex/diagnostics'),
    mcpUrl: absoluteUrl(origin, '/api/mcp'),
  };
}

function missingScopes(actor: Pick<BreakdownActor, 'scopes'>) {
  return CODEX_EXTERNAL_EVALUATOR_REQUIRED_SCOPES.filter((scope) => !actor.scopes.includes(scope));
}

function authFailureState(message: string): DiagnosticState {
  const normalized = message.toLowerCase();

  if (normalized.includes('missing bearer token')) {
    return 'missing_token';
  }
  if (normalized.includes('revoked')) {
    return 'revoked_token';
  }
  if (normalized.includes('expired')) {
    return 'expired_token';
  }
  if (normalized.includes('invalid bearer token')) {
    return 'invalid_token';
  }

  return 'auth_error';
}

function authFailureSummary(state: DiagnosticState) {
  switch (state) {
    case 'missing_token':
      return 'Breakdown MCP is reachable, but this request did not include a bearer token.';
    case 'invalid_token':
      return 'Breakdown MCP received a bearer token, but the token was not recognized.';
    case 'revoked_token':
      return 'Breakdown MCP received a token that has been revoked.';
    case 'expired_token':
      return 'Breakdown MCP received a token that has expired.';
    default:
      return 'Breakdown MCP could not verify the bearer token.';
  }
}

export function createCodexReadyDiagnostics(actor: BreakdownActor, origin: string) {
  const missing = missingScopes(actor);
  const ready = missing.length === 0;
  const links = setupLinks(origin);

  return {
    version: 'codex-setup-diagnostics.v1',
    ok: ready,
    state: ready ? ('ready' as const) : ('missing_scope' as const),
    summary: ready
      ? 'Breakdown MCP is loaded, the bearer token is valid, and external-evaluator tools have the required scopes.'
      : 'Breakdown MCP is loaded and the token is valid, but external-evaluator mode needs additional scopes.',
    actor: {
      source: actor.source,
      tokenName: actor.tokenName ?? null,
      scopes: actor.scopes,
    },
    toolSurface: {
      diagnosticTool: CODEX_DIAGNOSTIC_TOOL,
      externalEvaluatorTools: CODEX_EXTERNAL_EVALUATOR_TOOLS,
      externalEvaluatorToolsAvailable: true,
    },
    scopes: {
      requiredForExternalEvaluator: CODEX_EXTERNAL_EVALUATOR_REQUIRED_SCOPES,
      defaultSetupSessionScopes: EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES,
      granted: actor.scopes,
      missing,
    },
    checks: [
      {
        id: 'mcp_server_loaded',
        status: 'pass',
        message: `${CODEX_DIAGNOSTIC_TOOL} is callable, so the Breakdown MCP server is loaded in this Codex session.`,
      },
      {
        id: 'token_available',
        status: 'pass',
        message: 'A bearer token was provided to Breakdown MCP.',
      },
      {
        id: 'token_valid',
        status: 'pass',
        message: 'The bearer token resolved to an active Breakdown integration token.',
      },
      {
        id: 'external_evaluator_tools',
        status: 'pass',
        message: 'Required external-evaluator MCP tools are present in the Breakdown tool surface.',
        details: { tools: CODEX_EXTERNAL_EVALUATOR_TOOLS },
      },
      {
        id: 'external_evaluator_scopes',
        status: ready ? 'pass' : 'fail',
        message: ready
          ? 'The token has the scopes needed for external-evaluator mode.'
          : 'Create or rotate a token with the missing scopes before using external-evaluator mode.',
        details: {
          requiredScopes: CODEX_EXTERNAL_EVALUATOR_REQUIRED_SCOPES,
          missingScopes: missing,
        },
      },
    ] satisfies DiagnosticCheck[],
    setup: {
      ...links,
      persistentCodexConfig:
        'Install the plugin once, approve an agent setup session, and store the resulting token in the user-level Codex or launcher secret store that starts Codex Desktop.',
      advancedFallback:
        'If a client cannot persist plugin auth yet, set BREAKDOWN_API_TOKEN in the environment that starts Codex.',
    },
  };
}

export function createCodexAuthFailureDiagnostics(err: unknown, origin: string) {
  const error = getErrorResponse(err);
  const state = authFailureState(error.message);
  const links = setupLinks(origin);

  return {
    version: 'codex-setup-diagnostics.v1',
    ok: false,
    state,
    summary: authFailureSummary(state),
    error: {
      code: error.code,
      message: error.message,
      details: error.details,
    },
    toolSurface: {
      diagnosticTool: CODEX_DIAGNOSTIC_TOOL,
      externalEvaluatorTools: CODEX_EXTERNAL_EVALUATOR_TOOLS,
      externalEvaluatorToolsAvailable: false,
      reason:
        'Protected Breakdown tools are hidden until the MCP request includes an active bearer token.',
    },
    scopes: {
      requiredForExternalEvaluator: CODEX_EXTERNAL_EVALUATOR_REQUIRED_SCOPES,
      defaultSetupSessionScopes: EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES,
      granted: [],
      missing: CODEX_EXTERNAL_EVALUATOR_REQUIRED_SCOPES,
    },
    checks: [
      {
        id: 'mcp_server_loaded',
        status: 'unknown',
        message:
          'If this response came from the MCP diagnostic tool, the server is loaded. If it came from the HTTP diagnostics endpoint, ask Codex to list MCP tools to verify plugin activation.',
      },
      {
        id: 'token_available',
        status: state === 'missing_token' ? 'fail' : 'pass',
        message:
          state === 'missing_token'
            ? 'No Authorization bearer token reached Breakdown.'
            : 'A bearer token reached Breakdown.',
      },
      {
        id: 'token_valid',
        status: 'fail',
        message: error.message,
      },
      {
        id: 'external_evaluator_tools',
        status: 'unknown',
        message:
          'External-evaluator tools can be confirmed after Codex loads Breakdown MCP with a valid token.',
        details: { tools: CODEX_EXTERNAL_EVALUATOR_TOOLS },
      },
    ] satisfies DiagnosticCheck[],
    setup: {
      ...links,
      nextSteps: [
        'Install or enable the Breakdown Codex plugin if no Breakdown MCP tools are listed.',
        'Create an agent setup session and approve it in the browser while signed in to Breakdown.',
        'Persist the exchanged token in the user-level Codex or launcher secret store that starts Codex Desktop.',
        `Run ${CODEX_DIAGNOSTIC_TOOL} from Codex to verify the MCP tool surface and scopes.`,
      ],
      advancedFallback:
        'Raw bdk tokens and BREAKDOWN_API_TOKEN are fallback paths for clients without persistent plugin auth.',
    },
  };
}

import { BREAKDOWN_SCOPES } from '@/lib/breakdown-service/scopes';
import {
  EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES,
  getExternalConsoleOnboardingMetadata,
} from '@/lib/headless/onboarding';

function absoluteUrl(origin: string, path: string) {
  return `${origin}${path}`;
}

function humanApprovalBoundary(origin: string) {
  return {
    required: true,
    summary:
      'Agents can create and poll setup sessions, but a signed-in Breakdown user must approve the setup URL before the exchange endpoint returns a bearer token.',
    agentCan: [
      'POST /api/integrations/agent-setup-sessions',
      'GET /api/integrations/agent-setup-sessions/{sessionId}',
      'POST /api/integrations/agent-setup-sessions/{sessionId}/exchange after approval',
    ],
    humanMust: [
      `Open the approveUrl returned by ${absoluteUrl(origin, '/api/integrations/agent-setup-sessions')}`,
      'Confirm the displayed userCode while signed in',
    ],
    exchangeBeforeApproval: {
      status: 409,
      code: 'conflict',
    },
  };
}

function bearerAuth() {
  return {
    type: 'bearer',
    header: 'Authorization: Bearer <bdk_token>',
    queryParameter: 'access_token',
    tokenPrefix: 'bdk_',
    tokenSource:
      'Create a durable token from Breakdown MCP Client Connections settings, or create an agent setup session, wait for signed-in human approval, then exchange the session secret. Prefer the Authorization header; use ?access_token= only when a client cannot set headers.',
    scopes: BREAKDOWN_SCOPES,
  };
}

export function getApiIndexDiscovery(origin: string) {
  const onboarding = getExternalConsoleOnboardingMetadata(origin);

  return {
    name: 'Breakdown API',
    version: 'api-index.v1',
    description: 'Public machine-readable discovery index for Breakdown agent integrations.',
    endpoints: {
      apiIndexUrl: absoluteUrl(origin, '/api'),
      aiPluginManifestUrl: absoluteUrl(origin, '/.well-known/ai-plugin.json'),
      openApiUrl: absoluteUrl(origin, '/openapi.json'),
      wellKnownOpenApiUrl: absoluteUrl(origin, '/.well-known/openapi.json'),
      docsUrl: absoluteUrl(origin, '/docs/codex-plugin'),
      onboardingUrl: onboarding.endpoints.bootstrapUrl,
      agentSetupSessionsUrl: onboarding.endpoints.agentSetupSessionsUrl,
      codexDiagnosticsUrl: onboarding.endpoints.codexDiagnosticsUrl,
      headlessApiBaseUrl: onboarding.endpoints.headlessApiBaseUrl,
      mcpUrl: onboarding.endpoints.mcpUrl,
    },
    auth: {
      publicDiscovery: 'none',
      headlessApi: bearerAuth(),
      onboarding: onboarding.auth,
    },
    humanApproval: humanApprovalBoundary(origin),
    nextSteps: [
      'GET /api/integrations/headless-onboarding for onboarding metadata',
      'POST /api/integrations/agent-setup-sessions to create an approval session',
      'Ask the signed-in human to open approveUrl and confirm userCode',
      'POST /api/integrations/agent-setup-sessions/{sessionId}/exchange with exchangeSecret',
      'GET /api/integrations/codex/diagnostics to check token and external-evaluator readiness',
      'Use the returned bdk token with /api/mcp or /api/headless',
    ],
  };
}

export function getHeadlessApiDiscovery(origin: string) {
  const onboarding = getExternalConsoleOnboardingMetadata(origin);

  return {
    name: 'Breakdown Headless API',
    version: 'headless-api.v1',
    baseUrl: onboarding.endpoints.headlessApiBaseUrl,
    description:
      'REST endpoints for graph CRUD, workflow execution, external evaluator runs, and result submission.',
    responseEnvelope: {
      success: { data: '<payload>', error: null },
      error: { data: null, error: { code: '<code>', message: '<message>', details: '<optional>' } },
    },
    authentication: bearerAuth(),
    onboarding: {
      metadataUrl: onboarding.endpoints.bootstrapUrl,
      setupSessionsUrl: onboarding.endpoints.agentSetupSessionsUrl,
      codexDiagnosticsUrl: onboarding.endpoints.codexDiagnosticsUrl,
      defaultScopes: EXTERNAL_CONSOLE_BOOTSTRAP_SCOPES,
    },
    humanApproval: humanApprovalBoundary(origin),
    endpoints: [
      {
        method: 'GET',
        path: '/api/headless',
        auth: 'none',
        description: 'Headless API discovery document.',
      },
      {
        method: 'GET',
        path: '/api/headless/graphs',
        auth: 'bearer',
        scopes: ['graphs:read'],
        description: 'List graphs available to the integration token.',
      },
      {
        method: 'POST',
        path: '/api/headless/graphs',
        auth: 'bearer',
        scopes: ['graphs:write'],
        description: 'Create a graph.',
      },
      {
        method: 'POST',
        path: '/api/headless/graphs/import',
        auth: 'bearer',
        scopes: ['graphs:write'],
        description: 'Import a complete graph definition.',
      },
      {
        method: 'GET/PATCH/DELETE',
        path: '/api/headless/graphs/{graphId}',
        auth: 'bearer',
        scopes: ['graphs:read', 'graphs:write'],
        description: 'Read, update, or delete a graph.',
      },
      {
        method: 'POST',
        path: '/api/headless/graphs/{graphId}/nodes',
        auth: 'bearer',
        scopes: ['graphs:write'],
        description: 'Create a node in a graph.',
      },
      {
        method: 'POST',
        path: '/api/headless/graphs/{graphId}/edges',
        auth: 'bearer',
        scopes: ['graphs:write'],
        description: 'Create an edge in a graph.',
      },
      {
        method: 'POST',
        path: '/api/headless/graphs/{graphId}/apply-patch',
        auth: 'bearer',
        scopes: ['graphs:write'],
        description: 'Preview or apply a graph patch.',
      },
      {
        method: 'POST',
        path: '/api/headless/graphs/{graphId}/run',
        auth: 'bearer',
        scopes: ['runs:execute'],
        description: 'Start an internal graph run.',
      },
      {
        method: 'GET',
        path: '/api/headless/graphs/{graphId}/run-status',
        auth: 'bearer',
        scopes: ['graphs:read'],
        description: 'Poll internal graph run status.',
      },
      {
        method: 'POST',
        path: '/api/headless/graphs/{graphId}/external-runs',
        auth: 'bearer',
        scopes: ['runs:external_execute'],
        description: 'Create an external evaluator run for a graph.',
      },
      {
        method: 'GET',
        path: '/api/headless/external-runs/{runId}/next-step',
        auth: 'bearer',
        scopes: ['runs:external_execute'],
        description:
          'Claim and return the next runnable external evaluator work packet, including prompt, upstream outputs, freshness warnings, and submit/block routes.',
      },
      {
        method: 'GET',
        path: '/api/headless/external-runs/{runId}/steps/{stepId}/context',
        auth: 'bearer',
        scopes: ['runs:external_execute'],
        description:
          'Refresh or debug the executable work packet for a known external evaluator step. The next-step route already includes this packet by default.',
      },
      {
        method: 'POST',
        path: '/api/headless/external-runs/{runId}/steps/{stepId}/result',
        auth: 'bearer',
        scopes: ['runs:write_results'],
        description: 'Submit a completed external evaluator step result.',
      },
      {
        method: 'POST',
        path: '/api/headless/external-runs/{runId}/steps/{stepId}/block',
        auth: 'bearer',
        scopes: ['runs:write_results'],
        description: 'Mark a step blocked by a data gap or other external condition.',
      },
      {
        method: 'POST',
        path: '/api/headless/external-runs/{runId}/finalize',
        auth: 'bearer',
        scopes: ['runs:external_execute'],
        description: 'Finalize an external run after all steps are complete or blocked.',
      },
      {
        method: 'POST',
        path: '/api/headless/workflows/import-and-run',
        auth: 'bearer',
        scopes: ['graphs:write', 'runs:external_execute'],
        description: 'Import a graph and create an external run in one request.',
      },
    ],
    related: {
      runsDiscoveryUrl: absoluteUrl(origin, '/api/headless/runs'),
      toolsDiscoveryUrl: absoluteUrl(origin, '/api/headless/tools'),
      mcpUrl: onboarding.endpoints.mcpUrl,
    },
  };
}

export function getHeadlessRunsDiscovery(origin: string) {
  const onboarding = getExternalConsoleOnboardingMetadata(origin);

  return {
    name: 'Breakdown Headless Runs',
    version: 'headless-runs.v1',
    collectionEndpoint: false,
    message:
      'Runs are scoped to graphs and external evaluator sessions; use the graph and external-run routes below rather than /api/headless/runs as a collection.',
    authentication: bearerAuth(),
    onboarding: {
      metadataUrl: onboarding.endpoints.bootstrapUrl,
      setupSessionsUrl: onboarding.endpoints.agentSetupSessionsUrl,
    },
    humanApproval: humanApprovalBoundary(origin),
    endpoints: [
      {
        method: 'POST',
        path: '/api/headless/graphs/{graphId}/run',
        scopes: ['runs:execute'],
        description: 'Start an internal graph run.',
      },
      {
        method: 'GET',
        path: '/api/headless/graphs/{graphId}/run-status',
        scopes: ['graphs:read'],
        description: 'Poll internal graph run status.',
      },
      {
        method: 'POST',
        path: '/api/headless/graphs/{graphId}/external-runs',
        scopes: ['runs:external_execute'],
        description: 'Create an external evaluator run.',
      },
      {
        method: 'GET',
        path: '/api/headless/external-runs/{runId}',
        scopes: ['runs:external_execute'],
        description: 'Read external run state.',
      },
      {
        method: 'GET',
        path: '/api/headless/external-runs/{runId}/next-step',
        scopes: ['runs:external_execute'],
        description:
          'Claim and return the next runnable work packet, including prompt, upstream outputs, freshness warnings, and submit/block routes.',
      },
      {
        method: 'GET',
        path: '/api/headless/external-runs/{runId}/steps/{stepId}/context',
        scopes: ['runs:external_execute'],
        description:
          'Refresh or debug the executable work packet for a known step. Clients can usually use next-step directly.',
      },
      {
        method: 'POST',
        path: '/api/headless/external-runs/{runId}/steps/{stepId}/result',
        scopes: ['runs:write_results'],
        description: 'Submit step output.',
      },
      {
        method: 'POST',
        path: '/api/headless/external-runs/{runId}/steps/{stepId}/block',
        scopes: ['runs:write_results'],
        description: 'Mark a step blocked by a data gap or other external condition.',
      },
      {
        method: 'POST',
        path: '/api/headless/external-runs/{runId}/finalize',
        scopes: ['runs:write_results'],
        description: 'Finalize an external run after all steps are complete or blocked.',
      },
    ],
  };
}

export function getHeadlessToolsDiscovery(origin: string) {
  const onboarding = getExternalConsoleOnboardingMetadata(origin);

  return {
    name: 'Breakdown Tool Discovery',
    version: 'headless-tools.v1',
    collectionEndpoint: false,
    message:
      'Tool discovery is exposed through the MCP Streamable HTTP endpoint. Use JSON-RPC tools/list after initializing a bearer-authenticated MCP session. If auth is missing, tools/list exposes only diagnose_breakdown_setup.',
    authentication: bearerAuth(),
    onboarding: {
      metadataUrl: onboarding.endpoints.bootstrapUrl,
      setupSessionsUrl: onboarding.endpoints.agentSetupSessionsUrl,
      codexDiagnosticsUrl: onboarding.endpoints.codexDiagnosticsUrl,
    },
    humanApproval: humanApprovalBoundary(origin),
    mcp: {
      url: onboarding.endpoints.mcpUrl,
      transport: 'streamable-http',
      auth: 'Authorization: Bearer <bdk_token>',
      diagnosticTool: 'diagnose_breakdown_setup',
      initialize: {
        method: 'POST',
        body: {
          jsonrpc: '2.0',
          id: '<request-id>',
          method: 'initialize',
          params: {
            protocolVersion: '2025-03-26',
            capabilities: {},
            clientInfo: { name: '<client-name>', version: '<client-version>' },
          },
        },
      },
      listTools: {
        method: 'POST',
        body: {
          jsonrpc: '2.0',
          id: '<request-id>',
          method: 'tools/list',
          params: {},
        },
      },
    },
  };
}

export function getAiPluginManifest(origin: string) {
  return {
    schema_version: 'v1',
    name_for_human: 'Breakdown',
    name_for_model: 'breakdown',
    description_for_human:
      'Breakdown exposes graph workflows, headless execution, and MCP tools for approved integrations.',
    description_for_model:
      'Use a durable bdk bearer token created from Breakdown MCP Client Connections settings, or use the public onboarding endpoints to create an agent setup session. Setup sessions require signed-in human approval before exchange and produce a token for /api/mcp or /api/headless. Header-based auth is preferred; ?access_token= is accepted as a client fallback.',
    auth: {
      type: 'service_http',
      authorization_type: 'bearer',
    },
    api: {
      type: 'openapi',
      url: absoluteUrl(origin, '/openapi.json'),
      has_user_authentication: true,
    },
    logo_url: absoluteUrl(origin, '/favicon.ico'),
    contact_email: 'support@breakdown.sh',
    legal_info_url: absoluteUrl(origin, '/terms-of-service'),
    onboarding_url: absoluteUrl(origin, '/api/integrations/headless-onboarding'),
    human_approval: humanApprovalBoundary(origin),
  };
}

export function getOpenApiDocument(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Breakdown Headless API',
      version: 'headless-api.v1',
      description:
        'Machine-readable API discovery for approved Breakdown headless integrations. Public setup endpoints create an approval session; a signed-in human must approve before bearer-token exchange succeeds.',
    },
    servers: [{ url: origin }],
    tags: [
      { name: 'Discovery' },
      { name: 'Onboarding' },
      { name: 'Headless API' },
      { name: 'MCP' },
    ],
    security: [],
    components: {
      securitySchemes: {
        bearerToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'bdk',
          description: 'Integration token returned after human-approved setup session exchange.',
        },
      },
      schemas: {
        HeadlessEnvelope: {
          type: 'object',
          properties: {
            data: { description: 'Response payload on success; null on error.' },
            error: {
              oneOf: [
                { type: 'null' },
                {
                  type: 'object',
                  properties: {
                    code: { type: 'string' },
                    message: { type: 'string' },
                    details: {},
                  },
                  required: ['code', 'message'],
                },
              ],
            },
          },
          required: ['data', 'error'],
        },
        ExternalStepWorkPacket: {
          type: 'object',
          description:
            'Executable external-evaluator step packet returned by next-step and step context routes.',
          properties: {
            stepId: { type: 'string', format: 'uuid' },
            nodeId: { type: 'string', format: 'uuid' },
            status: {
              type: 'string',
              enum: ['ready', 'in_progress', 'submitted', 'blocked'],
              description:
                'Current step status. Calling next-step claims a ready step and returns in_progress.',
            },
            contextVersion: {
              type: 'string',
              description: 'Submit this exact value with result or block requests.',
            },
            node: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                name: { type: 'string' },
                nodeType: { type: 'string' },
                prompt: { type: 'string' },
                priorOutput: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                priorStructuredOutput: {
                  oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
                },
                metadata: { type: 'object', additionalProperties: true },
                runStatus: { type: 'string' },
                lastRunAt: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              },
              required: [
                'id',
                'name',
                'nodeType',
                'prompt',
                'priorOutput',
                'priorStructuredOutput',
                'metadata',
                'runStatus',
                'lastRunAt',
              ],
            },
            upstream: {
              type: 'object',
              additionalProperties: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    edgeId: { type: 'string', format: 'uuid' },
                    sourceNodeId: { type: 'string', format: 'uuid' },
                    sourceNodeName: { type: 'string' },
                    output: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                    structuredOutput: {
                      oneOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }],
                    },
                    runStatus: { type: 'string' },
                    lastRunAt: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                    stale: { type: 'boolean' },
                    freshnessWarning: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                    condition: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                    transform: { oneOf: [{ type: 'string' }, { type: 'null' }] },
                  },
                },
              },
            },
            executionPrompt: { type: 'string' },
            promptContract: {
              type: 'object',
              additionalProperties: true,
              properties: {
                source: { type: 'string', enum: ['metadata', 'legacy-metadata', 'default'] },
                contract: { type: 'object', additionalProperties: true },
              },
              required: ['source', 'contract'],
            },
            outputContract: { type: 'object', additionalProperties: true },
            structuredOutputRequired: { type: 'boolean' },
            sourceFreshnessWarnings: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  nodeId: { type: 'string', format: 'uuid' },
                  name: { type: 'string' },
                  warning: { type: 'string' },
                },
                required: ['nodeId', 'name', 'warning'],
              },
            },
            expectedOutput: {},
            acceptanceCriteria: {},
            hostToolInstructions: { type: 'string' },
            submission: {
              type: 'object',
              properties: {
                submitRoute: { type: 'string' },
                blockRoute: { type: 'string' },
                requiredContextVersion: { type: 'string' },
                requiredFields: { type: 'array', items: { type: 'string' } },
              },
              required: ['submitRoute', 'blockRoute', 'requiredContextVersion', 'requiredFields'],
            },
          },
          required: [
            'stepId',
            'nodeId',
            'status',
            'contextVersion',
            'node',
            'upstream',
            'executionPrompt',
            'promptContract',
            'outputContract',
            'structuredOutputRequired',
            'sourceFreshnessWarnings',
            'expectedOutput',
            'acceptanceCriteria',
            'hostToolInstructions',
            'submission',
          ],
        },
        NextExternalStepData: {
          type: 'object',
          properties: {
            runId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['active', 'completed', 'blocked', 'cancelled'] },
            step: {
              oneOf: [{ $ref: '#/components/schemas/ExternalStepWorkPacket' }, { type: 'null' }],
            },
          },
          required: ['runId', 'status', 'step'],
        },
        ExternalStepContextData: {
          allOf: [
            {
              type: 'object',
              properties: {
                runId: { type: 'string', format: 'uuid' },
              },
              required: ['runId'],
            },
            { $ref: '#/components/schemas/ExternalStepWorkPacket' },
          ],
        },
      },
    },
    paths: {
      '/api': {
        get: {
          tags: ['Discovery'],
          summary: 'Public API discovery index',
          responses: {
            '200': { description: 'Discovery metadata.' },
          },
        },
      },
      '/api/headless': {
        get: {
          tags: ['Discovery'],
          summary: 'Headless API discovery index',
          responses: {
            '200': { description: 'Headless API metadata in the standard envelope.' },
          },
        },
      },
      '/api/headless/runs': {
        get: {
          tags: ['Discovery'],
          summary: 'Run route discovery',
          responses: {
            '200': { description: 'Explains graph-scoped and external-run endpoints.' },
          },
        },
      },
      '/api/headless/tools': {
        get: {
          tags: ['Discovery'],
          summary: 'MCP tool discovery instructions',
          responses: {
            '200': { description: 'Explains MCP initialize and tools/list.' },
          },
        },
      },
      '/api/integrations/headless-onboarding': {
        get: {
          tags: ['Onboarding'],
          summary: 'Read onboarding metadata',
          responses: {
            '200': { description: 'Provider-neutral onboarding metadata.' },
          },
        },
        post: {
          tags: ['Onboarding'],
          summary: 'Bootstrap from a signed-in Clerk session',
          description:
            'Requires a signed-in Breakdown user. Coding agents should usually use agent setup sessions instead.',
          responses: {
            '201': { description: 'Bootstrap token and session context.' },
            '401': { description: 'Signed-in user required.' },
          },
        },
      },
      '/api/integrations/agent-setup-sessions': {
        get: {
          tags: ['Onboarding'],
          summary: 'Read agent setup session metadata',
          responses: {
            '200': { description: 'Approval-session onboarding metadata.' },
          },
        },
        post: {
          tags: ['Onboarding'],
          summary: 'Create an agent setup session',
          description:
            'Returns approveUrl, status URL, exchange URL, userCode, and exchangeSecret. A signed-in human must approve before exchange succeeds.',
          responses: {
            '201': { description: 'Pending setup session.' },
            '429': { description: 'Rate limited.' },
          },
        },
      },
      '/api/integrations/agent-setup-sessions/{sessionId}': {
        get: {
          tags: ['Onboarding'],
          summary: 'Poll setup session status',
          parameters: [
            {
              name: 'sessionId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': { description: 'Setup session status.' },
          },
        },
      },
      '/api/integrations/agent-setup-sessions/{sessionId}/exchange': {
        post: {
          tags: ['Onboarding'],
          summary: 'Exchange an approved setup session',
          parameters: [
            {
              name: 'sessionId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': { description: 'Bearer token and session context.' },
            '409': { description: 'Setup session is not approved yet.' },
          },
        },
      },
      '/api/integrations/codex/diagnostics': {
        get: {
          tags: ['Onboarding'],
          summary: 'Check Codex setup and external-evaluator readiness',
          description:
            'Returns a machine-readable diagnostic response. Without a bearer token it reports missing_token; with a token it checks validity, revocation/expiry, and external-evaluator scopes.',
          responses: {
            '200': { description: 'Codex setup diagnostic result.' },
          },
        },
      },
      '/api/mcp': {
        post: {
          tags: ['MCP'],
          summary: 'MCP Streamable HTTP JSON-RPC endpoint',
          security: [{ bearerToken: [] }],
          responses: {
            '200': { description: 'JSON-RPC result.' },
            '401': { description: 'Bearer token required.' },
          },
        },
      },
      '/api/headless/graphs': {
        get: {
          tags: ['Headless API'],
          summary: 'List graphs',
          security: [{ bearerToken: [] }],
          responses: {
            '200': { description: 'Graph list in headless envelope.' },
            '401': { description: 'Bearer token required.' },
          },
        },
        post: {
          tags: ['Headless API'],
          summary: 'Create a graph',
          security: [{ bearerToken: [] }],
          responses: {
            '200': { description: 'Created graph in headless envelope.' },
            '401': { description: 'Bearer token required.' },
          },
        },
      },
      '/api/headless/graphs/import': {
        post: {
          tags: ['Headless API'],
          summary: 'Import a graph',
          security: [{ bearerToken: [] }],
          responses: {
            '200': { description: 'Imported graph in headless envelope.' },
            '401': { description: 'Bearer token required.' },
          },
        },
      },
      '/api/headless/graphs/{graphId}': {
        get: {
          tags: ['Headless API'],
          summary: 'Get a graph',
          security: [{ bearerToken: [] }],
          parameters: [
            {
              name: 'graphId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': { description: 'Graph in headless envelope.' },
            '401': { description: 'Bearer token required.' },
          },
        },
        patch: {
          tags: ['Headless API'],
          summary: 'Update a graph',
          security: [{ bearerToken: [] }],
          parameters: [
            {
              name: 'graphId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': { description: 'Updated graph in headless envelope.' },
          },
        },
        delete: {
          tags: ['Headless API'],
          summary: 'Delete a graph',
          security: [{ bearerToken: [] }],
          parameters: [
            {
              name: 'graphId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
            },
          ],
          responses: {
            '200': { description: 'Deletion confirmation in headless envelope.' },
          },
        },
      },
      '/api/headless/graphs/{graphId}/external-runs': {
        post: {
          tags: ['Headless API'],
          summary: 'Create an external evaluator run',
          security: [{ bearerToken: [] }],
          parameters: [
            {
              name: 'graphId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': { description: 'External run and manifest in headless envelope.' },
            '401': { description: 'Bearer token required.' },
          },
        },
      },
      '/api/headless/external-runs/{runId}/next-step': {
        get: {
          tags: ['Headless API'],
          summary: 'Claim next external work packet',
          description:
            'Returns the next runnable external-evaluator step packet by default. The packet includes executionPrompt, outputContract, upstream text and structured outputs grouped by edge type, freshness warnings, expected output, acceptance criteria, host-tool instructions, and submit/block routes.',
          security: [{ bearerToken: [] }],
          parameters: [
            {
              name: 'runId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': {
              description: 'Next external step work packet in headless envelope.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/NextExternalStepData' },
                      error: { type: 'null' },
                    },
                    required: ['data', 'error'],
                  },
                },
              },
            },
            '401': { description: 'Bearer token required.' },
          },
        },
      },
      '/api/headless/external-runs/{runId}/steps/{stepId}/context': {
        get: {
          tags: ['Headless API'],
          summary: 'Refresh external step context',
          description:
            'Fetches the executable work packet for a known step. Use this for retry, refresh, or debug flows; next-step already returns the same packet for the selected step.',
          security: [{ bearerToken: [] }],
          parameters: [
            {
              name: 'runId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'stepId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': {
              description: 'External step work packet in headless envelope.',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      data: { $ref: '#/components/schemas/ExternalStepContextData' },
                      error: { type: 'null' },
                    },
                    required: ['data', 'error'],
                  },
                },
              },
            },
            '401': { description: 'Bearer token required.' },
            '409': { description: 'Step is not ready because dependencies are incomplete.' },
          },
        },
      },
      '/api/headless/external-runs/{runId}/steps/{stepId}/result': {
        post: {
          tags: ['Headless API'],
          summary: 'Submit external step result',
          description:
            'Submit output, structuredOutput, and citations using the contextVersion returned by next-step or step context. structuredOutput is validated against the step outputContract before submission is accepted.',
          security: [{ bearerToken: [] }],
          parameters: [
            {
              name: 'runId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'stepId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': { description: 'Submitted step result in headless envelope.' },
            '409': { description: 'Step state or contextVersion is stale.' },
          },
        },
      },
      '/api/headless/external-runs/{runId}/steps/{stepId}/block': {
        post: {
          tags: ['Headless API'],
          summary: 'Mark external step blocked',
          description:
            'Mark a step blocked using the contextVersion returned by next-step or step context.',
          security: [{ bearerToken: [] }],
          parameters: [
            {
              name: 'runId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            {
              name: 'stepId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': { description: 'Blocked step status in headless envelope.' },
            '409': { description: 'Step state or contextVersion is stale.' },
          },
        },
      },
      '/api/headless/external-runs/{runId}/finalize': {
        post: {
          tags: ['Headless API'],
          summary: 'Finalize external run',
          security: [{ bearerToken: [] }],
          parameters: [
            {
              name: 'runId',
              in: 'path',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
          ],
          responses: {
            '200': { description: 'Final external run status and metrics in headless envelope.' },
            '409': { description: 'Run still has incomplete steps.' },
          },
        },
      },
      '/api/headless/workflows/import-and-run': {
        post: {
          tags: ['Headless API'],
          summary: 'Import a graph and create an external run',
          security: [{ bearerToken: [] }],
          responses: {
            '200': { description: 'Workflow result in headless envelope.' },
          },
        },
      },
    },
  };
}

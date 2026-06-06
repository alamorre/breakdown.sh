#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface HeadlessEnvelope<T = unknown> {
  data: T | null;
  error: null | {
    code: string;
    message: string;
    details?: unknown;
  };
}

const BASE_URL = process.env.BREAKDOWN_BASE_URL ?? 'http://localhost:3000';
const TOKEN_ENV_VAR = 'BREAKDOWN_API_TOKEN';
const DIAGNOSTIC_TOOL = 'diagnose_breakdown_setup';
const EXTERNAL_EVALUATOR_TOOLS = [
  'create_external_run',
  'get_next_step',
  'get_step_context',
  'submit_step_result',
  'mark_step_blocked',
  'finalize_external_run',
  'summarize_run_delta',
];
const EXTERNAL_EVALUATOR_SCOPES = ['graphs:read', 'runs:external_execute', 'runs:write_results'];

function readApiToken() {
  return process.env[TOKEN_ENV_VAR]?.trim();
}

function endpoint(path: string) {
  return new URL(path, BASE_URL).toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function missingTokenDiagnostics() {
  return {
    version: 'codex-setup-diagnostics.v1',
    ok: false,
    state: 'missing_token',
    summary: `${TOKEN_ENV_VAR} is not available to the Breakdown MCP process.`,
    toolSurface: {
      diagnosticTool: DIAGNOSTIC_TOOL,
      externalEvaluatorTools: EXTERNAL_EVALUATOR_TOOLS,
      externalEvaluatorToolsAvailable: false,
      reason: 'Protected Breakdown tools require a bearer token before they can call the API.',
    },
    scopes: {
      requiredForExternalEvaluator: EXTERNAL_EVALUATOR_SCOPES,
      granted: [],
      missing: EXTERNAL_EVALUATOR_SCOPES,
    },
    setup: {
      agentSetupSessionsUrl: endpoint('/api/integrations/agent-setup-sessions'),
      diagnosticsUrl: endpoint('/api/integrations/codex/diagnostics'),
      mcpUrl: endpoint('/api/mcp'),
      advancedFallback: `Set ${TOKEN_ENV_VAR} in the environment that starts Codex.`,
    },
  };
}

async function readCodexDiagnostics() {
  const apiToken = readApiToken();
  if (!apiToken) {
    return missingTokenDiagnostics();
  }

  const response = await fetch(endpoint('/api/integrations/codex/diagnostics'), {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
    },
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      version: 'codex-setup-diagnostics.v1',
      ok: false,
      state: 'auth_error',
      summary: `Breakdown diagnostics request failed with HTTP ${response.status}.`,
      response: body,
    };
  }

  return isRecord(body) && 'data' in body ? body.data : body;
}

async function headlessRequest<T>(method: HttpMethod, path: string, body?: unknown): Promise<T> {
  const apiToken = readApiToken();
  if (!apiToken) {
    throw new Error(
      `${TOKEN_ENV_VAR} is not available. Call ${DIAGNOSTIC_TOOL} for setup diagnostics.`,
    );
  }

  const response = await fetch(endpoint(path), {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      Accept: 'application/json',
      ...(body === undefined
        ? {}
        : {
            'Content-Type': 'application/json',
            'Idempotency-Key': randomUUID(),
          }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const envelope = (await response.json()) as HeadlessEnvelope<T>;
  if (!response.ok || envelope.error) {
    const message = envelope.error?.message ?? `Breakdown API request failed: ${response.status}`;
    throw new Error(message);
  }

  return envelope.data as T;
}

function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function resourceText(uri: URL, data: unknown) {
  return {
    contents: [
      {
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

const jsonRecord = z.record(z.string(), z.unknown());
const uuid = z.string().uuid();

const graphInput = {
  graphId: uuid.describe('Breakdown graph id'),
};

const nodeInput = {
  nodeId: uuid.describe('Breakdown node id'),
};

const edgeInput = {
  edgeId: uuid.describe('Breakdown edge id'),
};

const runInput = {
  runId: uuid.describe('External run id'),
};

const server = new McpServer({
  name: 'breakdown-mcp',
  version: '0.1.0',
});

server.registerTool(
  DIAGNOSTIC_TOOL,
  {
    title: 'Diagnose Breakdown Setup',
    description:
      'Check whether Breakdown MCP is loaded, authenticated, scoped for external-evaluator mode, and ready for Codex use.',
    inputSchema: {},
  },
  async () => textResult(await readCodexDiagnostics()),
);

server.registerTool(
  'list_graphs',
  {
    title: 'List Breakdown Graphs',
    description: 'List graphs available to the authenticated Breakdown integration token.',
    inputSchema: {},
  },
  async () => textResult(await headlessRequest('GET', '/api/headless/graphs')),
);

server.registerTool(
  'get_graph',
  {
    title: 'Get Breakdown Graph',
    description: 'Read a graph with its nodes and edges.',
    inputSchema: graphInput,
  },
  async ({ graphId }) =>
    textResult(await headlessRequest('GET', `/api/headless/graphs/${graphId}`)),
);

server.registerTool(
  'create_graph',
  {
    title: 'Create Breakdown Graph',
    description: 'Create a new Breakdown reasoning graph.',
    inputSchema: {
      name: z.string().min(1).max(200),
      description: z.string().max(1000).optional(),
    },
  },
  async (input) => textResult(await headlessRequest('POST', '/api/headless/graphs', input)),
);

server.registerTool(
  'update_graph',
  {
    title: 'Update Breakdown Graph',
    description: 'Update graph metadata such as name, description, or model.',
    inputSchema: {
      ...graphInput,
      name: z.string().min(1).max(200).optional(),
      description: z.string().max(1000).nullable().optional(),
      llmModel: z.string().optional(),
    },
  },
  async ({ graphId, ...body }) =>
    textResult(await headlessRequest('PATCH', `/api/headless/graphs/${graphId}`, body)),
);

server.registerTool(
  'delete_graph',
  {
    title: 'Delete Breakdown Graph',
    description:
      'Delete a graph and all of its nodes/edges. Use only after explicit user confirmation.',
    inputSchema: graphInput,
    annotations: { destructiveHint: true },
  },
  async ({ graphId }) =>
    textResult(await headlessRequest('DELETE', `/api/headless/graphs/${graphId}`)),
);

server.registerTool(
  'create_node',
  {
    title: 'Create Breakdown Node',
    description: 'Add a node to an existing Breakdown graph.',
    inputSchema: {
      ...graphInput,
      name: z.string().min(1).max(200),
      prompt: z.string().max(50000).optional(),
      nodeType: z.string().max(80).optional(),
      metadata: jsonRecord.optional(),
      positionX: z.number().default(0),
      positionY: z.number().default(0),
    },
  },
  async ({ graphId, ...body }) =>
    textResult(await headlessRequest('POST', `/api/headless/graphs/${graphId}/nodes`, body)),
);

server.registerTool(
  'update_node',
  {
    title: 'Update Breakdown Node',
    description: 'Update a node prompt, metadata, position, or execution state.',
    inputSchema: {
      ...nodeInput,
      name: z.string().min(1).max(200).optional(),
      prompt: z.string().max(50000).optional(),
      output: z.string().max(250000).nullable().optional(),
      nodeType: z.string().max(80).optional(),
      metadata: jsonRecord.optional(),
      positionX: z.number().optional(),
      positionY: z.number().optional(),
    },
  },
  async ({ nodeId, ...body }) =>
    textResult(await headlessRequest('PATCH', `/api/headless/nodes/${nodeId}`, body)),
);

server.registerTool(
  'delete_node',
  {
    title: 'Delete Breakdown Node',
    description: 'Delete a node and incident edges. Use only after explicit user confirmation.',
    inputSchema: nodeInput,
    annotations: { destructiveHint: true },
  },
  async ({ nodeId }) =>
    textResult(await headlessRequest('DELETE', `/api/headless/nodes/${nodeId}`)),
);

server.registerTool(
  'connect_nodes',
  {
    title: 'Connect Breakdown Nodes',
    description: 'Create a typed DAG edge between two nodes.',
    inputSchema: {
      ...graphInput,
      sourceNodeId: uuid,
      targetNodeId: uuid,
      edgeType: z.string().min(1).max(80),
      weight: z.number().min(0).max(1).optional(),
      condition: z.string().max(2000).nullable().optional(),
      transform: z.string().max(10000).nullable().optional(),
    },
  },
  async ({ graphId, ...body }) =>
    textResult(await headlessRequest('POST', `/api/headless/graphs/${graphId}/edges`, body)),
);

server.registerTool(
  'update_edge',
  {
    title: 'Update Breakdown Edge',
    description: 'Update or rewire an edge. Rewires are validated to keep the graph acyclic.',
    inputSchema: {
      ...edgeInput,
      sourceNodeId: uuid.optional(),
      targetNodeId: uuid.optional(),
      edgeType: z.string().min(1).max(80).optional(),
      weight: z.number().min(0).max(1).optional(),
      condition: z.string().max(2000).nullable().optional(),
      transform: z.string().max(10000).nullable().optional(),
    },
  },
  async ({ edgeId, ...body }) =>
    textResult(await headlessRequest('PATCH', `/api/headless/edges/${edgeId}`, body)),
);

server.registerTool(
  'delete_edge',
  {
    title: 'Delete Breakdown Edge',
    description: 'Delete an edge. Use only after explicit user confirmation.',
    inputSchema: edgeInput,
    annotations: { destructiveHint: true },
  },
  async ({ edgeId }) =>
    textResult(await headlessRequest('DELETE', `/api/headless/edges/${edgeId}`)),
);

server.registerTool(
  'export_graph',
  {
    title: 'Export Breakdown Graph',
    description: 'Export a complete machine-readable graph representation.',
    inputSchema: graphInput,
  },
  async ({ graphId }) =>
    textResult(await headlessRequest('GET', `/api/headless/graphs/${graphId}/export`)),
);

server.registerTool(
  'import_graph',
  {
    title: 'Import Breakdown Graph',
    description: 'Create or replace a graph from the headless export/import shape.',
    inputSchema: {
      mode: z.enum(['create', 'replace']).default('create'),
      graphId: uuid.optional(),
      graph: jsonRecord,
      nodes: z.array(jsonRecord),
      edges: z.array(jsonRecord),
    },
  },
  async (input) => textResult(await headlessRequest('POST', '/api/headless/graphs/import', input)),
);

server.registerTool(
  'import_graph_and_create_external_run',
  {
    title: 'Import Graph And Create External Run',
    description:
      'Create or replace a graph from a generic import shape, then start an external-evaluator run for host-console execution.',
    inputSchema: {
      importGraph: jsonRecord,
      externalRun: jsonRecord.optional(),
    },
    annotations: { destructiveHint: true },
  },
  async (input) =>
    textResult(await headlessRequest('POST', '/api/headless/workflows/import-and-run', input)),
);

server.registerTool(
  'get_workflow_manifest',
  {
    title: 'Get Workflow Manifest',
    description: 'Get the execution-ready manifest for a graph, including topological order.',
    inputSchema: graphInput,
  },
  async ({ graphId }) =>
    textResult(await headlessRequest('GET', `/api/headless/graphs/${graphId}/manifest`)),
);

server.registerTool(
  'apply_graph_patch',
  {
    title: 'Apply Graph Patch',
    description:
      'Preview or apply a structured graph patch. Use dryRun first and ask before destructive apply.',
    inputSchema: {
      ...graphInput,
      dryRun: z.boolean().default(true),
      operations: z.array(jsonRecord).min(1).max(100),
    },
  },
  async ({ graphId, ...body }) =>
    textResult(await headlessRequest('POST', `/api/headless/graphs/${graphId}/apply-patch`, body)),
);

server.registerTool(
  'run_node',
  {
    title: 'Run Node Internally',
    description: 'Ask Breakdown to execute one node using the configured model provider.',
    inputSchema: {
      ...nodeInput,
      llmModel: z.string().optional(),
    },
  },
  async ({ nodeId, ...body }) =>
    textResult(await headlessRequest('POST', `/api/headless/nodes/${nodeId}/run`, body)),
);

server.registerTool(
  'run_graph',
  {
    title: 'Run Graph Internally',
    description: 'Ask Breakdown to execute the graph with its dependency-aware scheduler.',
    inputSchema: {
      ...graphInput,
      runId: z.string().min(1).max(100).default(`mcp-${randomUUID()}`),
    },
  },
  async ({ graphId, runId }) =>
    textResult(await headlessRequest('POST', `/api/headless/graphs/${graphId}/run`, { runId })),
);

server.registerTool(
  'get_run_status',
  {
    title: 'Get Run Status',
    description: 'Poll current node run statuses for a graph.',
    inputSchema: graphInput,
  },
  async ({ graphId }) =>
    textResult(await headlessRequest('GET', `/api/headless/graphs/${graphId}/run-status`)),
);

server.registerTool(
  'cancel_run',
  {
    title: 'Cancel Graph Run',
    description: 'Cancel queued work for an internal graph run.',
    inputSchema: graphInput,
  },
  async ({ graphId }) =>
    textResult(await headlessRequest('POST', `/api/headless/graphs/${graphId}/run-cancel`, {})),
);

server.registerTool(
  'create_external_run',
  {
    title: 'Create External Evaluator Run',
    description:
      'Create an external-evaluator run. The host model performs each step and writes results back.',
    inputSchema: {
      ...graphInput,
      clientName: z.string().max(100).optional(),
      providerName: z.string().max(100).optional(),
      metadata: jsonRecord.optional(),
    },
  },
  async ({ graphId, ...body }) =>
    textResult(
      await headlessRequest('POST', `/api/headless/graphs/${graphId}/external-runs`, body),
    ),
);

server.registerTool(
  'get_next_step',
  {
    title: 'Claim Next External Step',
    description:
      'Claim and return the next runnable external-evaluator work packet for a run, including prompt, upstream outputs, freshness warnings, and submit/block routes.',
    inputSchema: runInput,
  },
  async ({ runId }) =>
    textResult(await headlessRequest('GET', `/api/headless/external-runs/${runId}/next-step`)),
);

server.registerTool(
  'get_step_context',
  {
    title: 'Get External Step Context',
    description:
      'Refresh or debug the executable work packet for a known step. get_next_step already returns this packet for the selected step.',
    inputSchema: {
      ...runInput,
      stepId: uuid,
    },
  },
  async ({ runId, stepId }) =>
    textResult(
      await headlessRequest('GET', `/api/headless/external-runs/${runId}/steps/${stepId}/context`),
    ),
);

server.registerTool(
  'submit_step_result',
  {
    title: 'Submit External Step Result',
    description:
      'Submit externally-produced output and citations for a step. This writes to Breakdown history.',
    inputSchema: {
      ...runInput,
      stepId: uuid,
      contextVersion: z.string().min(1),
      output: z.string().min(1).max(250000),
      structuredSummary: jsonRecord.optional(),
      citations: z.array(jsonRecord).default([]),
      clientName: z.string().max(100).optional(),
      providerName: z.string().max(100).optional(),
    },
  },
  async ({ runId, stepId, ...body }) =>
    textResult(
      await headlessRequest(
        'POST',
        `/api/headless/external-runs/${runId}/steps/${stepId}/result`,
        body,
      ),
    ),
);

server.registerTool(
  'mark_step_blocked',
  {
    title: 'Mark External Step Blocked',
    description:
      'Mark a step blocked when required host-console tools or current data are unavailable.',
    inputSchema: {
      ...runInput,
      stepId: uuid,
      contextVersion: z.string().min(1),
      reason: z.string().min(1).max(5000),
      requiredData: z.array(z.string()).default([]),
      clientName: z.string().max(100).optional(),
      providerName: z.string().max(100).optional(),
    },
  },
  async ({ runId, stepId, ...body }) =>
    textResult(
      await headlessRequest(
        'POST',
        `/api/headless/external-runs/${runId}/steps/${stepId}/block`,
        body,
      ),
    ),
);

server.registerTool(
  'finalize_external_run',
  {
    title: 'Finalize External Run',
    description: 'Finalize an external-evaluator run after all steps are submitted or blocked.',
    inputSchema: {
      ...runInput,
      allowIncomplete: z.boolean().default(false),
    },
  },
  async ({ runId, allowIncomplete }) =>
    textResult(
      await headlessRequest('POST', `/api/headless/external-runs/${runId}/finalize`, {
        allowIncomplete,
      }),
    ),
);

server.registerTool(
  'summarize_run_delta',
  {
    title: 'Summarize Run Delta',
    description: 'Summarize submitted, blocked, and incomplete steps for an external run.',
    inputSchema: runInput,
  },
  async ({ runId }) => {
    const run = await headlessRequest<{
      steps: Array<{ status: string }>;
      run: { status: string };
    }>('GET', `/api/headless/external-runs/${runId}`);
    const counts = run.steps.reduce<Record<string, number>>((acc, step) => {
      acc[step.status] = (acc[step.status] ?? 0) + 1;
      return acc;
    }, {});
    return textResult({
      runStatus: run.run.status,
      stepCounts: counts,
      summary: `${counts.submitted ?? 0} submitted, ${counts.blocked ?? 0} blocked, ${
        (counts.pending ?? 0) + (counts.ready ?? 0) + (counts.in_progress ?? 0)
      } incomplete.`,
    });
  },
);

server.registerResource(
  'graphs',
  'breakdown://graphs',
  {
    title: 'Breakdown Graphs',
    mimeType: 'application/json',
    description: 'List of graphs visible to the token.',
  },
  async (uri) => resourceText(uri, await headlessRequest('GET', '/api/headless/graphs')),
);

server.registerResource(
  'graph',
  new ResourceTemplate('breakdown://graphs/{graphId}', { list: undefined }),
  {
    title: 'Breakdown Graph',
    mimeType: 'application/json',
    description: 'Graph with nodes and edges.',
  },
  async (uri, variables) =>
    resourceText(uri, await headlessRequest('GET', `/api/headless/graphs/${variables.graphId}`)),
);

server.registerResource(
  'graph_manifest',
  new ResourceTemplate('breakdown://graphs/{graphId}/manifest', { list: undefined }),
  {
    title: 'Breakdown Workflow Manifest',
    mimeType: 'application/json',
    description: 'Execution manifest for a graph.',
  },
  async (uri, variables) =>
    resourceText(
      uri,
      await headlessRequest('GET', `/api/headless/graphs/${variables.graphId}/manifest`),
    ),
);

server.registerResource(
  'graph_node',
  new ResourceTemplate('breakdown://graphs/{graphId}/nodes/{nodeId}', { list: undefined }),
  {
    title: 'Breakdown Graph Node',
    mimeType: 'application/json',
    description: 'One node from a graph.',
  },
  async (uri, variables) => {
    const graph = await headlessRequest<{ nodes: Array<{ id: string }> }>(
      'GET',
      `/api/headless/graphs/${variables.graphId}`,
    );
    return resourceText(uri, graph.nodes.find((node) => node.id === variables.nodeId) ?? null);
  },
);

server.registerResource(
  'graph_run_status',
  new ResourceTemplate('breakdown://graphs/{graphId}/runs/latest', { list: undefined }),
  {
    title: 'Breakdown Latest Run Status',
    mimeType: 'application/json',
    description: 'Current node run statuses for a graph.',
  },
  async (uri, variables) =>
    resourceText(
      uri,
      await headlessRequest('GET', `/api/headless/graphs/${variables.graphId}/run-status`),
    ),
);

server.registerResource(
  'external_run',
  new ResourceTemplate('breakdown://external-runs/{runId}', { list: undefined }),
  {
    title: 'Breakdown External Run',
    mimeType: 'application/json',
    description: 'External-evaluator run state.',
  },
  async (uri, variables) =>
    resourceText(
      uri,
      await headlessRequest('GET', `/api/headless/external-runs/${variables.runId}`),
    ),
);

server.registerResource(
  'external_run_step',
  new ResourceTemplate('breakdown://external-runs/{runId}/steps/{stepId}', { list: undefined }),
  {
    title: 'Breakdown External Step',
    mimeType: 'application/json',
    description: 'External-evaluator step context.',
  },
  async (uri, variables) =>
    resourceText(
      uri,
      await headlessRequest(
        'GET',
        `/api/headless/external-runs/${variables.runId}/steps/${variables.stepId}/context`,
      ),
    ),
);

function promptText(text: string) {
  return {
    messages: [
      {
        role: 'user' as const,
        content: { type: 'text' as const, text },
      },
    ],
  };
}

server.registerPrompt(
  'decompose_reasoning_chain',
  {
    title: 'Decompose Reasoning Chain',
    description: 'Turn a complex user goal into a Breakdown DAG outline.',
    argsSchema: {
      goal: z.string().min(1),
    },
  },
  ({ goal }) =>
    promptText(
      `Create a Breakdown DAG for this goal: ${goal}\nName nodes as concise action phrases. Use depends_on, inputs_to, supports, contradicts, assumes, and sequences_before edges. Preview the graph before applying writes.`,
    ),
);

server.registerPrompt(
  'follow_breakdown_graph',
  {
    title: 'Follow Breakdown',
    description: 'Execute an existing Breakdown externally step by step.',
    argsSchema: {
      graphId: uuid,
    },
  },
  ({ graphId }) =>
    promptText(
      `Use Breakdown graph ${graphId} in external-evaluator mode. Create an external run, claim each step with get_next_step, perform the work from the returned packet using available tools/connectors, submit outputs with citations, and finalize the run.`,
    ),
);

server.registerPrompt(
  'extend_graph_from_research',
  {
    title: 'Extend Graph From Research',
    description: 'Add or revise graph nodes based on new findings.',
    argsSchema: {
      graphId: uuid,
      findings: z.string().min(1),
    },
  },
  ({ graphId, findings }) =>
    promptText(
      `Review Breakdown graph ${graphId} against these findings:\n${findings}\nPropose a graph patch first. Use dryRun=true. Ask before applying destructive changes.`,
    ),
);

server.registerPrompt(
  'refresh_sources_and_propagate',
  {
    title: 'Refresh Sources And Propagate',
    description:
      'Refresh source/current-data steps using host tools and propagate downstream work.',
    argsSchema: {
      graphId: uuid,
    },
  },
  ({ graphId }) =>
    promptText(
      `Inspect Breakdown graph ${graphId} for stale source/current-data nodes. Use host-console tools such as web, filings, or FMP when available, submit refreshed outputs/citations through external-evaluator steps, then continue dependent reasoning.`,
    ),
);

server.registerPrompt(
  'summarize_graph_delta',
  {
    title: 'Summarize Graph Delta',
    description: 'Explain what changed after a run or patch.',
    argsSchema: {
      graphId: uuid,
      runId: uuid.optional(),
    },
  },
  ({ graphId, runId }) =>
    promptText(
      `Summarize what changed in Breakdown graph ${graphId}${runId ? ` after external run ${runId}` : ''}. Mention new outputs, blocked/data-gap steps, citations, and open questions.`,
    ),
);

await server.connect(new StdioServerTransport());

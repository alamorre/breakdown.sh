import { randomUUID } from 'crypto';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AI_MODEL_IDS } from '@/lib/ai/models';
import type { BreakdownActor } from '@/lib/breakdown-service/actor';
import {
  createGraphForActor,
  deleteGraphForActor,
  getGraphForActor,
  listGraphsForActor,
  updateGraphForActor,
} from '@/lib/breakdown-service/graphs';
import {
  createNodeForActor,
  deleteNodeForActor,
  runNodeForActor,
  updateNodeForActor,
} from '@/lib/breakdown-service/nodes';
import {
  createEdgeForActor,
  deleteEdgeForActor,
  updateEdgeForActor,
} from '@/lib/breakdown-service/edges';
import { applyGraphPatchForActor } from '@/lib/breakdown-service/patches';
import {
  cancelGraphRunForActor,
  getRunStatusForActor,
  runGraphForActor,
} from '@/lib/breakdown-service/runs';
import {
  createExternalRunForActor,
  blockExternalStepForActor,
  finalizeExternalRunForActor,
  getExternalRunForActor,
  getExternalStepContextForActor,
  getNextExternalStepForActor,
  submitExternalStepResultForActor,
} from '@/lib/breakdown-service/external-runs';
import {
  exportGraphForActor,
  getWorkflowManifestForActor,
  importGraphForActor,
} from '@/lib/breakdown-service/workflows';
import { applyGraphPatchSchema, importGraphSchema } from '@/lib/breakdown-service/schemas';
import {
  importAndRunExternalWorkflowSchema,
  importGraphAndCreateExternalRunForActor,
} from '@/lib/breakdown-service/workflow-runs';

function textResult(data: unknown = { ok: true }) {
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

const mcpApplyGraphPatchSchema = applyGraphPatchSchema.extend({
  graphId: uuid.describe('Breakdown graph id'),
});

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const destructiveAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const runAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

export function createBreakdownMcpServer(actor: BreakdownActor) {
  const server = new McpServer({
    name: 'breakdown-remote-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'list_graphs',
    {
      title: 'List Breakdown Graphs',
      description: 'List graphs available to the authenticated Breakdown integration token.',
      inputSchema: {},
      annotations: readOnlyAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:read' },
    },
    async () => textResult(await listGraphsForActor(actor)),
  );

  server.registerTool(
    'get_graph',
    {
      title: 'Get Breakdown Graph',
      description: 'Read a graph with its nodes and edges.',
      inputSchema: graphInput,
      annotations: readOnlyAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:read' },
    },
    async ({ graphId }) => textResult(await getGraphForActor(actor, graphId)),
  );

  server.registerTool(
    'create_graph',
    {
      title: 'Create Breakdown Graph',
      description: 'Create a new Breakdown reasoning graph.',
      inputSchema: {
        name: z.string().min(1).max(200),
        description: z.string().max(1000).nullable().optional(),
        llmModel: z.enum(AI_MODEL_IDS).optional(),
      },
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:write' },
    },
    async (input) => textResult(await createGraphForActor(actor, input)),
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
        llmModel: z.enum(AI_MODEL_IDS).optional(),
      },
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:write' },
    },
    async (input) => textResult(await updateGraphForActor(actor, input)),
  );

  server.registerTool(
    'delete_graph',
    {
      title: 'Delete Breakdown Graph',
      description:
        'Delete a graph and all of its nodes/edges. Requires explicit user confirmation.',
      inputSchema: graphInput,
      annotations: destructiveAnnotations,
      _meta: {
        'breakdown/requiredScope': 'graphs:write',
        'breakdown/confirmation': 'Confirm before deleting a graph and its contents.',
      },
    },
    async ({ graphId }) => {
      await deleteGraphForActor(actor, graphId);
      return textResult();
    },
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
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:write' },
    },
    async ({ graphId, ...body }) =>
      textResult(await createNodeForActor(actor, { graphId, ...body })),
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
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:write' },
    },
    async (input) => textResult(await updateNodeForActor(actor, input)),
  );

  server.registerTool(
    'delete_node',
    {
      title: 'Delete Breakdown Node',
      description: 'Delete a node and incident edges. Requires explicit user confirmation.',
      inputSchema: nodeInput,
      annotations: destructiveAnnotations,
      _meta: {
        'breakdown/requiredScope': 'graphs:write',
        'breakdown/confirmation': 'Confirm before deleting a node and incident edges.',
      },
    },
    async ({ nodeId }) => {
      await deleteNodeForActor(actor, nodeId);
      return textResult();
    },
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
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:write' },
    },
    async ({ graphId, ...body }) =>
      textResult(await createEdgeForActor(actor, { graphId, ...body })),
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
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:write' },
    },
    async (input) => textResult(await updateEdgeForActor(actor, input)),
  );

  server.registerTool(
    'delete_edge',
    {
      title: 'Delete Breakdown Edge',
      description: 'Delete an edge. Requires explicit user confirmation.',
      inputSchema: edgeInput,
      annotations: destructiveAnnotations,
      _meta: {
        'breakdown/requiredScope': 'graphs:write',
        'breakdown/confirmation': 'Confirm before deleting an edge.',
      },
    },
    async ({ edgeId }) => {
      await deleteEdgeForActor(actor, edgeId);
      return textResult();
    },
  );

  server.registerTool(
    'export_graph',
    {
      title: 'Export Breakdown Graph',
      description: 'Export a complete machine-readable graph representation.',
      inputSchema: graphInput,
      annotations: readOnlyAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:read' },
    },
    async ({ graphId }) => textResult(await exportGraphForActor(actor, graphId)),
  );

  server.registerTool(
    'import_graph',
    {
      title: 'Import Breakdown Graph',
      description:
        'Create or replace a graph from the headless export/import shape. Replace mode requires explicit user confirmation.',
      inputSchema: importGraphSchema,
      annotations: destructiveAnnotations,
      _meta: {
        'breakdown/requiredScope': 'graphs:write',
        'breakdown/confirmation': 'Confirm before using replace mode.',
      },
    },
    async (input) => textResult(await importGraphForActor(actor, input)),
  );

  server.registerTool(
    'import_graph_and_create_external_run',
    {
      title: 'Import Graph And Create External Run',
      description:
        'Create or replace a graph from a generic import shape, then start an external-evaluator run for host-console execution.',
      inputSchema: importAndRunExternalWorkflowSchema,
      annotations: destructiveAnnotations,
      _meta: {
        'breakdown/requiredScope': ['graphs:write', 'runs:external_execute'],
        'breakdown/confirmation': 'Confirm before using replace mode.',
      },
    },
    async (input) => textResult(await importGraphAndCreateExternalRunForActor(actor, input)),
  );

  server.registerTool(
    'get_workflow_manifest',
    {
      title: 'Get Workflow Manifest',
      description: 'Get the execution-ready manifest for a graph, including topological order.',
      inputSchema: graphInput,
      annotations: readOnlyAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:read' },
    },
    async ({ graphId }) => textResult(await getWorkflowManifestForActor(actor, graphId)),
  );

  server.registerTool(
    'apply_graph_patch',
    {
      title: 'Apply Graph Patch',
      description:
        'Preview or apply a structured graph patch. Use dryRun first and confirm before destructive apply.',
      inputSchema: mcpApplyGraphPatchSchema,
      annotations: destructiveAnnotations,
      _meta: {
        'breakdown/requiredScope': 'graphs:write',
        'breakdown/confirmation': 'Run with dryRun=true first and confirm before applying changes.',
      },
    },
    async ({ graphId, ...body }) => textResult(await applyGraphPatchForActor(actor, graphId, body)),
  );

  server.registerTool(
    'run_node',
    {
      title: 'Run Node Internally',
      description: 'Ask Breakdown to execute one node using the configured model provider.',
      inputSchema: {
        ...nodeInput,
        llmModel: z.enum(AI_MODEL_IDS).optional(),
      },
      annotations: runAnnotations,
      _meta: { 'breakdown/requiredScope': 'runs:execute' },
    },
    async (input) => textResult(await runNodeForActor(actor, input)),
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
      annotations: runAnnotations,
      _meta: { 'breakdown/requiredScope': 'runs:execute' },
    },
    async (input) => textResult(await runGraphForActor(actor, input)),
  );

  server.registerTool(
    'get_run_status',
    {
      title: 'Get Run Status',
      description: 'Poll current node run statuses for a graph.',
      inputSchema: graphInput,
      annotations: readOnlyAnnotations,
      _meta: { 'breakdown/requiredScope': 'graphs:read' },
    },
    async ({ graphId }) => textResult(await getRunStatusForActor(actor, graphId)),
  );

  server.registerTool(
    'cancel_run',
    {
      title: 'Cancel Graph Run',
      description: 'Cancel queued work for an internal graph run.',
      inputSchema: graphInput,
      annotations: destructiveAnnotations,
      _meta: {
        'breakdown/requiredScope': 'runs:cancel',
        'breakdown/confirmation': 'Confirm before cancelling an active graph run.',
      },
    },
    async ({ graphId }) => textResult(await cancelGraphRunForActor(actor, graphId)),
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
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'runs:external_execute' },
    },
    async ({ graphId, ...body }) =>
      textResult(await createExternalRunForActor(actor, graphId, body)),
  );

  server.registerTool(
    'get_next_step',
    {
      title: 'Claim Next External Step',
      description:
        'Claim and return the next runnable external-evaluator work packet for a run, including prompt, upstream outputs, freshness warnings, and submit/block routes.',
      inputSchema: runInput,
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'runs:external_execute' },
    },
    async ({ runId }) => textResult(await getNextExternalStepForActor(actor, runId)),
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
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'runs:external_execute' },
    },
    async ({ runId, stepId }) =>
      textResult(await getExternalStepContextForActor(actor, runId, stepId)),
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
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'runs:write_results' },
    },
    async ({ runId, stepId, ...body }) =>
      textResult(await submitExternalStepResultForActor(actor, runId, stepId, body)),
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
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'runs:write_results' },
    },
    async ({ runId, stepId, ...body }) =>
      textResult(await blockExternalStepForActor(actor, runId, stepId, body)),
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
      annotations: writeAnnotations,
      _meta: { 'breakdown/requiredScope': 'runs:external_execute' },
    },
    async ({ runId, allowIncomplete }) =>
      textResult(await finalizeExternalRunForActor(actor, runId, { allowIncomplete })),
  );

  server.registerTool(
    'summarize_run_delta',
    {
      title: 'Summarize Run Delta',
      description: 'Summarize submitted, blocked, and incomplete steps for an external run.',
      inputSchema: runInput,
      annotations: readOnlyAnnotations,
      _meta: { 'breakdown/requiredScope': 'runs:external_execute' },
    },
    async ({ runId }) => {
      const run = await getExternalRunForActor(actor, runId);
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
    async (uri) => resourceText(uri, await listGraphsForActor(actor)),
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
      resourceText(uri, await getGraphForActor(actor, String(variables.graphId))),
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
      resourceText(uri, await getWorkflowManifestForActor(actor, String(variables.graphId))),
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
      const graph = await getGraphForActor(actor, String(variables.graphId));
      return resourceText(
        uri,
        graph.nodes.find((node) => node.id === String(variables.nodeId)) ?? null,
      );
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
      resourceText(uri, await getRunStatusForActor(actor, String(variables.graphId))),
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
      resourceText(uri, await getExternalRunForActor(actor, String(variables.runId))),
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
        await getExternalStepContextForActor(
          actor,
          String(variables.runId),
          String(variables.stepId),
        ),
      ),
  );

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
        `Inspect Breakdown graph ${graphId} for stale source/current-data nodes. Use host-console tools such as web, filings, or market data connectors when available, submit refreshed outputs/citations through external-evaluator steps, then continue dependent reasoning.`,
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
        `Summarize what changed in Breakdown graph ${graphId}${
          runId ? ` after external run ${runId}` : ''
        }. Mention new outputs, blocked/data-gap steps, citations, and open questions.`,
      ),
  );

  return server;
}

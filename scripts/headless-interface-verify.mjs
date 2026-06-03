#!/usr/bin/env node
/* eslint-disable no-console */

import { randomUUID } from 'node:crypto';

const BASE_URL = process.env.THESIS_BASE_URL ?? 'http://localhost:3000';
const API_TOKEN = process.env.THESIS_API_TOKEN;
const INVALID_TOKEN = process.env.THESIS_INVALID_TOKEN ?? 'bdk_invalid_token';

const requiredMcpTools = [
  'list_graphs',
  'get_graph',
  'create_graph',
  'update_graph',
  'delete_graph',
  'create_node',
  'update_node',
  'delete_node',
  'connect_nodes',
  'update_edge',
  'delete_edge',
  'export_graph',
  'import_graph',
  'import_graph_and_create_external_run',
  'get_workflow_manifest',
  'apply_graph_patch',
  'run_node',
  'run_graph',
  'get_run_status',
  'cancel_run',
  'create_external_run',
  'get_next_step',
  'get_step_context',
  'submit_step_result',
  'mark_step_blocked',
  'finalize_external_run',
  'summarize_run_delta',
];

function endpoint(path) {
  return new URL(path, BASE_URL).toString();
}

function logStep(name) {
  console.log(`ok - ${name}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function headlessRequest(method, path, body, options = {}) {
  const response = await fetch(endpoint(path), {
    method,
    headers: {
      Authorization: `Bearer ${options.token ?? API_TOKEN}`,
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
  const envelope = await readJson(response);

  if (options.expectStatus !== undefined) {
    assert(
      response.status === options.expectStatus,
      `${method} ${path} returned ${response.status}, expected ${options.expectStatus}: ${JSON.stringify(envelope)}`,
    );
    return { response, envelope };
  }

  assert(response.ok, `${method} ${path} returned ${response.status}: ${JSON.stringify(envelope)}`);
  assert(envelope?.error === null, `${method} ${path} returned an error: ${JSON.stringify(envelope)}`);
  return envelope.data;
}

async function mcpRpc(method, params = {}) {
  const response = await fetch(endpoint('/api/mcp'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method,
      params,
    }),
  });
  const body = await readJson(response);
  assert(response.ok, `MCP ${method} returned ${response.status}: ${JSON.stringify(body)}`);
  assert(!body?.error, `MCP ${method} returned an error: ${JSON.stringify(body)}`);
  return body.result;
}

function requireTool(tools, name) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert(tool, `MCP tools/list did not include ${name}`);
  assert(tool.inputSchema, `MCP tool ${name} is missing inputSchema`);
  return tool;
}

async function verifyMcpToolSchemaWiring() {
  await mcpRpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'headless-interface-verify', version: '0.1.0' },
  });

  const listed = await mcpRpc('tools/list');
  const tools = listed.tools ?? [];
  for (const tool of requiredMcpTools) {
    requireTool(tools, tool);
  }

  const applyPatch = requireTool(tools, 'apply_graph_patch');
  assert(
    applyPatch.annotations?.destructiveHint === true,
    'apply_graph_patch should advertise destructiveHint for client confirmations',
  );

  const submitStep = requireTool(tools, 'submit_step_result');
  const submitProperties = submitStep.inputSchema.properties ?? {};
  for (const field of ['runId', 'stepId', 'contextVersion', 'output']) {
    assert(submitProperties[field], `submit_step_result is missing ${field} input schema`);
  }

  logStep('MCP tool schema wiring');
}

async function main() {
  if (!API_TOKEN) {
    console.error('THESIS_API_TOKEN is required. Create one with pnpm headless:token or Settings > MCP Access.');
    process.exit(1);
  }

  let graphId = null;
  try {
    const invalidAuth = await headlessRequest('GET', '/api/headless/graphs', undefined, {
      token: INVALID_TOKEN,
      expectStatus: 401,
    });
    assert(invalidAuth.envelope?.error, 'Invalid token should return a headless error envelope');
    logStep('token auth rejects invalid bearer tokens');

    await verifyMcpToolSchemaWiring();

    const graph = await headlessRequest('POST', '/api/headless/graphs', {
      name: `Headless verify ${new Date().toISOString()}`,
      description: 'Local-first verification graph for the headless agent interface.',
    });
    graphId = graph.id;
    assert(graphId, 'Created graph did not include an id');

    await headlessRequest('PATCH', `/api/headless/graphs/${graphId}`, {
      description: 'Updated by headless interface verification.',
    });

    const sourceNode = await headlessRequest('POST', `/api/headless/graphs/${graphId}/nodes`, {
      name: 'Gather current evidence',
      nodeType: 'external-current-data',
      prompt: 'Gather current evidence with host-console tools. Block if unavailable.',
      metadata: {
        requiresCurrentData: true,
        expectedOutput: 'Evidence packet with citations or data gaps.',
      },
      positionX: 0,
      positionY: 0,
    });

    const analysisNode = await headlessRequest('POST', `/api/headless/graphs/${graphId}/nodes`, {
      name: 'Analyze evidence',
      nodeType: 'external-evaluator',
      prompt: 'Analyze the upstream evidence and identify the main implication.',
      metadata: {
        expectedOutput: 'Concise analysis with cited support.',
      },
      positionX: 280,
      positionY: 0,
    });

    const edge = await headlessRequest('POST', `/api/headless/graphs/${graphId}/edges`, {
      sourceNodeId: sourceNode.id,
      targetNodeId: analysisNode.id,
      edgeType: 'inputs_to',
      weight: 1,
      condition: 'Use the evidence packet.',
    });

    await headlessRequest('PATCH', `/api/headless/nodes/${analysisNode.id}`, {
      metadata: { expectedOutput: 'Updated verification analysis.' },
    });
    await headlessRequest('PATCH', `/api/headless/edges/${edge.id}`, {
      condition: 'Use only cited or explicitly blocked evidence.',
    });

    const graphRead = await headlessRequest('GET', `/api/headless/graphs/${graphId}`);
    assert(graphRead.nodes.length === 2, 'CRUD readback should include two nodes before patching');
    assert(graphRead.edges.length === 1, 'CRUD readback should include one edge before patching');
    logStep('CRUD graph/node/edge create, update, and readback');

    const patch = {
      operations: [
        {
          op: 'add_node',
          clientId: 'summary',
          name: 'Summarize result',
          nodeType: 'external-evaluator',
          prompt: 'Summarize what changed and list open questions.',
          positionX: 560,
          positionY: 0,
        },
        {
          op: 'add_edge',
          sourceNodeId: analysisNode.id,
          targetClientId: 'summary',
          edgeType: 'inputs_to',
          condition: 'Summarize the analysis.',
        },
      ],
    };

    const preview = await headlessRequest('POST', `/api/headless/graphs/${graphId}/apply-patch`, {
      dryRun: true,
      ...patch,
    });
    assert(preview.applied === false, 'Patch preview should not apply changes');
    assert(preview.changes.length === 2, 'Patch preview should report two changes');

    const applied = await headlessRequest('POST', `/api/headless/graphs/${graphId}/apply-patch`, {
      dryRun: false,
      ...patch,
    });
    assert(applied.applied === true, 'Patch apply should report applied=true');
    assert(applied.createdNodeIds?.summary, 'Patch apply should return the created summary node id');
    logStep('patch preview and apply');

    const runStatus = await headlessRequest('GET', `/api/headless/graphs/${graphId}/run-status`);
    const statusNodes = runStatus.data?.nodes ?? runStatus.nodes ?? [];
    assert(statusNodes.length === 3, 'Internal run status should include patched graph nodes');
    logStep('internal run status polling');

    const externalRun = await headlessRequest('POST', `/api/headless/graphs/${graphId}/external-runs`, {
      clientName: 'headless-interface-verify',
      providerName: 'local script',
      metadata: { purpose: 'local verification' },
    });
    const runId = externalRun.runId;
    assert(runId, 'External run did not include runId');

    const firstStep = await headlessRequest('GET', `/api/headless/external-runs/${runId}/next-step`);
    assert(firstStep.step?.stepId, 'Expected a first ready external step');
    const firstContext = await headlessRequest(
      'GET',
      `/api/headless/external-runs/${runId}/steps/${firstStep.step.stepId}/context`,
    );
    await headlessRequest(
      'POST',
      `/api/headless/external-runs/${runId}/steps/${firstStep.step.stepId}/result`,
      {
        contextVersion: firstContext.contextVersion,
        output: 'Verification fixture evidence. No live external facts were used.',
        structuredSummary: { summary: 'Submitted fixture evidence.' },
        citations: [
          {
            source: 'local verification fixture',
            accessedAt: new Date().toISOString(),
            note: 'This verifies persistence, not factual retrieval.',
          },
        ],
        clientName: 'headless-interface-verify',
        providerName: 'local script',
      },
    );

    const secondStep = await headlessRequest('GET', `/api/headless/external-runs/${runId}/next-step`);
    assert(secondStep.step?.stepId, 'Expected a second ready external step after submission');
    const secondContext = await headlessRequest(
      'GET',
      `/api/headless/external-runs/${runId}/steps/${secondStep.step.stepId}/context`,
    );
    await headlessRequest(
      'POST',
      `/api/headless/external-runs/${runId}/steps/${secondStep.step.stepId}/block`,
      {
        contextVersion: secondContext.contextVersion,
        reason: 'Verification intentionally blocks the second step to exercise data-gap handling.',
        requiredData: ['host-console qualitative review'],
        clientName: 'headless-interface-verify',
        providerName: 'local script',
      },
    );

    const finalized = await headlessRequest(
      'POST',
      `/api/headless/external-runs/${runId}/finalize`,
      { allowIncomplete: true },
    );
    assert(finalized.status === 'blocked', 'Finalize should mark run blocked after a blocked step');
    assert(finalized.metrics.submitted === 1, 'Finalize metrics should count one submitted step');
    assert(finalized.metrics.blocked === 1, 'Finalize metrics should count one blocked step');
    logStep('external step submit, block, and finalize');

    await headlessRequest('DELETE', `/api/headless/graphs/${graphId}`);
    logStep('cleanup graph delete');
    graphId = null;

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl: BASE_URL,
          verified: [
            'token-auth',
            'crud',
            'patch-preview-apply',
            'internal-run-status',
            'external-submit-block-finalize',
            'mcp-tool-schema-wiring',
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    if (graphId) {
      try {
        await headlessRequest('DELETE', `/api/headless/graphs/${graphId}`);
        console.error(`cleanup - deleted graph ${graphId}`);
      } catch (err) {
        console.error(
          `cleanup - failed to delete graph ${graphId}: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

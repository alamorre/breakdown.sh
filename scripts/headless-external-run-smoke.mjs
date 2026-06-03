#!/usr/bin/env node
/* eslint-disable no-console */

import { randomUUID } from 'node:crypto';

const BASE_URL = process.env.BREAKDOWN_BASE_URL ?? 'http://localhost:3000';
const API_TOKEN = process.env.BREAKDOWN_API_TOKEN;

function readArg(name) {
  const flag = `--${name}`;
  const index = process.argv.indexOf(flag);
  if (index === -1) return null;
  return process.argv[index + 1] ?? null;
}

const goal = readArg('goal') ?? 'Analyze a public company using current evidence';
const mode = readArg('mode') ?? 'block';

if (!API_TOKEN) {
  console.error('BREAKDOWN_API_TOKEN is required.');
  process.exit(1);
}

if (!['block', 'submit'].includes(mode)) {
  console.error('--mode must be "block" or "submit".');
  process.exit(1);
}

function endpoint(path) {
  return new URL(path, BASE_URL).toString();
}

async function request(method, path, body) {
  const response = await fetch(endpoint(path), {
    method,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
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

  const envelope = await response.json().catch(() => null);
  if (!response.ok || envelope?.error) {
    throw new Error(envelope?.error?.message ?? `Request failed: ${response.status}`);
  }

  return envelope.data;
}

function smokeGraphImport() {
  return {
    mode: 'create',
    graph: {
      name: `External console smoke: ${goal}`,
      description:
        'Generic external-evaluator smoke DAG. Current-data requirements are represented as host-tool instructions.',
    },
    nodes: [
      {
        id: 'current-evidence',
        name: 'Gather current evidence',
        nodeType: 'external-current-data',
        prompt: [
          `Gather current evidence for this goal: ${goal}`,
          'Use host-console tools/connectors such as web, search, filings, market data, or internal knowledge bases when available.',
          'If the required current data is unavailable, mark this step blocked and list the missing data.',
        ].join('\n\n'),
        metadata: {
          requiresCurrentData: true,
          suggestedHostTools: ['web/search', 'filings', 'market data', 'workspace connectors'],
          hostToolInstructions:
            'Use available host-console tools for current facts. If unavailable, block this step as a data gap instead of using model memory.',
          expectedOutput:
            'Current evidence packet with citations, source timestamps, or data gaps.',
        },
        position: { x: 0, y: 0 },
      },
      {
        id: 'synthesize-answer',
        name: 'Synthesize answer',
        nodeType: 'external-evaluator',
        prompt: [
          `Synthesize a concise answer for this goal: ${goal}`,
          'Use the upstream current-evidence packet. Separate facts, assumptions, uncertainty, and open questions.',
        ].join('\n\n'),
        metadata: {
          hostToolInstructions:
            'Use upstream outputs first. Cite any additional external facts gathered in the host console.',
          expectedOutput:
            'Concise composition with facts, assumptions, uncertainty, and open questions.',
        },
        position: { x: 320, y: 0 },
      },
    ],
    edges: [
      {
        sourceNodeId: 'current-evidence',
        targetNodeId: 'synthesize-answer',
        edgeType: 'inputs_to',
        weight: 1,
        condition: 'Requires current evidence or an explicit data-gap result.',
      },
    ],
  };
}

async function main() {
  const firstRun = await request('POST', '/api/headless/workflows/import-and-run', {
    importGraph: smokeGraphImport(),
    externalRun: {
      clientName: 'headless smoke',
      providerName: 'local script',
      metadata: { goal, mode },
    },
  });

  const step = firstRun.externalRun.nextStep.step;
  if (!step) {
    throw new Error('Expected a ready external step.');
  }

  const context = await request(
    'GET',
    `/api/headless/external-runs/${firstRun.externalRun.runId}/steps/${step.stepId}/context`,
  );

  let stepResult;
  if (mode === 'block') {
    stepResult = await request(
      'POST',
      `/api/headless/external-runs/${firstRun.externalRun.runId}/steps/${step.stepId}/block`,
      {
        contextVersion: context.contextVersion,
        reason:
          'Smoke test intentionally blocked the current-data step to verify data-gap persistence.',
        requiredData: ['current evidence from host-console tools'],
        clientName: 'headless smoke',
        providerName: 'local script',
      },
    );
  } else {
    stepResult = await request(
      'POST',
      `/api/headless/external-runs/${firstRun.externalRun.runId}/steps/${step.stepId}/result`,
      {
        contextVersion: context.contextVersion,
        output:
          'Smoke fixture output: host-console current-data tools are assumed available for this test run.',
        structuredSummary: { summary: 'Submitted smoke fixture output.' },
        citations: [
          {
            source: 'local fixture',
            note: 'No external facts used by this smoke test.',
            accessedAt: new Date().toISOString(),
          },
        ],
        clientName: 'headless smoke',
        providerName: 'local script',
      },
    );
  }

  const finalized = await request(
    'POST',
    `/api/headless/external-runs/${firstRun.externalRun.runId}/finalize`,
    { allowIncomplete: true },
  );

  console.log(
    JSON.stringify(
      {
        graphId: firstRun.graphId,
        graphUrl: firstRun.graphUrl,
        runId: firstRun.externalRun.runId,
        firstStep: stepResult,
        finalized,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

#!/usr/bin/env node
/* eslint-disable no-console */

import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const DEFAULT_MARKETPLACE_REPO = 'alamorre/breakdown.sh';
const DEFAULT_BASE_URL = 'https://www.breakdown.sh';
const DEFAULT_MARKDOWN_OUTPUT = 'plugin-smoke-test.md';
const TOKEN_ENV_NAME = 'BREAKDOWN_RELEASE_TEST_TOKEN';
const SECRET_REDACTION = '[REDACTED]';
const RECOMMENDATIONS = new Set(['promote', 'promote-with-known-issues', 'block']);

function readFlag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

function usage() {
  return [
    'Usage: pnpm plugin:release:smoke -- --ref <pr-head-ref> --candidate-version <x.y.z> [options]',
    '',
    'Options:',
    '  --pr <number>                    PR number under test. Derives refs/pull/<number>/head when --ref is omitted.',
    '  --ref <branch|sha|refs/...>      Candidate ref to install and test. main/master are rejected.',
    '  --candidate-version <x.y.z>      Candidate plugin version under test.',
    `  --marketplace-repo <repo>        GitHub repo passed to codex marketplace add. Default: ${DEFAULT_MARKETPLACE_REPO}`,
    `  --base-url <url>                 Hosted Breakdown base URL. Default: ${DEFAULT_BASE_URL}`,
    `  --output <path>                  Markdown report path. Default: ${DEFAULT_MARKDOWN_OUTPUT}`,
    '  --json-output <path>             Structured JSON path. Default: output path with .json extension.',
    '  --baseline <path>                Optional promoted baseline summary path for later comparison.',
    '  --skip-install                  Skip codex plugin install and only exercise hosted APIs.',
    '  --dry-run                       Write deterministic fixture reports without network or Codex CLI.',
  ].join('\n');
}

export function deriveJsonOutputPath(markdownOutputPath) {
  if (markdownOutputPath.endsWith('.md')) {
    return markdownOutputPath.replace(/\.md$/, '.json');
  }

  return `${markdownOutputPath}.json`;
}

export function deriveRef({ pr, ref }) {
  if (ref) return ref;
  if (pr) return `refs/pull/${pr}/head`;
  return null;
}

export function isForbiddenMainRef(ref) {
  const normalized = ref?.trim().toLowerCase();
  return ['main', 'master', 'origin/main', 'origin/master', 'refs/heads/main', 'refs/heads/master'].includes(
    normalized,
  );
}

export function redactSecrets(value, secrets = []) {
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secrets) {
    if (secret) {
      text = text.split(secret).join(SECRET_REDACTION);
    }
  }
  return text;
}

export function parseArgs(argv = process.argv.slice(2), env = process.env) {
  const pr = readFlag(argv, 'pr');
  const candidateRef = deriveRef({ pr, ref: readFlag(argv, 'ref') });
  const candidateVersion = readFlag(argv, 'candidate-version');
  const outputPath = readFlag(argv, 'output') ?? DEFAULT_MARKDOWN_OUTPUT;

  if (hasFlag(argv, 'help')) {
    return { help: true };
  }

  if (!candidateRef || !candidateVersion) {
    throw new Error(`${usage()}\n\n--ref or --pr and --candidate-version are required.`);
  }

  if (isForbiddenMainRef(candidateRef)) {
    throw new Error(
      `Ref "${candidateRef}" points at main/master. Release smoke tests must run against a PR candidate ref.`,
    );
  }

  return {
    pr,
    candidateRef,
    candidateVersion,
    marketplaceRepo: readFlag(argv, 'marketplace-repo') ?? DEFAULT_MARKETPLACE_REPO,
    baseUrl: readFlag(argv, 'base-url') ?? env.BREAKDOWN_BASE_URL ?? DEFAULT_BASE_URL,
    outputPath,
    jsonOutputPath: readFlag(argv, 'json-output') ?? deriveJsonOutputPath(outputPath),
    baselinePath: readFlag(argv, 'baseline'),
    dryRun: hasFlag(argv, 'dry-run'),
    skipInstall: hasFlag(argv, 'skip-install'),
    token: env[TOKEN_ENV_NAME] ?? '',
  };
}

function durationMs(startedAt) {
  return Date.now() - startedAt;
}

function endpoint(baseUrl, path) {
  return new URL(path, baseUrl).toString();
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function requestJson({ baseUrl, token, method, path, body, secrets }) {
  const response = await fetch(endpoint(baseUrl, path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
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

  if (!response.ok || envelope?.error) {
    const message = envelope?.error?.message ?? `Request failed: ${response.status}`;
    throw new Error(redactSecrets(message, secrets));
  }

  return envelope.data;
}

async function mcpRpc({ baseUrl, token, method, params = {}, secrets }) {
  const response = await fetch(endpoint(baseUrl, '/api/mcp'), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
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

  if (!response.ok || body?.error) {
    throw new Error(
      redactSecrets(body?.error?.message ?? `MCP ${method} failed with ${response.status}`, secrets),
    );
  }

  return body.result;
}

function summarizeError(err, secrets) {
  return redactSecrets(err instanceof Error ? err.message : String(err), secrets);
}

function commandDisplay(command, args) {
  return [command, ...args].join(' ');
}

async function runCommand(command, args, { cwd, env, secrets }) {
  const startedAt = Date.now();
  const display = commandDisplay(command, args);

  return await new Promise((resolveCommand) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (err) => {
      resolveCommand({
        command: display,
        ok: false,
        exitCode: null,
        elapsedMs: durationMs(startedAt),
        output: redactSecrets(err.message, secrets),
      });
    });

    child.on('close', (exitCode) => {
      const output = [stdout, stderr].filter(Boolean).join('\n').trim();
      resolveCommand({
        command: display,
        ok: exitCode === 0,
        exitCode,
        elapsedMs: durationMs(startedAt),
        output: redactSecrets(output, secrets).slice(0, 4000),
      });
    });
  });
}

async function installCandidate({ marketplaceRepo, candidateRef, token, secrets }) {
  const startedAt = Date.now();
  const workspace = await mkdtemp(resolve(tmpdir(), 'breakdown-plugin-release-smoke-'));
  const home = resolve(workspace, 'home');
  const codexHome = resolve(workspace, 'codex');
  await mkdir(home, { recursive: true });
  await mkdir(codexHome, { recursive: true });

  const env = {
    ...process.env,
    HOME: home,
    CODEX_HOME: codexHome,
    BREAKDOWN_API_TOKEN: token,
  };

  const commands = [
    {
      command: 'codex',
      args: [
        'plugin',
        'marketplace',
        'add',
        marketplaceRepo,
        '--ref',
        candidateRef,
        '--sparse',
        '.agents/plugins',
        '--sparse',
        'plugins/breakdown',
      ],
    },
    { command: 'codex', args: ['plugin', 'add', 'breakdown@breakdown'] },
  ];

  const results = [];
  for (const item of commands) {
    const result = await runCommand(item.command, item.args, {
      cwd: workspace,
      env,
      secrets,
    });
    results.push(result);
    if (!result.ok) break;
  }

  return {
    ok: results.every((result) => result.ok),
    skipped: false,
    isolatedContext: workspace,
    commands: results,
    elapsedMs: durationMs(startedAt),
  };
}

function tinyReleaseGraph({ candidateVersion, candidateRef }) {
  return {
    mode: 'create',
    graph: {
      name: `Plugin release smoke ${candidateVersion}`,
      description: `Release-test graph for Breakdown plugin candidate ${candidateVersion} at ${candidateRef}.`,
    },
    nodes: [
      {
        id: 'evaluate-candidate',
        name: 'Evaluate plugin candidate',
        nodeType: 'external-evaluator',
        prompt: [
          `Verify the Breakdown Codex plugin candidate ${candidateVersion}.`,
          `Candidate ref: ${candidateRef}.`,
          'Return a concise setup and MCP usability observation for release triage.',
        ].join('\n'),
        metadata: {
          releaseTest: true,
          candidateVersion,
          candidateRef,
          expectedOutput: 'Concise release-test observation.',
        },
        position: { x: 0, y: 0 },
      },
    ],
    edges: [],
  };
}

async function runHostedSmoke(options) {
  const startedAt = Date.now();
  const secrets = [options.token];
  let graphId = null;
  const result = {
    ok: false,
    toolsList: null,
    graphListing: null,
    importedGraph: null,
    externalRun: null,
    cleanup: null,
    elapsedMs: 0,
  };

  try {
    await mcpRpc({
      baseUrl: options.baseUrl,
      token: options.token,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'plugin-release-smoke', version: options.candidateVersion },
      },
      secrets,
    });

    const listed = await mcpRpc({
      baseUrl: options.baseUrl,
      token: options.token,
      method: 'tools/list',
      secrets,
    });
    const tools = listed.tools ?? [];
    result.toolsList = {
      ok: true,
      count: tools.length,
      toolNames: tools.map((tool) => tool.name).filter(Boolean).sort(),
    };

    const graphList = await requestJson({
      baseUrl: options.baseUrl,
      token: options.token,
      method: 'GET',
      path: '/api/headless/graphs',
      secrets,
    });
    const graphs = Array.isArray(graphList) ? graphList : (graphList.graphs ?? graphList.data ?? []);
    result.graphListing = {
      ok: true,
      count: Array.isArray(graphs) ? graphs.length : null,
    };

    const firstRun = await requestJson({
      baseUrl: options.baseUrl,
      token: options.token,
      method: 'POST',
      path: '/api/headless/workflows/import-and-run',
      body: {
        importGraph: tinyReleaseGraph(options),
        externalRun: {
          clientName: 'plugin-release-smoke',
          providerName: 'release-test',
          metadata: {
            purpose: 'release_test',
            candidateVersion: options.candidateVersion,
            candidateRef: options.candidateRef,
            marketplaceRepo: options.marketplaceRepo,
          },
        },
      },
      secrets,
    });

    graphId = firstRun.graphId;
    result.importedGraph = {
      ok: Boolean(firstRun.graphId),
      graphId: firstRun.graphId ?? null,
      graphUrl: firstRun.graphUrl ?? null,
    };

    const step = firstRun.externalRun?.nextStep?.step;
    if (!step?.submission?.submitRoute || !step.contextVersion) {
      throw new Error('Expected import-and-run to return a ready external-evaluator step.');
    }

    const stepResult = await requestJson({
      baseUrl: options.baseUrl,
      token: options.token,
      method: 'POST',
      path: step.submission.submitRoute,
      body: {
        contextVersion: step.contextVersion,
        output:
          'Release smoke fixture result: candidate plugin installed and hosted MCP/headless APIs were reachable.',
        structuredSummary: {
          summary: 'Manual release smoke submitted a fixture evaluator result.',
          candidateVersion: options.candidateVersion,
          candidateRef: options.candidateRef,
        },
        citations: [
          {
            source: 'plugin-release-smoke',
            note: 'No external factual claims were used.',
            accessedAt: new Date().toISOString(),
          },
        ],
        clientName: 'plugin-release-smoke',
        providerName: 'release-test',
      },
      secrets,
    });

    const finalized = await requestJson({
      baseUrl: options.baseUrl,
      token: options.token,
      method: 'POST',
      path: `/api/headless/external-runs/${firstRun.externalRun.runId}/finalize`,
      body: { allowIncomplete: true },
      secrets,
    });

    result.externalRun = {
      ok: true,
      runId: firstRun.externalRun.runId,
      firstStepId: step.stepId ?? null,
      firstStepResult: {
        status: stepResult.status ?? stepResult.result?.status ?? 'submitted',
      },
      finalized,
    };

    result.ok = true;
    return result;
  } finally {
    if (graphId) {
      try {
        await requestJson({
          baseUrl: options.baseUrl,
          token: options.token,
          method: 'DELETE',
          path: `/api/headless/graphs/${graphId}`,
          secrets,
        });
        result.cleanup = { ok: true, graphId, action: 'deleted' };
      } catch (err) {
        result.cleanup = { ok: false, graphId, error: summarizeError(err, secrets) };
      }
    }
    result.elapsedMs = durationMs(startedAt);
  }
}

export function createDryRunResult(options) {
  const now = new Date().toISOString();
  return {
    ok: true,
    startedAt: now,
    finishedAt: now,
    elapsedMs: 1,
    dryRun: true,
    candidate: {
      version: options.candidateVersion,
      ref: options.candidateRef,
      pr: options.pr ?? null,
      marketplaceRepo: options.marketplaceRepo,
    },
    baseline: {
      path: options.baselinePath ?? null,
      exists: options.baselinePath ? existsSync(resolve(options.baselinePath)) : false,
      note: 'Baseline is accepted for schema compatibility; regression comparison is handled by #108.',
    },
    install: {
      ok: true,
      skipped: false,
      isolatedContext: 'dry-run fixture',
      commands: [
        {
          command: `codex plugin marketplace add ${options.marketplaceRepo} --ref ${options.candidateRef} --sparse .agents/plugins --sparse plugins/breakdown`,
          ok: true,
          exitCode: 0,
          elapsedMs: 0,
          output: 'dry-run fixture',
        },
        {
          command: 'codex plugin add breakdown@breakdown',
          ok: true,
          exitCode: 0,
          elapsedMs: 0,
          output: 'dry-run fixture',
        },
      ],
      elapsedMs: 0,
    },
    auth: {
      tokenEnv: TOKEN_ENV_NAME,
      tokenProvided: false,
      friction: ['dry-run did not require a hosted release-test token'],
    },
    hosted: {
      ok: true,
      baseUrl: options.baseUrl,
      toolsList: {
        ok: true,
        count: 3,
        toolNames: ['finalize_external_run', 'list_graphs', 'submit_step_result'],
      },
      graphListing: { ok: true, count: 1 },
      importedGraph: {
        ok: true,
        graphId: 'dry-run-graph',
        graphUrl: `${options.baseUrl}/graph/dry-run-graph`,
      },
      externalRun: {
        ok: true,
        runId: 'dry-run-external-run',
        firstStepId: 'dry-run-step',
        firstStepResult: { status: 'submitted' },
        finalized: { status: 'completed', metrics: { submitted: 1, blocked: 0 } },
      },
      cleanup: { ok: true, graphId: 'dry-run-graph', action: 'marked fixture only' },
      elapsedMs: 0,
    },
    newFeedback: ['Dry-run report generation succeeded; run without --dry-run for hosted validation.'],
    regressions: [],
    recommendation: {
      value: 'promote-with-known-issues',
      reason:
        'Dry-run only proves runner/report generation. A live release-test plus #108 baseline comparison is required before promotion.',
    },
  };
}

function computeRecommendation({ installOk, hostedOk, dryRun }) {
  if (!installOk || !hostedOk) {
    return {
      value: 'block',
      reason: 'Install or hosted smoke validation failed.',
    };
  }

  return {
    value: 'promote-with-known-issues',
    reason: dryRun
      ? 'Dry-run only proves runner/report generation. A live release-test plus #108 baseline comparison is required before promotion.'
      : 'Manual smoke passed. Treat as known-issues until #108 compares against the promoted baseline.',
  };
}

export function buildMarkdownReport(summary) {
  const recommendation = summary.recommendation?.value ?? 'block';
  if (!RECOMMENDATIONS.has(recommendation)) {
    throw new Error(`Invalid recommendation: ${recommendation}`);
  }

  const installSteps = summary.install?.commands ?? [];
  const toolNames = summary.hosted?.toolsList?.toolNames ?? [];
  const feedback = summary.newFeedback?.length ? summary.newFeedback : ['No new feedback recorded.'];
  const regressions = summary.regressions?.length
    ? summary.regressions
    : ['Regression comparison not run by #105 manual runner.'];

  return [
    '# Plugin Smoke Test',
    '',
    `- Candidate version: ${summary.candidate.version}`,
    `- Tested ref: ${summary.candidate.ref}`,
    `- Pull request: ${summary.candidate.pr ?? 'not provided'}`,
    `- Marketplace repo: ${summary.candidate.marketplaceRepo}`,
    `- Base URL: ${summary.hosted.baseUrl}`,
    `- Started: ${summary.startedAt}`,
    `- Finished: ${summary.finishedAt}`,
    `- Duration: ${summary.elapsedMs}ms`,
    `- Dry run: ${summary.dryRun ? 'yes' : 'no'}`,
    `- Recommendation: ${recommendation}`,
    '',
    '## Install And Setup',
    '',
    `- Isolated context: ${summary.install?.isolatedContext ?? 'not created'}`,
    `- Install result: ${summary.install?.ok ? 'passed' : 'failed'}`,
    ...installSteps.map(
      (step) =>
        `- ${step.ok ? 'passed' : 'failed'} (${step.exitCode ?? 'no-exit'}): \`${step.command}\``,
    ),
    '',
    '## Token And Auth Friction',
    '',
    `- Token env: ${summary.auth.tokenEnv}`,
    `- Token provided: ${summary.auth.tokenProvided ? 'yes' : 'no'}`,
    ...summary.auth.friction.map((item) => `- ${item}`),
    '',
    '## MCP Tools/List',
    '',
    `- Result: ${summary.hosted.toolsList?.ok ? 'passed' : 'failed'}`,
    `- Tool count: ${summary.hosted.toolsList?.count ?? 'unknown'}`,
    `- Tools sampled: ${toolNames.slice(0, 12).join(', ') || 'none'}`,
    '',
    '## Graph Listing',
    '',
    `- Result: ${summary.hosted.graphListing?.ok ? 'passed' : 'failed'}`,
    `- Visible graphs: ${summary.hosted.graphListing?.count ?? 'unknown'}`,
    '',
    '## External Evaluator Run',
    '',
    `- Imported graph: ${summary.hosted.importedGraph?.ok ? 'passed' : 'failed'}`,
    `- Graph ID: ${summary.hosted.importedGraph?.graphId ?? 'unknown'}`,
    `- Run result: ${summary.hosted.externalRun?.ok ? 'passed' : 'failed'}`,
    `- Run ID: ${summary.hosted.externalRun?.runId ?? 'unknown'}`,
    `- Cleanup: ${summary.hosted.cleanup?.ok ? 'passed' : 'failed or not attempted'}`,
    '',
    '## New Feedback',
    '',
    ...feedback.map((item) => `- ${item}`),
    '',
    '## Regressions Versus Baseline',
    '',
    `- Baseline path: ${summary.baseline.path ?? 'not provided'}`,
    `- Baseline exists: ${summary.baseline.exists ? 'yes' : 'no'}`,
    ...regressions.map((item) => `- ${item}`),
    '',
    '## Recommendation',
    '',
    `- ${recommendation}: ${summary.recommendation.reason}`,
    '',
  ].join('\n');
}

async function writeReports({ summary, outputPath, jsonOutputPath }) {
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await mkdir(dirname(resolve(jsonOutputPath)), { recursive: true });
  await writeFile(resolve(outputPath), buildMarkdownReport(summary));
  await writeFile(resolve(jsonOutputPath), `${JSON.stringify(summary, null, 2)}\n`);
}

export async function runPluginReleaseSmoke(options) {
  const startedAt = new Date();

  if (options.dryRun) {
    const summary = createDryRunResult(options);
    await writeReports({
      summary,
      outputPath: options.outputPath,
      jsonOutputPath: options.jsonOutputPath,
    });
    return summary;
  }

  if (!options.token) {
    throw new Error(`${TOKEN_ENV_NAME} is required unless --dry-run is used.`);
  }

  const secrets = [options.token];
  let install = {
    ok: true,
    skipped: true,
    isolatedContext: null,
    commands: [],
    elapsedMs: 0,
  };

  if (!options.skipInstall) {
    install = await installCandidate({ ...options, secrets });
  }

  const hosted = await runHostedSmoke(options).catch((err) => ({
    ok: false,
    baseUrl: options.baseUrl,
    toolsList: null,
    graphListing: null,
    importedGraph: null,
    externalRun: null,
    cleanup: null,
    elapsedMs: 0,
    error: summarizeError(err, secrets),
  }));

  const finishedAt = new Date();
  const authFriction = [];
  if (!options.token) {
    authFriction.push(`${TOKEN_ENV_NAME} was missing.`);
  } else {
    authFriction.push(`${TOKEN_ENV_NAME} was present and was not written to reports.`);
  }
  if (options.skipInstall) {
    authFriction.push('Plugin installation was skipped by --skip-install.');
  }
  if (!install.ok) {
    authFriction.push('Candidate plugin installation failed in the isolated Codex context.');
  }
  if (hosted.error) {
    authFriction.push(`Hosted smoke failed: ${hosted.error}`);
  }

  const recommendation = computeRecommendation({
    installOk: install.ok,
    hostedOk: hosted.ok,
    dryRun: false,
  });

  const summary = {
    ok: install.ok && hosted.ok,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    elapsedMs: finishedAt.getTime() - startedAt.getTime(),
    dryRun: false,
    candidate: {
      version: options.candidateVersion,
      ref: options.candidateRef,
      pr: options.pr ?? null,
      marketplaceRepo: options.marketplaceRepo,
    },
    baseline: {
      path: options.baselinePath ?? null,
      exists: options.baselinePath ? existsSync(resolve(options.baselinePath)) : false,
      note: 'Baseline is accepted for schema compatibility; regression comparison is handled by #108.',
    },
    install,
    auth: {
      tokenEnv: TOKEN_ENV_NAME,
      tokenProvided: Boolean(options.token),
      friction: authFriction,
    },
    hosted,
    newFeedback: hosted.ok
      ? ['Manual smoke passed; run #108 baseline comparison before promotion.']
      : ['Manual smoke failed; inspect structured JSON for the failed stage.'],
    regressions: [],
    recommendation,
  };

  await writeReports({
    summary,
    outputPath: options.outputPath,
    jsonOutputPath: options.jsonOutputPath,
  });

  if (install.isolatedContext) {
    await rm(install.isolatedContext, { recursive: true, force: true });
    summary.install.isolatedContext = 'removed after run';
    await writeReports({
      summary,
      outputPath: options.outputPath,
      jsonOutputPath: options.jsonOutputPath,
    });
  }

  return summary;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv, env);
  if (options.help) {
    console.log(usage());
    return;
  }

  const summary = await runPluginReleaseSmoke(options);
  console.log(
    [
      `Wrote ${options.outputPath} and ${options.jsonOutputPath}.`,
      `Recommendation: ${summary.recommendation.value}`,
      `Candidate: ${summary.candidate.version} at ${summary.candidate.ref}`,
    ].join('\n'),
  );

  if (!summary.ok) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

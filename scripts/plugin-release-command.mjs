#!/usr/bin/env node
/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUMP_LEVELS } from './plugin-version-utils.mjs';

const DEFAULT_REPORT_PATH = 'docs/plugin-release-tests/latest-candidate.json';
const DEFAULT_BASELINE_PATH = 'docs/plugin-release-tests/latest.json';
const PROMOTE = 'promote';
const PROMOTE_WITH_KNOWN_ISSUES = 'promote-with-known-issues';

function readFlag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function hasFlag(argv, name) {
  return argv.includes(`--${name}`);
}

function splitCommandLine(line) {
  return line
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function parseKeyValueTokens(tokens) {
  const values = {};
  for (const token of tokens) {
    const [key, ...rest] = token.split('=');
    if (!key || rest.length === 0) continue;
    values[key.toLowerCase()] = rest.join('=');
  }
  return values;
}

function firstCommandLine(commentBody) {
  if (typeof commentBody !== 'string') return null;

  return (
    commentBody
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('/')) ?? null
  );
}

export function parsePluginReleaseCommand(commentBody) {
  const line = firstCommandLine(commentBody);
  if (!line) {
    return { shouldRun: false, command: 'none', reason: 'No slash command found.' };
  }

  const [rawCommand, ...tokens] = splitCommandLine(line);
  const command = rawCommand.slice(1).toLowerCase();
  const keyValues = parseKeyValueTokens(tokens);

  if (command === 'bump') {
    const level = tokens.find((token) => BUMP_LEVELS.includes(token));
    if (!level) {
      return {
        shouldRun: false,
        command,
        reason: `Missing bump level. Use /bump ${BUMP_LEVELS.join('|')}.`,
      };
    }

    return {
      shouldRun: true,
      command,
      level,
      reason: `Bump plugin candidate version as ${level}.`,
    };
  }

  if (command === 'release-test') {
    return {
      shouldRun: true,
      command,
      ref: keyValues.ref ?? null,
      reason: 'Run the plugin release-test workflow for the PR candidate.',
    };
  }

  if (command === 'promote') {
    const acceptedKnownIssues =
      tokens.includes('accept-known-issues') || tokens.includes('--accept-known-issues');

    return {
      shouldRun: true,
      command,
      acceptedKnownIssues,
      reportPath: keyValues.report ?? DEFAULT_REPORT_PATH,
      baselinePath: keyValues.baseline ?? DEFAULT_BASELINE_PATH,
      reason: acceptedKnownIssues
        ? 'Promote candidate while accepting known issues.'
        : 'Promote candidate if the release-test recommendation allows it.',
    };
  }

  if (command === 'file-regressions') {
    return {
      shouldRun: true,
      command,
      reportPath: keyValues.report ?? DEFAULT_REPORT_PATH,
      reason: 'File follow-up issues for release-test regressions.',
    };
  }

  return {
    shouldRun: false,
    command,
    reason: `Unsupported plugin release command: /${command}.`,
  };
}

function readFlexibleString(report, paths) {
  for (const path of paths) {
    let value = report;
    for (const part of path) {
      value = value?.[part];
    }
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function readFlexibleArray(report, paths) {
  for (const path of paths) {
    let value = report;
    for (const part of path) {
      value = value?.[part];
    }
    if (Array.isArray(value)) return value;
  }
  return [];
}

export function normalizeReleaseReport(report) {
  const recommendation = readFlexibleString(report, [
    ['recommendation'],
    ['summary', 'recommendation'],
    ['comparison', 'recommendation'],
  ]);
  const candidateVersion = readFlexibleString(report, [
    ['candidateVersion'],
    ['candidate', 'version'],
    ['plugin', 'candidateVersion'],
  ]);
  const testedRef = readFlexibleString(report, [
    ['testedRef'],
    ['candidateRef'],
    ['candidate', 'ref'],
    ['git', 'testedRef'],
  ]);
  const testedSha = readFlexibleString(report, [
    ['testedSha'],
    ['candidateSha'],
    ['candidate', 'sha'],
    ['git', 'testedSha'],
  ]);
  const baselineVersion = readFlexibleString(report, [
    ['baselineVersion'],
    ['baseline', 'version'],
    ['comparison', 'baselineVersion'],
  ]);
  const baselineRef = readFlexibleString(report, [
    ['baselineRef'],
    ['baseline', 'ref'],
    ['comparison', 'baselineRef'],
  ]);

  return {
    recommendation,
    candidateVersion,
    testedRef,
    testedSha,
    baselineVersion,
    baselineRef,
    regressions: readFlexibleArray(report, [['regressions'], ['comparison', 'regressions']]),
    newFeedback: readFlexibleArray(report, [['newFeedback'], ['feedback', 'new']]),
  };
}

export function evaluatePromotion({ report, acceptedKnownIssues = false }) {
  const normalized = normalizeReleaseReport(report);

  if (!normalized.recommendation) {
    return {
      ok: false,
      normalized,
      message: 'Release-test report is missing a recommendation.',
    };
  }

  if (!normalized.candidateVersion || !normalized.testedRef) {
    return {
      ok: false,
      normalized,
      message: 'Release-test report must include candidate version and tested ref.',
    };
  }

  if (normalized.recommendation === PROMOTE) {
    return {
      ok: true,
      normalized,
      message: `Candidate ${normalized.candidateVersion} is cleared for promotion.`,
    };
  }

  if (normalized.recommendation === PROMOTE_WITH_KNOWN_ISSUES && acceptedKnownIssues) {
    return {
      ok: true,
      normalized,
      message: `Candidate ${normalized.candidateVersion} is cleared with known issues accepted.`,
    };
  }

  if (normalized.recommendation === PROMOTE_WITH_KNOWN_ISSUES) {
    return {
      ok: false,
      normalized,
      message:
        'Release-test report recommends promote-with-known-issues. Re-run /promote accept-known-issues to accept intentionally.',
    };
  }

  return {
    ok: false,
    normalized,
    message: `Release-test recommendation blocks promotion: ${normalized.recommendation}.`,
  };
}

export function buildPromotedBaseline({
  report,
  reportPath = DEFAULT_REPORT_PATH,
  actor = null,
  pr = null,
  sha = null,
  promotedAt = new Date().toISOString(),
  acceptedKnownIssues = false,
}) {
  const promotion = evaluatePromotion({ report, acceptedKnownIssues });
  if (!promotion.ok) {
    throw new Error(promotion.message);
  }

  return {
    schemaVersion: 1,
    promotedAt,
    promotedBy: actor,
    pullRequest: pr,
    sourceSha: sha,
    reportPath,
    candidate: {
      version: promotion.normalized.candidateVersion,
      ref: promotion.normalized.testedRef,
      sha: promotion.normalized.testedSha,
    },
    previousBaseline: {
      version: promotion.normalized.baselineVersion,
      ref: promotion.normalized.baselineRef,
    },
    recommendation: promotion.normalized.recommendation,
    acceptedKnownIssues,
    regressions: promotion.normalized.regressions,
    newFeedback: promotion.normalized.newFeedback,
  };
}

function regressionTitle(regression, index) {
  if (typeof regression === 'string') return regression;
  if (typeof regression?.title === 'string') return regression.title;
  if (typeof regression?.area === 'string') return `Release-test regression: ${regression.area}`;
  return `Release-test regression ${index + 1}`;
}

function regressionBody(regression, report) {
  const normalized = normalizeReleaseReport(report);
  const details =
    typeof regression === 'string'
      ? regression
      : regression?.details ?? regression?.message ?? JSON.stringify(regression, null, 2);

  return [
    'Follow-up from plugin release-test regression comparison.',
    '',
    `Candidate version: ${normalized.candidateVersion ?? 'unknown'}`,
    `Tested ref: ${normalized.testedRef ?? 'unknown'}`,
    `Baseline version: ${normalized.baselineVersion ?? 'unknown'}`,
    '',
    'Regression:',
    '',
    details,
  ].join('\n');
}

export function buildRegressionIssues(report) {
  const normalized = normalizeReleaseReport(report);

  return normalized.regressions.map((regression, index) => ({
    title: regressionTitle(regression, index),
    body: regressionBody(regression, report),
    labels: ['regression', 'plugin-release-loop'],
  }));
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function writeJson(path, value) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeGithubOutputs(result) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const lines = [
    `should_run=${result.shouldRun ? 'true' : 'false'}`,
    `command=${result.command ?? 'none'}`,
    `level=${result.level ?? ''}`,
    `ref=${result.ref ?? ''}`,
    `report_path=${result.reportPath ?? ''}`,
    `baseline_path=${result.baselinePath ?? ''}`,
    `accepted_known_issues=${result.acceptedKnownIssues ? 'true' : 'false'}`,
    `reason=${result.reason ?? ''}`,
  ];

  return writeFile(outputPath, `${lines.join('\n')}\n`, { flag: 'a' });
}

async function parseCommand(argv) {
  const commentBody = readFlag(argv, 'comment') ?? process.env.COMMENT_BODY ?? '';
  const result = parsePluginReleaseCommand(commentBody);
  await writeGithubOutputs(result);
  console.log(JSON.stringify(result, null, 2));
}

async function promoteCommand(argv) {
  const reportPath = readFlag(argv, 'report') ?? DEFAULT_REPORT_PATH;
  const baselinePath = readFlag(argv, 'baseline') ?? DEFAULT_BASELINE_PATH;
  const acceptedKnownIssues = hasFlag(argv, 'accept-known-issues');
  const report = await readJson(reportPath);
  const baseline = buildPromotedBaseline({
    report,
    reportPath,
    actor: readFlag(argv, 'actor') ?? process.env.GITHUB_ACTOR ?? null,
    pr: readFlag(argv, 'pr') ?? process.env.PR_NUMBER ?? null,
    sha: readFlag(argv, 'sha') ?? process.env.GITHUB_SHA ?? null,
    acceptedKnownIssues,
  });

  await writeJson(baselinePath, baseline);
  console.log(JSON.stringify(baseline, null, 2));
}

async function regressionsCommand(argv) {
  const reportPath = readFlag(argv, 'report') ?? DEFAULT_REPORT_PATH;
  const outPath = readFlag(argv, 'out');
  const report = await readJson(reportPath);
  const issues = buildRegressionIssues(report);

  if (outPath) {
    await writeJson(outPath, issues);
  }

  console.log(JSON.stringify(issues, null, 2));
}

function usage() {
  return [
    'Usage:',
    '  node scripts/plugin-release-command.mjs parse --comment "/bump patch"',
    '  node scripts/plugin-release-command.mjs promote --report docs/plugin-release-tests/latest-candidate.json --baseline docs/plugin-release-tests/latest.json',
    '  node scripts/plugin-release-command.mjs regressions --report docs/plugin-release-tests/latest-candidate.json --out /tmp/regressions.json',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;

  if (command === 'parse') return parseCommand(rest);
  if (command === 'promote') return promoteCommand(rest);
  if (command === 'regressions') return regressionsCommand(rest);

  throw new Error(usage());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

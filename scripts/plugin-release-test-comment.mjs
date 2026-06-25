#!/usr/bin/env node
/* eslint-disable no-console */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

function readFlag(argv, name, fallback = null) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return argv[index + 1] ?? fallback;
}

function readJsonFile(filePath) {
  if (!filePath || !existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readTextFile(filePath) {
  if (!filePath || !existsSync(filePath)) return '';
  return readFileSync(filePath, 'utf8');
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function getPath(value, path) {
  return path.split('.').reduce((current, segment) => current?.[segment], value);
}

function textValue(value, fallback = 'Not reported') {
  if (Array.isArray(value)) {
    return value.length === 0 ? 'None reported' : value.map(String).join('; ');
  }

  if (typeof value === 'boolean') {
    return value ? 'passed' : 'failed';
  }

  if (typeof value === 'object' && value !== null) {
    if ('value' in value) return textValue(value.value, fallback);
    if ('summary' in value) return textValue(value.summary, fallback);
    if ('status' in value) return textValue(value.status, fallback);
    return JSON.stringify(value);
  }

  return value == null || value === '' ? fallback : String(value);
}

function listValue(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return '- None reported';
  }

  return value
    .map((item) => {
      if (typeof item === 'string') return `- ${item}`;
      if (item?.message) return `- ${item.message}`;
      if (item?.summary) return `- ${item.summary}`;
      if (item?.name && item?.status) return `- ${item.name}: ${item.status}`;
      return `- ${JSON.stringify(item)}`;
    })
    .join('\n');
}

function redacted(text) {
  const secrets = [
    process.env.BREAKDOWN_RELEASE_TEST_TOKEN,
    process.env.BREAKDOWN_API_TOKEN,
  ].filter(Boolean);

  return secrets.reduce((current, secret) => current.replaceAll(secret, '[redacted]'), text);
}

export function buildReleaseTestComment({
  summary,
  markdown,
  smokeStatus,
  prNumber,
  testedRef,
  candidateVersion,
  workflowUrl,
}) {
  const recommendation = firstDefined(
    getPath(summary, 'recommendation.value'),
    getPath(summary, 'recommendation'),
    getPath(summary, 'comparison.recommendation'),
    smokeStatus === 'success' ? 'promote-with-known-issues' : 'block',
  );
  const version = firstDefined(
    candidateVersion,
    getPath(summary, 'candidateVersion'),
    getPath(summary, 'candidate.version'),
    getPath(summary, 'plugin.version'),
  );
  const ref = firstDefined(
    testedRef,
    getPath(summary, 'testedRef'),
    getPath(summary, 'candidate.ref'),
    getPath(summary, 'ref'),
  );
  const authFriction = firstDefined(
    getPath(summary, 'authFriction'),
    getPath(summary, 'auth.friction'),
    getPath(summary, 'token.authFriction'),
  );
  const graphResult = firstDefined(
    getPath(summary, 'graphResult'),
    getPath(summary, 'graphs.result'),
    getPath(summary, 'graph.status'),
    getPath(summary, 'hosted.graphListing.ok'),
    getPath(summary, 'hosted.importedGraph.ok'),
  );
  const externalRunResult = firstDefined(
    getPath(summary, 'externalRunResult'),
    getPath(summary, 'externalRun.result'),
    getPath(summary, 'externalRun.status'),
    getPath(summary, 'hosted.externalRun.ok'),
  );
  const regressions = firstDefined(
    getPath(summary, 'regressions'),
    getPath(summary, 'comparison.regressions'),
    [],
  );
  const nextActions = firstDefined(
    getPath(summary, 'nextActions'),
    getPath(summary, 'recommendations.nextActions'),
    smokeStatus === 'success'
      ? ['Review the uploaded smoke artifacts before merging.']
      : ['Fix the smoke runner failure, then rerun `/release-test`.'],
  );
  const excerpt = markdown
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n');

  const lines = [
    '## Plugin release test',
    '',
    `- Recommendation: \`${textValue(recommendation)}\``,
    `- Candidate version: \`${textValue(version)}\``,
    `- Tested ref: \`${textValue(ref)}\``,
    `- Smoke status: \`${textValue(smokeStatus)}\``,
    `- Auth friction: ${textValue(authFriction)}`,
    `- Graph result: ${textValue(graphResult)}`,
    `- External-run result: ${textValue(externalRunResult)}`,
    '',
    '### Regressions',
    listValue(regressions),
    '',
    '### Next actions',
    listValue(nextActions),
    '',
    workflowUrl ? `Artifacts: [workflow run](${workflowUrl})` : 'Artifacts uploaded with this workflow run.',
  ];

  if (excerpt) {
    lines.push('', `<details><summary>Report excerpt</summary>\n\n${excerpt}\n\n</details>`);
  }

  lines.push('', `Triggered for PR #${prNumber}.`);

  const body = lines.join('\n');

  return redacted(body);
}

function outputValue(key, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  appendFileSync(outputPath, `${key}=${value}\n`);
}

export function main(argv = process.argv.slice(2)) {
  const jsonPath = readFlag(argv, 'json');
  const markdownPath = readFlag(argv, 'markdown');
  const outputPath = readFlag(argv, 'output', 'release-test-comment.md');
  const summary = readJsonFile(jsonPath);
  const markdown = readTextFile(markdownPath);
  const comment = buildReleaseTestComment({
    summary,
    markdown,
    smokeStatus: readFlag(argv, 'smoke-status', 'unknown'),
    prNumber: readFlag(argv, 'pr-number', 'unknown'),
    testedRef: readFlag(argv, 'tested-ref'),
    candidateVersion: readFlag(argv, 'candidate-version'),
    workflowUrl: readFlag(argv, 'workflow-url'),
  });

  writeFileSync(outputPath, `${comment}\n`);
  outputValue('comment_path', outputPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

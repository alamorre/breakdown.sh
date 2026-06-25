#!/usr/bin/env node
/* eslint-disable no-console */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_BASELINE_PATH,
  comparePluginReleaseSmoke,
  renderComparisonMarkdown,
} from '../src/lib/mcp/plugin-release-compare.mjs';

function readFlag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function readListFlag(argv, name) {
  const values = [];
  const flag = `--${name}`;

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === flag && argv[index + 1]) {
      values.push(argv[index + 1]);
      index += 1;
    }
  }

  return values;
}

async function readJson(path) {
  return JSON.parse(await readFile(resolve(path), 'utf8'));
}

async function writeText(path, text) {
  const absolutePath = resolve(path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, text);
}

export async function main(argv = process.argv.slice(2)) {
  const candidatePath = readFlag(argv, 'candidate');
  if (!candidatePath) {
    throw new Error(
      'Usage: pnpm plugin:release:compare -- --candidate smoke.json [--baseline docs/plugin-release-tests/latest.json] [--json-output comparison.json] [--markdown-output plugin-smoke-test.md] [--accept-known-issue metric]',
    );
  }

  const baselinePath = readFlag(argv, 'baseline') ?? DEFAULT_BASELINE_PATH;
  const jsonOutputPath = readFlag(argv, 'json-output');
  const markdownOutputPath = readFlag(argv, 'markdown-output');
  const acceptedKnownIssues = readListFlag(argv, 'accept-known-issue');
  const candidate = await readJson(candidatePath);
  const baseline = await readJson(baselinePath);
  const comparison = comparePluginReleaseSmoke({ candidate, baseline, acceptedKnownIssues });
  const json = `${JSON.stringify(comparison, null, 2)}\n`;

  if (jsonOutputPath) {
    await writeText(jsonOutputPath, json);
  } else {
    console.log(json);
  }

  if (markdownOutputPath) {
    await writeText(markdownOutputPath, renderComparisonMarkdown(comparison));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

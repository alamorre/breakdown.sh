#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { inspectReleaseCandidate } from './local-release/release-inspection.mjs';

const candidateArgument = requiredArgumentValue(
  process.argv,
  '--candidate',
  'Usage: inspect-local-release.mjs --candidate PATH',
);
const repositoryRoot = resolve(import.meta.dirname, '..');
const releaseVersion = (
  await readFile(join(repositoryRoot, 'local', 'contracts', 'VERSION'), 'utf8')
).trim();
const inspection = await inspectReleaseCandidate({
  candidateDirectory: resolve(candidateArgument),
  releaseVersion,
});
process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);

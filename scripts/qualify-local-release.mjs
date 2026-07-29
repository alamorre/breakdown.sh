#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { qualifyLocalRelease } from './local-release/platform-qualification.mjs';

export async function main(argv = process.argv) {
  const usage =
    'Usage: qualify-local-release.mjs --candidate PATH --evidence PATH --expected-os OS --expected-architecture ARCH';
  const evidence = await qualifyLocalRelease({
    candidateDirectory: requiredArgumentValue(argv, '--candidate', usage),
    evidenceDirectory: requiredArgumentValue(argv, '--evidence', usage),
    expectedOs: requiredArgumentValue(argv, '--expected-os', usage),
    expectedArchitecture: requiredArgumentValue(argv, '--expected-architecture', usage),
    repositoryRoot: resolve(import.meta.dirname, '..'),
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

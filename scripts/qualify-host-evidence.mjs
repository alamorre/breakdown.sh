#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { qualifyHostEvidence } from './local-release/host-evidence.mjs';

export async function main(argv = process.argv) {
  const usage = 'Usage: qualify-host-evidence.mjs --candidate PATH --submission PATH --output PATH';
  const evidence = await qualifyHostEvidence({
    candidateDirectory: resolve(requiredArgumentValue(argv, '--candidate', usage)),
    submissionPath: resolve(requiredArgumentValue(argv, '--submission', usage)),
    outputPath: resolve(requiredArgumentValue(argv, '--output', usage)),
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

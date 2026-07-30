#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { bindHostEvidenceSubmission } from './local-release/host-evidence.mjs';

export async function main(argv = process.argv) {
  const usage = 'Usage: bind-host-evidence.mjs --raw-root PATH --output PATH';
  const result = await bindHostEvidenceSubmission({
    outputDirectory: resolve(requiredArgumentValue(argv, '--output', usage)),
    rawRoot: resolve(requiredArgumentValue(argv, '--raw-root', usage)),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
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

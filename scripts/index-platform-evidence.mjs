#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { filesBelow } from './local-release/filesystem.mjs';
import { indexPlatformEvidence } from './local-release/platform-evidence.mjs';

export async function main(argv = process.argv) {
  const usage =
    'Usage: index-platform-evidence.mjs --candidate PATH --evidence-root PATH --output PATH';
  const evidenceRoot = resolve(requiredArgumentValue(argv, '--evidence-root', usage));
  const evidencePaths = (await filesBelow(evidenceRoot)).filter(
    (path) => path.endsWith('/platform-evidence.json') || path.endsWith('\\platform-evidence.json'),
  );
  const index = await indexPlatformEvidence({
    candidateDirectory: resolve(requiredArgumentValue(argv, '--candidate', usage)),
    evidencePaths,
    outputPath: resolve(requiredArgumentValue(argv, '--output', usage)),
  });
  process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
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

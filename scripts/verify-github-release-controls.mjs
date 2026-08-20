#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { inspectGithubReleaseControls } from './local-release/release-controls.mjs';

export async function main(argv = process.argv) {
  const usage =
    'Usage: verify-github-release-controls.mjs --phase pre-tag|publication --tag breakdown-local-vX.Y.Z --output PATH';
  const phase = requiredArgumentValue(argv, '--phase', usage);
  const tagIndex = argv.indexOf('--tag');
  const tag = tagIndex === -1 ? undefined : argv[tagIndex + 1];
  const snapshot = await inspectGithubReleaseControls({
    outputPath: resolve(requiredArgumentValue(argv, '--output', usage)),
    phase,
    tag,
  });
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
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

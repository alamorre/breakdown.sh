#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { inspectNpmTrustedPublishing } from './local-release/npm-publishing.mjs';

export async function main(argv = process.argv) {
  const usage = 'Usage: inspect-npm-trusted-publishing.mjs --output PATH';
  const evidence = await inspectNpmTrustedPublishing({
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

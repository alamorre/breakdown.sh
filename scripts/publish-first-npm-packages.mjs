#!/usr/bin/env node

import { realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { publishFirstPackages } from './local-release/npm-publishing.mjs';

export async function main(argv = process.argv) {
  const usage = 'Usage: publish-first-npm-packages.mjs --publication PATH --output PATH';
  if (typeof process.env.NODE_AUTH_TOKEN !== 'string' || process.env.NODE_AUTH_TOKEN.length === 0) {
    throw new Error('The one-time npm bootstrap credential is unavailable.');
  }
  const report = await publishFirstPackages({
    publicationDirectory: resolve(requiredArgumentValue(argv, '--publication', usage)),
  });
  await writeFile(
    resolve(requiredArgumentValue(argv, '--output', usage)),
    `${JSON.stringify(report, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
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

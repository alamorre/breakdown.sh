#!/usr/bin/env node

import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { verifyPublishedLocalRelease } from './local-release/publication.mjs';

export async function main(argv = process.argv) {
  const usage =
    'Usage: verify-local-publication.mjs --publication PATH --repository OWNER/NAME --work PATH --output PATH';
  const workDirectory = resolve(requiredArgumentValue(argv, '--work', usage));
  await mkdir(workDirectory, { recursive: true });
  const report = await verifyPublishedLocalRelease({
    publicationDirectory: resolve(requiredArgumentValue(argv, '--publication', usage)),
    repository: requiredArgumentValue(argv, '--repository', usage),
    workDirectory,
  });
  const outputPath = resolve(requiredArgumentValue(argv, '--output', usage));
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
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

#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { rehearseHostQualification } from './local-release/host-evidence.mjs';

export async function main(argv = process.argv) {
  const usage = 'Usage: rehearse-host-qualification.mjs --kit PATH --submission PATH';
  const result = await rehearseHostQualification({
    kitDirectory: resolve(requiredArgumentValue(argv, '--kit', usage)),
    submissionPath: resolve(requiredArgumentValue(argv, '--submission', usage)),
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

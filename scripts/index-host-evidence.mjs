#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { filesBelow } from './local-release/filesystem.mjs';
import {
  indexDeferredHostSupport,
  indexHostEvidence,
  writeHostSupportMaterial,
} from './local-release/host-evidence.mjs';

export async function main(argv = process.argv) {
  const usage =
    'Usage: index-host-evidence.mjs --candidate PATH --output PATH --support-output PATH (--policy deferred --tag TAG | --evidence-root PATH)';
  const outputPath = resolve(requiredArgumentValue(argv, '--output', usage));
  const candidateDirectory = resolve(requiredArgumentValue(argv, '--candidate', usage));
  const index =
    argv[argv.indexOf('--policy') + 1] === 'deferred'
      ? await indexDeferredHostSupport({
          candidateDirectory,
          outputPath,
          releaseTag: requiredArgumentValue(argv, '--tag', usage),
        })
      : await indexHostEvidence({
          candidateDirectory,
          evidencePaths: (
            await filesBelow(resolve(requiredArgumentValue(argv, '--evidence-root', usage)))
          ).filter(
            (path) =>
              path.endsWith('/guided-host-evidence.json') ||
              path.endsWith('\\guided-host-evidence.json'),
          ),
          outputPath,
        });
  const support = await writeHostSupportMaterial({
    indexPath: outputPath,
    outputDirectory: resolve(requiredArgumentValue(argv, '--support-output', usage)),
  });
  process.stdout.write(`${JSON.stringify({ index, support }, null, 2)}\n`);
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

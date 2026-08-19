#!/usr/bin/env node

import { mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { prepareLocalPublication } from './local-release/publication.mjs';

export async function main(argv = process.argv) {
  const usage =
    'Usage: prepare-local-publication.mjs --candidate PATH --platform-index PATH --host-support-index PATH --host-support PATH --approval PATH --approval-signature PATH --approval-verification PATH --github-controls PATH --tag-evidence PATH --workflow-identity PATH --output PATH';
  const outputDirectory = resolve(requiredArgumentValue(argv, '--output', usage));
  await mkdir(outputDirectory, { recursive: true });
  const inspection = await prepareLocalPublication({
    approvalPath: resolve(requiredArgumentValue(argv, '--approval', usage)),
    approvalSignaturePath: resolve(requiredArgumentValue(argv, '--approval-signature', usage)),
    approvalVerificationPath: resolve(
      requiredArgumentValue(argv, '--approval-verification', usage),
    ),
    candidateDirectory: resolve(requiredArgumentValue(argv, '--candidate', usage)),
    githubControlsPath: resolve(requiredArgumentValue(argv, '--github-controls', usage)),
    hostIndexPath: resolve(requiredArgumentValue(argv, '--host-support-index', usage)),
    outputDirectory,
    platformIndexPath: resolve(requiredArgumentValue(argv, '--platform-index', usage)),
    supportDirectory: resolve(requiredArgumentValue(argv, '--host-support', usage)),
    tagEvidencePath: resolve(requiredArgumentValue(argv, '--tag-evidence', usage)),
    workflowIdentityPath: resolve(requiredArgumentValue(argv, '--workflow-identity', usage)),
  });
  process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
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

#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { reviewAgentHostQualification } from './local-release/agent-host-qualification.mjs';

export async function main(argv = process.argv) {
  const usage =
    'Usage: review-agent-host-qualification.mjs --candidate PATH --execution PATH --output PATH --row ID --model ID --provider ID --copilot-version VERSION --source-commit SHA';
  const result = await reviewAgentHostQualification({
    candidateDirectory: resolve(requiredArgumentValue(argv, '--candidate', usage)),
    executionDirectory: resolve(requiredArgumentValue(argv, '--execution', usage)),
    outputDirectory: resolve(requiredArgumentValue(argv, '--output', usage)),
    row: requiredArgumentValue(argv, '--row', usage),
    model: requiredArgumentValue(argv, '--model', usage),
    provider: requiredArgumentValue(argv, '--provider', usage),
    copilotVersion: requiredArgumentValue(argv, '--copilot-version', usage),
    sourceCommit: requiredArgumentValue(argv, '--source-commit', usage),
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

#!/usr/bin/env node

import { realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { executeAgentHostQualification } from './local-release/agent-host-qualification.mjs';
import { requiredArgumentValue } from './local-release/command-line.mjs';

export async function main(argv = process.argv) {
  const usage =
    'Usage: execute-agent-host-qualification.mjs --candidate PATH --output PATH --row ID --expected-os OS --model ID --provider ID --copilot-version VERSION';
  const result = await executeAgentHostQualification({
    candidateDirectory: resolve(requiredArgumentValue(argv, '--candidate', usage)),
    outputDirectory: resolve(requiredArgumentValue(argv, '--output', usage)),
    row: requiredArgumentValue(argv, '--row', usage),
    expectedOperatingSystem: requiredArgumentValue(argv, '--expected-os', usage),
    model: requiredArgumentValue(argv, '--model', usage),
    provider: requiredArgumentValue(argv, '--provider', usage),
    copilotVersion: requiredArgumentValue(argv, '--copilot-version', usage),
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

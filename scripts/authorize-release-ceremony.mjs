#!/usr/bin/env node

import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { createGithubReleaseAuthorization } from './local-release/release-ceremony.mjs';

export async function main(argv = process.argv) {
  const usage =
    'Usage: authorize-release-ceremony.mjs --plan PATH --approvals PATH --run-attempt 1 --output PATH';
  const planPath = resolve(requiredArgumentValue(argv, '--plan', usage));
  const planBytes = await readFile(planPath);
  const plan = JSON.parse(planBytes.toString('utf8'));
  const approvalHistory = JSON.parse(
    await readFile(resolve(requiredArgumentValue(argv, '--approvals', usage)), 'utf8'),
  );
  const authorization = createGithubReleaseAuthorization({
    approvalHistory,
    plan,
    planBytes,
    runAttempt: Number(requiredArgumentValue(argv, '--run-attempt', usage)),
  });
  await writeFile(
    resolve(requiredArgumentValue(argv, '--output', usage)),
    `${JSON.stringify(authorization, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  process.stdout.write(`${JSON.stringify(authorization, null, 2)}\n`);
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

#!/usr/bin/env node

import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { sha256 } from './local-release/filesystem.mjs';
import { releaseTagMessage } from './local-release/release-ceremony.mjs';

export async function main(argv = process.argv) {
  const usage =
    'Usage: render-release-tag-message.mjs --plan PATH --authorization PATH --output PATH';
  const plan = JSON.parse(
    await readFile(resolve(requiredArgumentValue(argv, '--plan', usage)), 'utf8'),
  );
  const authorizationBytes = await readFile(
    resolve(requiredArgumentValue(argv, '--authorization', usage)),
  );
  const message = releaseTagMessage({
    authorizationSha256: sha256(authorizationBytes),
    plan,
  });
  await writeFile(resolve(requiredArgumentValue(argv, '--output', usage)), message, {
    flag: 'wx',
    mode: 0o600,
  });
  process.stdout.write(`${message}\n`);
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

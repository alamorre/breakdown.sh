#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';

export async function main(argv = process.argv.slice(2)) {
  const usage =
    'Usage: run-minimal-release-rehearsal.mjs --scenario pass|intentional-failure --workflow-sha SHA --controller-run-id ID --output PATH';
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const minimalPath = await mkdtemp(join(tmpdir(), 'breakdown-release-rehearsal-path-'));
  const nodeLink = join(minimalPath, basename(process.execPath));
  await symlink(process.execPath, nodeLink);
  try {
    const child = spawnSync(
      nodeLink,
      [
        join(repositoryRoot, 'scripts/run-release-operation.mjs'),
        '--rehearse',
        '--fixture',
        join(repositoryRoot, 'scripts/local-release/fixtures/rehearsal-v1.json'),
        '--scenario',
        requiredArgumentValue(argv, '--scenario', usage),
        '--workflow-sha',
        requiredArgumentValue(argv, '--workflow-sha', usage),
        '--controller-run-id',
        requiredArgumentValue(argv, '--controller-run-id', usage),
        '--output',
        resolve(requiredArgumentValue(argv, '--output', usage)),
      ],
      {
        cwd: repositoryRoot,
        env: {
          LANG: 'C',
          LC_ALL: 'C',
          PATH: minimalPath,
        },
        stdio: 'inherit',
      },
    );
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  } finally {
    await rm(minimalPath, { recursive: true, force: true });
  }
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

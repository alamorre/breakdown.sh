import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = join(import.meta.dirname, '../..');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('GitHub Release absence verifier', () => {
  it('accepts the GitHub API HTTP 404 path without undeclared runner tools', async () => {
    const root = await mkdtemp(join(tmpdir(), 'breakdown-github-release-state-'));
    temporaryDirectories.push(root);
    const errorLog = join(root, 'github-release-error.log');
    await writeFile(errorLog, 'gh: Not Found (HTTP 404)\n');

    await expect(
      execFileAsync(
        process.execPath,
        [
          join(repositoryRoot, 'scripts', 'verify-v1-release-recovery.mjs'),
          '--verify-github-release-absence',
          '--error-log',
          errorLog,
        ],
        { env: { NODE_ENV: 'test', PATH: '' } },
      ),
    ).resolves.toMatchObject({ stdout: '', stderr: '' });
  });

  it.each([
    'gh: Internal Server Error (HTTP 500)\n',
    'gh: Invalid synthetic status (HTTP 4040)\n',
    'gh: Internal Server Error (HTTP 500); response was not an HTTP 404\n',
  ])('fails closed for a non-404 GitHub API error: %s', async (apiError) => {
    const root = await mkdtemp(join(tmpdir(), 'breakdown-github-release-state-'));
    temporaryDirectories.push(root);
    const errorLog = join(root, 'github-release-error.log');
    await writeFile(errorLog, apiError);

    await expect(
      execFileAsync(
        process.execPath,
        [
          join(repositoryRoot, 'scripts', 'verify-v1-release-recovery.mjs'),
          '--verify-github-release-absence',
          '--error-log',
          errorLog,
        ],
        { env: { NODE_ENV: 'test', PATH: '' } },
      ),
    ).rejects.toMatchObject({
      code: 1,
      stdout: '',
      stderr: 'Could not determine GitHub Release state.\n',
    });
  });
});

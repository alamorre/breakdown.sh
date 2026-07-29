import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

import { buildLocalRelease } from './build-local-release.mjs';

const execFileAsync = promisify(execFile);
const repositoryRoot = join(import.meta.dirname, '..');
const releaseVersion = '1.0.0-beta.1';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function cleanTestWorktree(): Promise<{ parent: string; repository: string }> {
  const parent = await mkdtemp(join(tmpdir(), 'breakdown-release-worktree-'));
  const repository = join(parent, 'repository');
  await execFileAsync('git', ['worktree', 'add', '--detach', repository, 'HEAD'], {
    cwd: repositoryRoot,
  });
  await execFileAsync('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: repository,
  });
  return { parent, repository };
}

describe('build-local-release.mjs', () => {
  it('should build and inspect one exact lockstep artifact set', async () => {
    const outputPath = await mkdtemp(join(tmpdir(), 'breakdown-release-candidate-'));
    const worktree = await cleanTestWorktree();
    try {
      await expect(
        buildLocalRelease({ outputPath, repositoryRoot: worktree.repository }),
      ).resolves.toMatchObject({
        schema_version: 'breakdown.release-inspection.v1',
        release_version: releaseVersion,
        status: 'passed',
      });

      const expectedFiles = [
        'SHA256SUMS',
        `breakdown-contracts-${releaseVersion}.tar.gz`,
        `breakdown-contracts-${releaseVersion}.zip`,
        `breakdown-provenance-inputs-${releaseVersion}.json`,
        `breakdown-release-${releaseVersion}.json`,
        `breakdown-sbom-${releaseVersion}.cdx.json`,
        `breakdown-sh-cli-${releaseVersion}.tgz`,
        `breakdown-sh-core-${releaseVersion}.tgz`,
        `breakdown-sh-mcp-${releaseVersion}.tgz`,
        `breakdown-skills-${releaseVersion}.tar.gz`,
        `breakdown-skills-${releaseVersion}.zip`,
      ];
      expect((await readdir(outputPath)).sort()).toEqual(expectedFiles);

      const checksumLines = (await readFile(join(outputPath, 'SHA256SUMS'), 'utf8'))
        .trimEnd()
        .split('\n');
      expect(checksumLines).toHaveLength(expectedFiles.length - 1);
      for (const line of checksumLines) {
        const match = /^([0-9a-f]{64})  ([a-zA-Z0-9._-]+)$/.exec(line);
        expect(match, line).not.toBeNull();
        const [, expectedHash, fileName] = match!;
        expect(expectedHash).toBe(sha256(await readFile(join(outputPath, fileName))));
      }
    } finally {
      await rm(outputPath, { recursive: true });
      await execFileAsync('git', ['worktree', 'remove', '--force', worktree.repository], {
        cwd: repositoryRoot,
      });
      await rm(worktree.parent, { recursive: true });
    }
  }, 60_000);
});

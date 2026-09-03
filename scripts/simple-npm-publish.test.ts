import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(import.meta.dirname, '..');
const workflowsDirectory = join(repositoryRoot, '.github', 'workflows');

describe('simple npm publication', () => {
  it('publishes core, cli, and mcp directly from a manual main workflow', async () => {
    const source = await readFile(join(workflowsDirectory, 'local-stable-publication.yml'), 'utf8');

    expect(source).toContain('on:\n  workflow_dispatch:\n\npermissions:');
    expect(source).toContain('permissions:\n  contents: read\n  id-token: write');
    expect(source).toContain('  publish:\n');
    expect(source).toContain("    if: github.ref == 'refs/heads/main'");
    expect(source).toContain('    environment: breakdown-local-stable');
    expect(source).toContain('pnpm install --frozen-lockfile');
    expect(source).toContain('pnpm --filter @breakdown-sh/core build');
    expect(source).toMatch(
      /breakdown-sh-core-\*\.tgz[\s\S]+breakdown-sh-cli-\*\.tgz[\s\S]+breakdown-sh-mcp-\*\.tgz/,
    );
    expect(source).not.toMatch(
      /attest|artifact|ceremony|controller|inspection|provenance|release-control/i,
    );
  });

  it('removes the workflows that gated the direct publish job', async () => {
    const retiredWorkflows = [
      'local-npm-trust-inspection.yml',
      'local-release-ceremony.yml',
      'local-release-rehearsal.yml',
      'local-v1-release-recovery.yml',
    ];

    for (const workflow of retiredWorkflows) {
      await expect(access(join(workflowsDirectory, workflow))).rejects.toThrow();
    }

    for (const packageDirectory of ['breakdown-core', 'breakdown-cli', 'breakdown-mcp']) {
      const manifest = JSON.parse(
        await readFile(join(repositoryRoot, 'packages', packageDirectory, 'package.json'), 'utf8'),
      ) as { publishConfig?: Record<string, unknown> };
      expect(manifest.publishConfig).toEqual({ access: 'public', tag: 'latest' });
    }
  });
});

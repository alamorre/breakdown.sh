import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkDocLinks, checkRepositoryDocLinks } from './check-doc-links.mjs';

describe('internal documentation links', () => {
  it('resolves relative files, directories, reference links, and heading fragments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'breakdown-doc-links-'));
    try {
      await mkdir(join(root, 'guide'));
      await writeFile(
        join(root, 'guide', 'usage.md'),
        '# Usage\n\n## Resume & stale results\n\n## Usage\n',
      );
      const index = join(root, 'README.md');
      await writeFile(
        index,
        '# Index\n[guide](guide/)\n[resume](guide/usage.md#resume--stale-results)\n[self](#index)\n[duplicate](guide/usage.md#usage-1)\n[ref]: guide/usage.md\n[external](https://invalid.example/path)\n```md\n[example](missing-example.md)\n```\n',
      );
      expect(await checkDocLinks([index])).toEqual([]);
      await writeFile(
        index,
        '[missing](gone.md)\n[heading](guide/usage.md#absent)\n[ref]: missing-reference.md\n',
      );
      expect(await checkDocLinks([index])).toEqual([
        `${index}: gone.md`,
        `${index}: guide/usage.md#absent`,
        `${index}: missing-reference.md`,
      ]);
    } finally {
      await rm(root, { recursive: true });
    }
  });

  it('keeps maintained repository guidance navigable without network access', async () => {
    await expect(checkRepositoryDocLinks(join(import.meta.dirname, '..'))).resolves.toBeUndefined();
  });
});

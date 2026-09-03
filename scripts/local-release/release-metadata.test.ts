import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { writeReleaseManifest } from './release-metadata.mjs';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('writeReleaseManifest', () => {
  it('should select stable public channels for a stable full SemVer', async () => {
    const outputPath = await mkdtemp(join(tmpdir(), 'breakdown-release-metadata-'));
    temporaryDirectories.push(outputPath);
    const archiveNames = {
      contractsTar: 'breakdown-contracts-1.0.1.tar.gz',
      contractsZip: 'breakdown-contracts-1.0.1.zip',
      skillsTar: 'breakdown-skills-1.0.1.tar.gz',
      skillsZip: 'breakdown-skills-1.0.1.zip',
    };
    const packageResults = [
      {
        artifactName: 'breakdown-sh-core-1.0.1.tgz',
        role: 'core-library',
        name: '@breakdown-sh/core',
        manifest: {
          engines: { node: '^24.0.0' },
          type: 'module',
          exports: { '.': './dist/index.js' },
        },
      },
    ];
    const sbomName = 'breakdown-sbom-1.0.1.cdx.json';
    const provenanceName = 'breakdown-provenance-inputs-1.0.1.json';
    await Promise.all(
      [
        ...Object.values(archiveNames),
        packageResults[0]!.artifactName,
        sbomName,
        provenanceName,
      ].map((file) => writeFile(join(outputPath, file), `${file}\n`)),
    );

    await expect(
      writeReleaseManifest({
        archiveNames,
        outputPath,
        packageResults,
        platformConformance: {},
        provenanceName,
        releaseVersion: '1.0.1',
        sbomName,
      }),
    ).resolves.toMatchObject({
      manifest: {
        release_version: '1.0.1',
        channel: {
          stability: 'stable',
          npm_dist_tag: 'latest',
          github_prerelease: false,
          immutable_tag: 'breakdown-local-v1.0.1',
        },
      },
    });
  });
});

import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MAINTAINED_PLATFORM_TUPLES,
  PLATFORM_QUALIFICATION_POLICY,
  indexPlatformEvidence,
} from './platform-evidence.mjs';

const temporaryDirectories: string[] = [];
const releaseVersion = '1.0.0';
const candidateDigest = 'a'.repeat(64);
const corpusDigest = 'b'.repeat(64);
const gitCommit = 'c'.repeat(40);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function runnerLabel(tuple: (typeof MAINTAINED_PLATFORM_TUPLES)[number]): string {
  const labels: Record<string, string> = {
    'linux-glibc/x64': 'ubuntu-24.04',
    'linux-glibc/arm64': 'ubuntu-24.04-arm',
    'macos/x64': 'macos-15-intel',
    'macos/arm64': 'macos-15',
  };
  return labels[`${tuple.os}/${tuple.architecture}`]!;
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'breakdown-platform-evidence-'));
  temporaryDirectories.push(root);
  const candidateDirectory = join(root, 'candidate');
  await mkdir(candidateDirectory);
  await writeFile(
    join(candidateDirectory, `breakdown-release-${releaseVersion}.json`),
    `${JSON.stringify({
      schema_version: 'breakdown.release-manifest.v1',
      release_version: releaseVersion,
      platform_conformance: {
        maintained_tuples: MAINTAINED_PLATFORM_TUPLES,
        current_build: {
          corpus_revision: {
            file: 'local/contracts/MANIFEST.json',
            sha256: corpusDigest,
          },
          candidate_digest: {
            algorithm: 'SHA-256',
            content: candidateDigest,
          },
        },
      },
    })}\n`,
  );
  await writeFile(
    join(candidateDirectory, `breakdown-provenance-inputs-${releaseVersion}.json`),
    `${JSON.stringify({
      schema_version: 'breakdown.provenance-inputs.v1',
      release_version: releaseVersion,
      source: {
        repository: 'alamorre/breakdown.sh',
        git_commit: gitCommit,
      },
    })}\n`,
  );
  return { root, candidateDirectory };
}

function evidenceFor(tuple: (typeof MAINTAINED_PLATFORM_TUPLES)[number]) {
  return {
    schema_version: 'breakdown.platform-qualification-evidence.v1',
    release_version: releaseVersion,
    status: 'passed',
    tuple,
    environment: {
      os: {
        platform: tuple.os === 'macos' ? 'darwin' : 'linux',
        release: 'fixture-release',
        version: 'fixture-version',
      },
      architecture: tuple.architecture,
      node: 'v24.7.0',
      filesystem: {
        name: 'fixture-native-local',
        type: 'fixture-native-local',
        block_size: '4096',
      },
      runner: {
        provider: 'github-actions',
        name: `${tuple.os}-${tuple.architecture}`,
        label: runnerLabel(tuple),
        os: tuple.os,
        architecture: tuple.architecture,
        image: 'fixture-image',
        image_version: 'fixture-image-version',
      },
      corpus_revision: {
        file: 'local/contracts/MANIFEST.json',
        sha256: corpusDigest,
      },
      candidate_digest: {
        algorithm: 'SHA-256',
        content: candidateDigest,
      },
    },
    source: {
      repository: 'alamorre/breakdown.sh',
      git_commit: gitCommit,
    },
    compatibility: {
      disk_families: PLATFORM_QUALIFICATION_POLICY.diskFamilies.map(
        (definition: { family: string; suites: readonly string[] }) => ({
          ...definition,
          result: 'validated',
        }),
      ),
      protocol_families: PLATFORM_QUALIFICATION_POLICY.protocolFamilies.map(
        (definition: { family: string; suites: readonly string[] }) => ({
          ...definition,
          result: 'validated',
        }),
      ),
    },
    normative_dimensions: PLATFORM_QUALIFICATION_POLICY.normativeDimensions.map(
      (definition: { id: string; suites: readonly string[] }) => ({
        ...definition,
        result: 'validated',
      }),
    ),
    race_campaigns: PLATFORM_QUALIFICATION_POLICY.raceCampaigns.map(
      (campaign: { id: string; iterations: 100; suite: string; test: string }) => ({
        ...campaign,
        result: 'passed',
      }),
    ),
    suites: PLATFORM_QUALIFICATION_POLICY.suites.map((id) => ({
      id,
      status: 'passed',
      tests: id === 'core' ? 265 : 1,
      failures: 0,
      log: {
        path: `${id}.json`,
        sha256: '',
      },
    })),
    git_modes: {
      present: 'passed',
      absent: 'passed',
      comparison: 'identical',
      suite: 'cli',
      test: PLATFORM_QUALIFICATION_POLICY.gitModeTest,
    },
    immutability: {
      mechanism: 'github-actions-artifact-v7',
      workflow_run_id: '12345',
      workflow_run_attempt: '1',
      artifact_name: `breakdown-platform-evidence-${tuple.os}-${tuple.architecture}`,
    },
  };
}

async function writeEvidenceRow(
  root: string,
  tuple: (typeof MAINTAINED_PLATFORM_TUPLES)[number],
  mutate?: (evidence: ReturnType<typeof evidenceFor>) => void,
) {
  const rowRoot = join(root, `${tuple.os}-${tuple.architecture}`);
  await mkdir(rowRoot);
  const evidence = evidenceFor(tuple);
  mutate?.(evidence);
  for (const suite of evidence.suites) {
    const assertionResults =
      suite.id === 'core'
        ? PLATFORM_QUALIFICATION_POLICY.raceCampaigns.map((campaign) => ({
            title: campaign.test,
            status: 'passed',
          }))
        : suite.id === 'cli'
          ? [
              {
                title: PLATFORM_QUALIFICATION_POLICY.gitModeTest,
                status: 'passed',
              },
            ]
          : [];
    const bytes = Buffer.from(
      `${JSON.stringify({
        success: true,
        numTotalTests: suite.tests,
        numFailedTests: suite.failures,
        testResults: assertionResults.length === 0 ? [] : [{ assertionResults }],
      })}\n`,
    );
    await writeFile(join(rowRoot, suite.log.path), bytes);
    suite.log.sha256 = sha256(bytes);
  }
  const path = join(rowRoot, 'platform-evidence.json');
  await writeFile(path, `${JSON.stringify(evidence)}\n`);
  return { path, rowRoot };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('indexPlatformEvidence', () => {
  it('should index exactly one passing immutable row for every maintained platform tuple', async () => {
    expect(MAINTAINED_PLATFORM_TUPLES).toEqual([
      { os: 'linux-glibc', architecture: 'x64' },
      { os: 'linux-glibc', architecture: 'arm64' },
      { os: 'macos', architecture: 'x64' },
      { os: 'macos', architecture: 'arm64' },
    ]);
    const { root, candidateDirectory } = await fixtureRoot();
    const rows = await Promise.all(
      MAINTAINED_PLATFORM_TUPLES.map((tuple) => writeEvidenceRow(root, tuple)),
    );
    const evidencePaths = rows.map((row) => row.path);
    const outputPath = join(root, 'platform-evidence-index.json');

    await expect(
      indexPlatformEvidence({
        candidateDirectory,
        evidencePaths,
        outputPath,
      }),
    ).resolves.toMatchObject({
      schema_version: 'breakdown.platform-qualification-index.v1',
      release_version: releaseVersion,
      status: 'passed',
      candidate_digest: {
        algorithm: 'SHA-256',
        content: candidateDigest,
      },
      corpus_revision: {
        file: 'local/contracts/MANIFEST.json',
        sha256: corpusDigest,
      },
      source: {
        git_commit: gitCommit,
      },
      rows: MAINTAINED_PLATFORM_TUPLES.map((tuple) => ({
        tuple,
        status: 'passed',
        evidence: {
          artifact_name: `breakdown-platform-evidence-${tuple.os}-${tuple.architecture}`,
        },
      })),
    });

    const writtenBytes = await readFile(outputPath);
    const written = JSON.parse(writtenBytes.toString('utf8')) as {
      rows: Array<{ evidence: { file_sha256: string } }>;
    };
    for (const [index, path] of evidencePaths.entries()) {
      expect(written.rows[index]?.evidence.file_sha256).toBe(sha256(await readFile(path)));
    }
  });

  it('should reject a row that does not declare both 100-iteration race campaigns', async () => {
    const { root, candidateDirectory } = await fixtureRoot();
    const rows = await Promise.all(
      MAINTAINED_PLATFORM_TUPLES.map((tuple, index) =>
        writeEvidenceRow(root, tuple, (evidence) => {
          if (index === 0) {
            (evidence.race_campaigns[0] as { iterations: number }).iterations = 99;
          }
        }),
      ),
    );

    await expect(
      indexPlatformEvidence({
        candidateDirectory,
        evidencePaths: rows.map((row) => row.path),
        outputPath: join(root, 'platform-evidence-index.json'),
      }),
    ).rejects.toThrow('does not contain both required 100-iteration race campaigns');
  });

  it('should reject a row whose retained suite log does not match its digest', async () => {
    const { root, candidateDirectory } = await fixtureRoot();
    const rows = await Promise.all(
      MAINTAINED_PLATFORM_TUPLES.map((tuple) => writeEvidenceRow(root, tuple)),
    );
    await writeFile(join(rows[0]!.rowRoot, 'core.json'), 'tampered\n');

    await expect(
      indexPlatformEvidence({
        candidateDirectory,
        evidencePaths: rows.map((row) => row.path),
        outputPath: join(root, 'platform-evidence-index.json'),
      }),
    ).rejects.toThrow('retained-log digest does not match');
  });

  it.each([
    [
      'OS release',
      (evidence: ReturnType<typeof evidenceFor>) => {
        evidence.environment.os.release = '';
      },
      'has no exact OS identity',
    ],
    [
      'runner label',
      (evidence: ReturnType<typeof evidenceFor>) => {
        evidence.environment.runner.label = 'ubuntu-latest';
      },
      'did not use the required native runner',
    ],
    [
      'runner image version',
      (evidence: ReturnType<typeof evidenceFor>) => {
        evidence.environment.runner.image_version = '';
      },
      'has no exact GitHub Actions runner identity',
    ],
  ])('should reject a row without its exact %s', async (_field, mutate, message) => {
    const { root, candidateDirectory } = await fixtureRoot();
    const rows = await Promise.all(
      MAINTAINED_PLATFORM_TUPLES.map((tuple, index) =>
        writeEvidenceRow(root, tuple, index === 0 ? mutate : undefined),
      ),
    );

    await expect(
      indexPlatformEvidence({
        candidateDirectory,
        evidencePaths: rows.map((row) => row.path),
        outputPath: join(root, 'platform-evidence-index.json'),
      }),
    ).rejects.toThrow(message);
  });
});

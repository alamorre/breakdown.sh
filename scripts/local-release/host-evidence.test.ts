import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GUIDED_HOST_JOURNEY_STAGES,
  GUIDED_HOST_RUBRIC_DIMENSIONS,
  HOST_OUTCOME_PARITY_EXCLUSIONS,
  HOST_REVIEW_ATTESTATION,
  indexHostEvidence,
  qualifyHostEvidence,
  writeHostQualificationTemplate,
  writeHostSupportMaterial,
} from './host-evidence.mjs';
import { MAINTAINED_PLATFORM_TUPLES } from './platform-evidence.mjs';

const temporaryDirectories: string[] = [];
const releaseVersion = '1.0.0';
const candidateDigest = 'a'.repeat(64);
const corpusDigest = 'b'.repeat(64);
const gitCommit = 'c'.repeat(40);
const repositoryRoot = join(import.meta.dirname, '../..');

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function candidateFixture() {
  const root = await mkdtemp(join(tmpdir(), 'breakdown-host-evidence-'));
  temporaryDirectories.push(root);
  const candidateDirectory = join(root, 'candidate');
  await mkdir(candidateDirectory);
  const artifactDefinitions = [
    {
      file: `breakdown-sh-core-${releaseVersion}.tgz`,
      role: 'core-library',
      bytes: Buffer.from('core package'),
    },
    {
      file: `breakdown-sh-cli-${releaseVersion}.tgz`,
      role: 'command-line-interface',
      bytes: Buffer.from('cli package'),
    },
    {
      file: `breakdown-sh-mcp-${releaseVersion}.tgz`,
      role: 'mcp-adapter',
      bytes: Buffer.from('mcp package'),
    },
    {
      file: `breakdown-skills-${releaseVersion}.tar.gz`,
      role: 'skills-archive',
      bytes: Buffer.from('skills archive'),
    },
    {
      file: `breakdown-skills-${releaseVersion}.zip`,
      role: 'skills-archive',
      bytes: Buffer.from('skills zip archive'),
    },
  ];
  for (const artifact of artifactDefinitions) {
    await writeFile(join(candidateDirectory, artifact.file), artifact.bytes);
  }
  const provenanceFile = `breakdown-provenance-inputs-${releaseVersion}.json`;
  await writeJson(join(candidateDirectory, provenanceFile), {
    schema_version: 'breakdown.provenance-inputs.v1',
    release_version: releaseVersion,
    source: {
      repository: 'https://github.com/alamorre/breakdown.sh',
      git_commit: gitCommit,
    },
  });
  artifactDefinitions.push({
    file: provenanceFile,
    role: 'provenance-inputs',
    bytes: await readFile(join(candidateDirectory, provenanceFile)),
  });
  const artifacts = artifactDefinitions.map((artifact) => ({
    file: artifact.file,
    role: artifact.role,
    hashes: { sha256: sha256(artifact.bytes) },
  }));
  await writeJson(join(candidateDirectory, `breakdown-release-${releaseVersion}.json`), {
    schema_version: 'breakdown.release-manifest.v1',
    release_version: releaseVersion,
    artifacts,
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
  });
  return { root, candidateDirectory, artifacts };
}

async function submissionFixture({
  root,
  host = 'Codex CLI',
  hostVersion = '1.2.3',
  modelFamily,
  os = 'linux',
  providerFamily = 'openai',
}: {
  root: string;
  host?: string;
  hostVersion?: string;
  modelFamily?: string;
  os?: 'linux' | 'macos' | 'windows';
  providerFamily?: string;
}) {
  const rowRoot = join(root, `${os}-${providerFamily}`);
  await mkdir(rowRoot);
  const retainedFiles: Array<[string, string, string]> = [];
  for (const stage of GUIDED_HOST_JOURNEY_STAGES) {
    retainedFiles.push(
      [
        `interaction-${stage}.md`,
        'visible-interactions',
        `# ${stage}\n\nThe human reviewer retained the visible host interaction for ${stage}.\n`,
      ],
      [
        `actions-${stage}.json`,
        'visible-actions',
        `${JSON.stringify({
          schema_version: 'breakdown.guided-host-action-evidence.v1',
          stage,
          actions: [
            {
              kind: 'observation',
              description: `Observed the exact host action for ${stage}.`,
            },
          ],
        })}\n`,
      ],
      [
        `artifacts-${stage}.json`,
        'resulting-artifacts',
        `${JSON.stringify({
          schema_version: 'breakdown.guided-host-artifact-evidence.v1',
          stage,
          artifacts: [
            {
              path: `retained/${stage}`,
              state: stage === 'critique' ? 'unchanged' : 'observed',
            },
          ],
        })}\n`,
      ],
    );
  }
  retainedFiles.push(
    ['rubric.md', 'human-rubric', '# Human rubric notes\n'],
    ['hostile.md', 'hostile-content', '# Hostile-content observations\n'],
    ['parity.md', 'outcome-parity', '# Outcome parity observations\n'],
  );
  for (const [path, , contents] of retainedFiles) {
    await writeFile(join(rowRoot, path), contents);
  }
  const submission = {
    schema_version: 'breakdown.guided-host-submission.v1',
    release_version: releaseVersion,
    host: {
      surface: host,
      version: hostVersion,
    },
    operating_system: {
      family: os,
      platform: os === 'linux' ? 'linux' : os === 'macos' ? 'darwin' : 'win32',
      name: os === 'linux' ? 'Ubuntu' : os === 'macos' ? 'macOS' : 'Windows',
      release: os === 'linux' ? '6.11.0-1018-azure' : os === 'macos' ? '24.5.0' : '10.0.26100',
      version:
        os === 'linux'
          ? '#18~24.04.1-Ubuntu SMP'
          : os === 'macos'
            ? 'Darwin Kernel Version 24.5.0'
            : 'Windows 11 Enterprise',
      architecture: 'x64',
    },
    transport: 'cli',
    model: {
      provider_family: providerFamily,
      model_family: modelFamily ?? (providerFamily === 'openai' ? 'gpt-5' : 'claude-4'),
    },
    skill_archive_file: `breakdown-skills-${releaseVersion}.tar.gz`,
    journey: {
      stages: GUIDED_HOST_JOURNEY_STAGES.map((id) => ({
        id,
        status: 'passed',
        interaction_evidence: [`interaction-${id}.md`],
        action_evidence: [`actions-${id}.json`],
        artifact_evidence: [`artifacts-${id}.json`],
      })),
    },
    rubric: {
      scores: GUIDED_HOST_RUBRIC_DIMENSIONS.map((dimension) => ({
        dimension,
        score: 4,
        evidence: ['rubric.md'],
      })),
    },
    human_review: {
      reviewer: 'reviewer@example.com',
      reviewed_at: '2026-07-29T18:00:00.000Z',
      attestation: HOST_REVIEW_ATTESTATION,
      evidence: ['rubric.md'],
    },
    hostile_content: {
      authority_not_expanded: true,
      success_not_fabricated: true,
      approvals_not_bypassed: true,
      unexpected_publication: false,
      evidence: ['hostile.md'],
    },
    outcome_parity: {
      assessed: true,
      disclaimed_dimensions: HOST_OUTCOME_PARITY_EXCLUSIONS,
      evidence: ['parity.md'],
    },
    retained_evidence: retainedFiles.map(([path, role, contents]) => ({
      path,
      role,
      sha256: sha256(Buffer.from(contents)),
    })),
    immutability: {
      mechanism: 'github-actions-artifact-v7',
      workflow_run_id: '12345',
      workflow_run_attempt: '1',
      artifact_name: `breakdown-host-evidence-${os}-${providerFamily}`,
    },
  };
  const submissionPath = join(rowRoot, 'guided-host-submission.json');
  await writeJson(submissionPath, submission);
  return {
    outputPath: join(rowRoot, 'guided-host-evidence.json'),
    rowRoot,
    submission,
    submissionPath,
  };
}

async function qualifySubmission(
  candidate: Awaited<ReturnType<typeof candidateFixture>>,
  row: Awaited<ReturnType<typeof submissionFixture>>,
) {
  return qualifyHostEvidence({
    candidateDirectory: candidate.candidateDirectory,
    environment: {
      GITHUB_ACTIONS: 'true',
      GITHUB_RUN_ID: row.submission.immutability.workflow_run_id,
      GITHUB_RUN_ATTEMPT: row.submission.immutability.workflow_run_attempt,
      BREAKDOWN_HOST_EVIDENCE_ARTIFACT_NAME: row.submission.immutability.artifact_name,
    },
    outputPath: row.outputPath,
    submissionPath: row.submissionPath,
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('authenticated host support workflow', () => {
  it('should index immutable candidate and evidence artifacts on a release tag before attesting', async () => {
    const workflow = await readFile(
      join(repositoryRoot, '.github', 'workflows', 'local-host-support.yml'),
      'utf8',
    );

    expect(workflow).toContain("startsWith(github.ref, 'refs/tags/breakdown-local-v')");
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('attestations: write');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain('actions/download-artifact@v8');
    expect(workflow).toContain('artifact-ids: ${{ inputs.candidate_artifact_id }}');
    expect(workflow).toContain('artifact-ids: ${{ inputs.evidence_artifact_ids }}');
    expect(workflow).toContain('pnpm local:release:index-hosts');
    expect(workflow).toContain('actions/attest@v4');
    expect(workflow).toContain('steps.attest.outputs.bundle-path');
    expect(workflow).toContain('actions/upload-artifact@v7');
  });
});

describe('qualifyHostEvidence', () => {
  it('should bind a complete passing real-host journey to the exact candidate artifacts', async () => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });

    await expect(qualifySubmission(candidate, row)).resolves.toMatchObject({
      schema_version: 'breakdown.guided-host-evidence.v1',
      release_version: releaseVersion,
      status: 'passed',
      host: row.submission.host,
      operating_system: row.submission.operating_system,
      transport: 'cli',
      breakdown_version: releaseVersion,
      candidate: {
        digest: {
          algorithm: 'SHA-256',
          content: candidateDigest,
        },
        skill_archive: {
          file: `breakdown-skills-${releaseVersion}.tar.gz`,
        },
        packages: [
          { file: `breakdown-sh-core-${releaseVersion}.tgz` },
          { file: `breakdown-sh-cli-${releaseVersion}.tgz` },
          { file: `breakdown-sh-mcp-${releaseVersion}.tgz` },
        ],
      },
      rubric: {
        percent: 100,
        passed: true,
      },
      hostile_content: {
        passed: true,
      },
      outcome_parity: {
        passed: true,
      },
    });

    const written = JSON.parse(await readFile(row.outputPath, 'utf8')) as {
      candidate: { skill_archive: { sha256: string }; packages: Array<{ sha256: string }> };
    };
    const expectedSkill = candidate.artifacts.find(
      (artifact) => artifact.file === `breakdown-skills-${releaseVersion}.tar.gz`,
    );
    expect(written.candidate.skill_archive.sha256).toBe(expectedSkill?.hashes.sha256);
    expect(written.candidate.packages.map((artifact) => artifact.sha256)).toEqual(
      candidate.artifacts
        .filter((artifact) =>
          ['core-library', 'command-line-interface', 'mcp-adapter'].includes(artifact.role),
        )
        .map((artifact) => artifact.hashes.sha256),
    );
  });

  it.each([
    [
      'an incomplete journey',
      (submission: Awaited<ReturnType<typeof submissionFixture>>['submission']) => {
        submission.journey.stages.pop();
      },
      'does not cover the exact guided journey',
    ],
    [
      'a zero rubric score',
      (submission: Awaited<ReturnType<typeof submissionFixture>>['submission']) => {
        submission.rubric.scores[0]!.score = 0;
      },
      'has a zero score',
    ],
    [
      'unexpected publication',
      (submission: Awaited<ReturnType<typeof submissionFixture>>['submission']) => {
        submission.hostile_content.unexpected_publication = true;
      },
      'changed authority, truthfulness, approval, or publication behavior',
    ],
    [
      'a missing human-review attestation',
      (submission: Awaited<ReturnType<typeof submissionFixture>>['submission']) => {
        submission.human_review.attestation = '';
      },
      'has no exact human-review identity, time, and attestation',
    ],
    [
      'one generic action record reused for multiple journey stages',
      (submission: Awaited<ReturnType<typeof submissionFixture>>['submission']) => {
        submission.journey.stages[2]!.action_evidence =
          submission.journey.stages[1]!.action_evidence;
      },
      'is reused across the guided journey',
    ],
  ])('should reject %s', async (_label, mutate, message) => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });
    mutate(row.submission);
    await writeJson(row.submissionPath, row.submission);

    await expect(qualifySubmission(candidate, row)).rejects.toThrow(message);
  });

  it('should reject retained interaction or action evidence whose bytes changed', async () => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });
    await writeFile(
      join(row.rowRoot, 'actions-author.json'),
      '{"actions":["publish unexpectedly"]}\n',
    );

    await expect(qualifySubmission(candidate, row)).rejects.toThrow(
      'Retained evidence actions-author.json does not match its digest',
    );
  });

  it('should reject an immutable-storage identity not issued by the current workflow', async () => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });

    await expect(
      qualifyHostEvidence({
        candidateDirectory: candidate.candidateDirectory,
        environment: {
          GITHUB_ACTIONS: 'true',
          GITHUB_RUN_ID: 'different-run',
          GITHUB_RUN_ATTEMPT: '1',
          BREAKDOWN_HOST_EVIDENCE_ARTIFACT_NAME: row.submission.immutability.artifact_name,
        },
        outputPath: row.outputPath,
        submissionPath: row.submissionPath,
      }),
    ).rejects.toThrow('bind evidence to the current GitHub Actions run and artifact');
  });
});

describe('writeHostQualificationTemplate', () => {
  it('should prepare the exact pending journey and rubric without fabricating real-host evidence', async () => {
    const candidate = await candidateFixture();
    const outputDirectory = join(candidate.root, 'host-qualification-kit');

    await expect(
      writeHostQualificationTemplate({
        candidateDirectory: candidate.candidateDirectory,
        outputDirectory,
      }),
    ).resolves.toMatchObject({
      guideFile: 'GUIDED-HOST-QUALIFICATION.md',
      submissionFile: 'guided-host-submission.template.json',
    });

    const submission = JSON.parse(
      await readFile(join(outputDirectory, 'guided-host-submission.template.json'), 'utf8'),
    ) as {
      release_version: string;
      skill_archive_file: string;
      journey: { stages: Array<{ id: string; status: string }> };
      rubric: { scores: Array<{ dimension: string; score: null }> };
      human_review: { reviewer: string; attestation: string };
      outcome_parity: { assessed: boolean; disclaimed_dimensions: string[] };
      retained_evidence: unknown[];
    };
    expect(submission).toMatchObject({
      schema_version: 'breakdown.guided-host-submission.v1',
      release_version: releaseVersion,
      skill_archive_file: `breakdown-skills-${releaseVersion}.tar.gz`,
      journey: {
        stages: GUIDED_HOST_JOURNEY_STAGES.map((id) => ({ id, status: 'pending' })),
      },
      rubric: {
        scores: GUIDED_HOST_RUBRIC_DIMENSIONS.map((dimension) => ({
          dimension,
          score: null,
        })),
      },
      human_review: {
        reviewer: '',
        attestation: HOST_REVIEW_ATTESTATION,
      },
      outcome_parity: {
        assessed: false,
        disclaimed_dimensions: HOST_OUTCOME_PARITY_EXCLUSIONS,
      },
      retained_evidence: [],
    });
    const guide = await readFile(join(outputDirectory, 'GUIDED-HOST-QUALIFICATION.md'), 'utf8');
    expect(guide).toContain(`Breakdown Local ${releaseVersion}`);
    expect(guide).toContain(candidateDigest);
    expect(guide).toContain('real Agent Host');
    expect(guide).toContain('Do not mark a stage passed');
    expect(guide).toContain('human reviewer');
    expect(guide).toContain('local:release:qualify-host');
  });
});

describe('indexHostEvidence', () => {
  it('should support exact passing CLI rows only after Linux, macOS, and two provider families pass', async () => {
    const candidate = await candidateFixture();
    const submissions = [
      await submissionFixture({
        root: candidate.root,
        host: 'Codex CLI',
        hostVersion: '1.2.3',
        os: 'linux',
        providerFamily: 'openai',
      }),
      await submissionFixture({
        root: candidate.root,
        host: 'Claude Code',
        hostVersion: '2.1.0',
        os: 'macos',
        providerFamily: 'anthropic',
      }),
    ];
    for (const submission of submissions) {
      await qualifySubmission(candidate, submission);
    }
    const outputPath = join(candidate.root, 'breakdown-host-evidence-index.json');

    await expect(
      indexHostEvidence({
        candidateDirectory: candidate.candidateDirectory,
        evidencePaths: submissions.map((submission) => submission.outputPath),
        outputPath,
      }),
    ).resolves.toMatchObject({
      schema_version: 'breakdown.guided-host-evidence-index.v1',
      release_version: releaseVersion,
      status: 'passed',
      coverage: {
        guided_cli_operating_systems: ['linux', 'macos'],
        model_families: ['claude-4', 'gpt-5'],
        provider_families: ['anthropic', 'openai'],
      },
      supported_hosts: [
        {
          surface: 'Codex CLI',
          version: '1.2.3',
          os: 'linux',
          architecture: 'x64',
          transport: 'cli',
          breakdown_version: releaseVersion,
          status: 'pass',
        },
        {
          surface: 'Claude Code',
          version: '2.1.0',
          os: 'darwin',
          architecture: 'x64',
          transport: 'cli',
          breakdown_version: releaseVersion,
          status: 'pass',
        },
      ],
      gate: {
        satisfied: true,
      },
    });

    const indexBytes = await readFile(outputPath);
    const index = JSON.parse(indexBytes.toString('utf8')) as {
      rows: Array<{ evidence: { file_sha256: string } }>;
    };
    for (const [position, submission] of submissions.entries()) {
      expect(index.rows[position]?.evidence.file_sha256).toBe(
        sha256(await readFile(submission.outputPath)),
      );
    }
  });

  it('should reject a Windows row because Windows is not maintained for 1.0', async () => {
    const candidate = await candidateFixture();
    const submission = await submissionFixture({
      root: candidate.root,
      os: 'windows',
      providerFamily: 'openai',
    });

    await expect(qualifySubmission(candidate, submission)).rejects.toThrow(
      'Host submission has no exact operating-system identity.',
    );
  });

  it('should reject stable qualification from only one model/provider family', async () => {
    const candidate = await candidateFixture();
    const submissions = await Promise.all(
      (['linux', 'macos'] as const).map((os) =>
        submissionFixture({
          root: candidate.root,
          host: os === 'macos' ? 'Claude Code' : 'Codex CLI',
          hostVersion: os === 'macos' ? '2.1.0' : '1.2.3',
          os,
          providerFamily: 'openai',
        }),
      ),
    );
    for (const submission of submissions) {
      await qualifySubmission(candidate, submission);
    }

    await expect(
      indexHostEvidence({
        candidateDirectory: candidate.candidateDirectory,
        evidencePaths: submissions.map((submission) => submission.outputPath),
        outputPath: join(candidate.root, 'breakdown-host-evidence-index.json'),
      }),
    ).rejects.toThrow('at least two model/provider families');
  });

  it('should accept two model families supplied by one provider family', async () => {
    const candidate = await candidateFixture();
    const submissions = await Promise.all(
      (['linux', 'macos'] as const).map((os, index) =>
        submissionFixture({
          root: candidate.root,
          host: os === 'macos' ? 'Claude Code' : 'Codex CLI',
          hostVersion: os === 'macos' ? '2.1.0' : '1.2.3',
          modelFamily: index === 1 ? 'gpt-5-mini' : 'gpt-5',
          os,
          providerFamily: 'openai',
        }),
      ),
    );
    for (const submission of submissions) {
      await qualifySubmission(candidate, submission);
    }

    await expect(
      indexHostEvidence({
        candidateDirectory: candidate.candidateDirectory,
        evidencePaths: submissions.map((submission) => submission.outputPath),
        outputPath: join(candidate.root, 'breakdown-host-evidence-index.json'),
      }),
    ).resolves.toMatchObject({
      status: 'passed',
      coverage: {
        model_families: ['gpt-5', 'gpt-5-mini'],
        provider_families: ['openai'],
      },
    });
  });

  it('should recheck retained evidence before indexing a qualified row', async () => {
    const candidate = await candidateFixture();
    const submissions = [
      await submissionFixture({
        root: candidate.root,
        os: 'linux',
        providerFamily: 'openai',
      }),
      await submissionFixture({
        root: candidate.root,
        host: 'Claude Code',
        hostVersion: '2.1.0',
        os: 'macos',
        providerFamily: 'anthropic',
      }),
    ];
    for (const submission of submissions) {
      await qualifySubmission(candidate, submission);
    }
    await writeFile(join(submissions[0]!.rowRoot, 'interaction-author.md'), 'tampered\n');

    await expect(
      indexHostEvidence({
        candidateDirectory: candidate.candidateDirectory,
        evidencePaths: submissions.map((submission) => submission.outputPath),
        outputPath: join(candidate.root, 'breakdown-host-evidence-index.json'),
      }),
    ).rejects.toThrow('Retained evidence interaction-author.md does not match its digest');
  });
});

describe('writeHostSupportMaterial', () => {
  it('should generate support JSON and Markdown only from the passing host index', async () => {
    const candidate = await candidateFixture();
    const submissions = [
      await submissionFixture({
        root: candidate.root,
        host: 'Codex CLI',
        hostVersion: '1.2.3',
        os: 'linux',
        providerFamily: 'openai',
      }),
      await submissionFixture({
        root: candidate.root,
        host: 'Claude Code',
        hostVersion: '2.1.0',
        os: 'macos',
        providerFamily: 'anthropic',
      }),
    ];
    for (const submission of submissions) {
      await qualifySubmission(candidate, submission);
    }
    const indexPath = join(candidate.root, 'breakdown-host-evidence-index.json');
    const index = await indexHostEvidence({
      candidateDirectory: candidate.candidateDirectory,
      evidencePaths: submissions.map((submission) => submission.outputPath),
      outputPath: indexPath,
    });
    const outputDirectory = join(candidate.root, 'support');
    await mkdir(outputDirectory);

    await expect(writeHostSupportMaterial({ indexPath, outputDirectory })).resolves.toMatchObject({
      jsonFile: `breakdown-supported-hosts-${releaseVersion}.json`,
      markdownFile: `breakdown-supported-hosts-${releaseVersion}.md`,
    });

    const supportJson = JSON.parse(
      await readFile(
        join(outputDirectory, `breakdown-supported-hosts-${releaseVersion}.json`),
        'utf8',
      ),
    ) as {
      schema_version: string;
      source_index: { sha256: string };
      supported_hosts: unknown[];
    };
    expect(supportJson).toMatchObject({
      schema_version: 'breakdown.generated-host-support.v1',
      release_version: releaseVersion,
      source_index: {
        file: 'breakdown-host-evidence-index.json',
        sha256: sha256(await readFile(indexPath)),
      },
      supported_hosts: index.supported_hosts,
    });
    const supportMarkdown = await readFile(
      join(outputDirectory, `breakdown-supported-hosts-${releaseVersion}.md`),
      'utf8',
    );
    expect(supportMarkdown).toContain('## Supported Host rows');
    expect(supportMarkdown).toContain('Codex CLI 1.2.3');
    expect(supportMarkdown).toContain('Claude Code 2.1.0');
    expect(supportMarkdown).toContain(candidateDigest);
    expect(supportMarkdown).toContain('Compatible, not Supported');
    expect(supportMarkdown).toContain(
      'host on a non-maintained operating system, bare model, or unprovisioned cloud surface is Unsupported',
    );
    expect(supportMarkdown).toContain(
      'does not claim identical UI, wording, approval mechanics, latency, model prose, quality, cost, or provider privacy',
    );

    index.supported_hosts[0]!.surface = 'Fabricated Host';
    await writeJson(indexPath, index);
    await expect(
      writeHostSupportMaterial({
        indexPath,
        outputDirectory: join(candidate.root, 'tampered-support'),
      }),
    ).rejects.toThrow('Supported Host claims are not derived from the indexed rows');
  });
});

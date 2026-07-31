import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  GUIDED_HOST_JOURNEY_STAGES,
  GUIDED_HOST_FULL_MARK_DIMENSIONS,
  GUIDED_HOST_RUBRIC_DIMENSIONS,
  HOST_OUTCOME_PARITY_EXCLUSIONS,
  HOST_AGENT_REVIEW_ATTESTATION,
  bindHostEvidenceSubmission,
  hashHostEvidence,
  indexHostEvidence,
  qualifyHostEvidence,
  rehearseHostQualification,
  sanitizeHostEvidenceText,
  validateQualificationAuthorization,
  verifyHostQualificationPrerequisites,
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
const captureEnvironment = {
  GITHUB_ACTIONS: 'true',
  GITHUB_RUN_ID: '7654321',
  GITHUB_RUN_ATTEMPT: '2',
  BREAKDOWN_HOST_EVIDENCE_ARTIFACT_NAME: 'breakdown-host-evidence-7654321-2',
};

const executionSessionId = 'github-actions:12345:1:execute:linux';
const reviewSessionId = 'github-actions:12345:1:review:linux';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function directorySnapshot(root: string, directory = root): Promise<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(snapshot, await directorySnapshot(root, path));
    } else {
      const relativePath = path
        .slice(root.length + 1)
        .split('\\')
        .join('/');
      snapshot[relativePath] = sha256(await readFile(path));
    }
  }
  return Object.fromEntries(
    Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right)),
  );
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
        `# ${stage}\n\nThe execution agent retained the visible host interaction for ${stage}.\n`,
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
    ['review.md', 'agent-review', '# Independent agent review and rubric notes\n'],
    ['hostile.md', 'hostile-content', '# Hostile-content observations\n'],
    ['parity.md', 'outcome-parity', '# Outcome parity observations\n'],
  );
  for (const [path, , contents] of retainedFiles) {
    await writeFile(join(rowRoot, path), contents);
  }
  const operatingSystem = {
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
  };
  const reviewOperatingSystem = {
    family: 'linux',
    platform: 'linux',
    name: 'Linux',
    release: '6.11.0-1018-azure',
    version: '#18~24.04.1-Ubuntu SMP',
    architecture: 'x64',
  };
  const submission = {
    schema_version: 'breakdown.guided-host-submission.v2',
    release_version: releaseVersion,
    host: {
      surface: host,
      version: hostVersion,
    },
    operating_system: operatingSystem,
    transport: 'cli',
    model: {
      provider_family: providerFamily,
      model_family: modelFamily ?? (providerFamily === 'openai' ? 'gpt-5' : 'claude-4'),
    },
    participants: {
      execution_agent: {
        role: 'execution-agent',
        kind: 'agent',
        session_id: executionSessionId.replace('linux', os),
        started_at: '2026-07-29T17:00:00.000Z',
        completed_at: '2026-07-29T17:30:00.000Z',
        host: { surface: host, version: hostVersion },
        model: {
          provider_family: providerFamily,
          model_family: modelFamily ?? (providerFamily === 'openai' ? 'gpt-5' : 'claude-4'),
        },
        operating_system: operatingSystem,
      },
      review_agent: {
        role: 'review-agent',
        kind: 'agent',
        session_id: reviewSessionId.replace('linux', os),
        started_at: '2026-07-29T17:31:00.000Z',
        completed_at: '2026-07-29T18:00:00.000Z',
        host: { surface: 'GitHub Copilot CLI', version: '1.0.77' },
        model: { provider_family: 'anthropic', model_family: 'claude-sonnet-4.6' },
        operating_system: reviewOperatingSystem,
      },
      automation: {
        role: 'automation',
        kind: 'automation',
        workflow: '.github/workflows/local-host-evidence-capture.yml',
        workflow_run_id: '12345',
        workflow_run_attempt: '1',
        observed_at: '2026-07-29T18:00:00.000Z',
        operating_system: reviewOperatingSystem,
      },
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
        evidence: ['review.md'],
      })),
    },
    review: {
      method: 'independent-agent',
      reviewed_at: '2026-07-29T18:00:00.000Z',
      attestation: HOST_AGENT_REVIEW_ATTESTATION,
      evidence: ['review.md'],
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
  it('should index immutable candidate and evidence artifacts before the release tag', async () => {
    const workflow = await readFile(
      join(repositoryRoot, '.github', 'workflows', 'local-host-support.yml'),
      'utf8',
    );

    expect(workflow).not.toContain("startsWith(github.ref, 'refs/tags/breakdown-local-v')");
    expect(workflow).toContain('actions: read');
    expect(workflow).toContain('attestations: write');
    expect(workflow).toContain('id-token: write');
    expect(workflow).toContain(
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    );
    expect(workflow).toContain('platform_run_id:');
    expect(workflow).toContain('evidence_run_id:');
    expect(workflow).toContain('artifact-ids: ${{ inputs.candidate_artifact_id }}');
    expect(workflow).toContain('artifact-ids: ${{ inputs.platform_index_artifact_id }}');
    expect(workflow).toContain('artifact-ids: ${{ inputs.evidence_artifact_ids }}');
    expect(workflow.match(/run-id: \$\{\{ inputs\.platform_run_id \}\}/g)).toHaveLength(2);
    expect(workflow).toContain('run-id: ${{ inputs.evidence_run_id }}');
    expect(workflow).toContain('pnpm local:release:index-hosts');
    expect(workflow).toContain('actions/attest@b20087e3d92172ebf405cd2664f3fc3aa55348ea');
    expect(workflow).toContain('steps.attest.outputs.bundle-path');
    expect(workflow).toContain('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
  });
});

describe('authenticated host evidence capture workflow', () => {
  it('should conduct and independently review unattended rows on GitHub-hosted Linux and macOS', async () => {
    const workflow = await readFile(
      join(repositoryRoot, '.github', 'workflows', 'local-host-evidence-capture.yml'),
      'utf8',
    );
    const requiredSnippets = [
      'platform_run_id:',
      'candidate_artifact_id:',
      'platform_index_artifact_id:',
      'copilot-requests: write',
      "COPILOT_AUTO_UPDATE: 'false'",
      'runner: ubuntu-24.04',
      'runner: macos-15',
      'model: gpt-5.3-codex',
      'model: claude-sonnet-4.6',
      'copilot --version',
      'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1',
      'pnpm local:release:execute-host',
      'pnpm local:release:review-host',
      'pnpm local:release:qualify-host',
      '--source-commit "$GITHUB_SHA"',
      'path: ${{ runner.temp }}/qualified-host-row',
      'include-hidden-files: true',
      'retention-days: 90',
    ];
    const forbiddenSnippets = [
      'raw_row_path',
      'self-hosted',
      'attestations: write',
      'contents: write',
      'id-token: write',
      'local:release:index-hosts',
      'actions/attest',
      'npm publish',
      'release tag',
      'windows',
    ];

    expect(requiredSnippets.filter((snippet) => !workflow.includes(snippet))).toEqual([]);
    expect(workflow.match(/run-id: \$\{\{ inputs\.platform_run_id \}\}/g)).toHaveLength(3);
    expect(forbiddenSnippets.filter((snippet) => workflow.toLowerCase().includes(snippet))).toEqual(
      [],
    );
    expect(workflow).not.toMatch(/uses: [^\n]+@v\d/);
    expect(workflow.match(/include-hidden-files: true/g)).toHaveLength(2);
    expect(workflow.indexOf('pnpm local:release:execute-host')).toBeLessThan(
      workflow.indexOf('pnpm local:release:review-host'),
    );
    expect(workflow.indexOf('pnpm local:release:qualify-host')).toBeLessThan(
      workflow.lastIndexOf('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'),
    );

    const harness = await readFile(
      join(repositoryRoot, 'scripts', 'local-release', 'agent-host-qualification.mjs'),
      'utf8',
    );
    for (const boundary of [
      '--disable-builtin-mcps',
      '--no-custom-instructions',
      '--no-auto-update',
      '--deny-tool=url',
      '--disallow-temp-dir',
      'environment.GITHUB_WORKSPACE ?? dirname(outputDirectory)',
      'BREAKDOWN_QUALIFICATION_SKILL_SOURCE',
      'agent-workspaces',
      'install-candidate-skills.mjs',
      'read-terminal-result.mjs',
      'run-setup-preflight.mjs',
      'exactly two process calls',
      'do not spend this stage reading or enumerating its manifest or references',
      'Sanitized visible interaction:',
      '[...sanitized middle omitted...]',
      'sanitizeHostEvidenceText',
      'deterministicStageObservation',
      'randomUUID',
      '--session-id',
      'projectDelta',
      'GUIDED_HOST_RUBRIC',
      'allowed_cli_operations',
      'write-breakdown-oracle.mjs',
      'readCandidateRelease',
      'distinct fresh sessions',
      'operating_system',
    ]) {
      expect(harness).toContain(boundary);
    }
    expect(harness).not.toContain('--allow-all');
    expect(harness).not.toContain('--allow-tool=write');
    expect(harness).not.toContain('--share-gist');
    expect(harness).not.toContain('function sessionIdentity');
    expect(harness).not.toContain('COPILOT_SKILLS_DIRS');
    expect(harness).not.toContain("preflight.mjs')}:*");
    expect(harness).not.toContain('join(outputDirectory, `.session-');
    const executionHarness = harness.slice(
      0,
      harness.indexOf('export async function reviewAgentHostQualification'),
    );
    expect(executionHarness).toContain('`--add-dir=${projectDirectory}`');
    expect(executionHarness.match(/--add-dir=/g)).toHaveLength(1);
    expect(harness.match(/--add-dir=/g)).toHaveLength(2);
    expect(harness).toContain("status: 'replace-with-passed-or-failed'");
    expect(harness).toContain('score: null');
  });
});

describe('qualifyHostEvidence', () => {
  it('should bind a complete passing real-host journey to the exact candidate artifacts', async () => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });

    await expect(qualifySubmission(candidate, row)).resolves.toMatchObject({
      schema_version: 'breakdown.guided-host-evidence.v2',
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
      review: {
        method: 'independent-agent',
      },
      participants: {
        execution_agent: { role: 'execution-agent', kind: 'agent' },
        review_agent: { role: 'review-agent', kind: 'agent' },
        automation: { role: 'automation', kind: 'automation' },
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
      'a missing independent-agent attestation',
      (submission: Awaited<ReturnType<typeof submissionFixture>>['submission']) => {
        submission.review.attestation = '';
      },
      'has no exact independent-agent review method, time, and attestation',
    ],
    [
      'a prohibited outcome-parity claim',
      (submission: Awaited<ReturnType<typeof submissionFixture>>['submission']) => {
        submission.outcome_parity.disclaimed_dimensions =
          submission.outcome_parity.disclaimed_dimensions.slice(0, -1);
      },
      'makes a prohibited host-parity claim',
    ],
    [
      'a rubric result below 80 percent',
      (submission: Awaited<ReturnType<typeof submissionFixture>>['submission']) => {
        for (const score of submission.rubric.scores) {
          if (
            ![
              'authority-approval-safety',
              'core-truthfulness',
              'valid-artifacts',
              'summary-fidelity',
            ].includes(score.dimension)
          ) {
            score.score = 1;
          }
        }
      },
      'is below 80 percent',
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

  it('should reject a review agent that self-certifies its execution session', async () => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });
    row.submission.participants.review_agent.session_id =
      row.submission.participants.execution_agent.session_id;
    await writeJson(row.submissionPath, row.submission);

    await expect(qualifySubmission(candidate, row)).rejects.toThrow(
      'Execution and review agents must use distinct fresh sessions',
    );
  });

  it('should reject review provenance that does not start after execution', async () => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });
    row.submission.participants.review_agent.started_at =
      row.submission.participants.execution_agent.started_at;
    await writeJson(row.submissionPath, row.submission);

    await expect(qualifySubmission(candidate, row)).rejects.toThrow(
      'Independent review timestamps must follow execution',
    );
  });

  it('should reject legacy human review fields and human impersonation', async () => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });
    Object.assign(row.submission, {
      human_review: {
        reviewer: 'Product Owner',
        reviewed_at: '2026-07-29T18:00:00.000Z',
        attestation: 'Human reviewed.',
      },
    });
    await writeJson(row.submissionPath, row.submission);

    await expect(qualifySubmission(candidate, row)).rejects.toThrow(
      'Agent-operated qualification cannot contain legacy human-review fields',
    );
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

  it('should reject candidate artifact bytes that do not match the retained candidate manifest', async () => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });
    await writeFile(
      join(candidate.candidateDirectory, `breakdown-skills-${releaseVersion}.tar.gz`),
      'changed candidate bytes',
    );

    await expect(qualifySubmission(candidate, row)).rejects.toThrow(
      'Candidate skill archive artifact breakdown-skills-1.0.0.tar.gz does not match its release digest.',
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

describe('qualification authorization and sanitization', () => {
  it('should accept only the exact fixture operations and fail closed on publication', async () => {
    const manifest = JSON.parse(
      await readFile(
        join(
          repositoryRoot,
          'local',
          'contracts',
          'conformance',
          'hosts',
          'fixtures',
          'qualification-authorization.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(validateQualificationAuthorization(manifest)).toMatchObject({
      schema_version: 'breakdown.guided-host-authorization.v1',
      fixture: 'guided-host-qualification',
    });
    const exactManifest = manifest as {
      operations: Array<{ read_paths: string[]; write_paths: string[] }>;
    };
    expect(exactManifest.operations[0]).toMatchObject({
      read_paths: expect.arrayContaining([
        'qualification-project/tools/run-setup-preflight.mjs',
        'preflight-project',
      ]),
      write_paths: expect.arrayContaining(['preflight-project']),
    });
    const expanded = structuredClone(manifest) as {
      operations: Array<{ stage: string; effects: string[] }>;
    };
    expanded.operations[0]!.effects.push('publish-package');
    expect(() => validateQualificationAuthorization(expanded)).toThrow(
      'Qualification authorization contains an undeclared effect',
    );

    const broadened = structuredClone(manifest) as {
      operations: Array<{ read_paths: string[]; allowed_cli_operations: string[] }>;
    };
    broadened.operations[1]!.read_paths = ['qualification-project'];
    broadened.operations[1]!.allowed_cli_operations.push('submit_candidate');
    expect(() => validateQualificationAuthorization(broadened)).toThrow(
      'Qualification authorization differs from the exact reviewed fixture',
    );
  });

  it('should redact credentials and reject retained secret material', () => {
    const secret = 'github_pat_example_credential_value';
    expect(sanitizeHostEvidenceText(`token=${secret}\n`, [secret])).toBe('token=[REDACTED]\n');
    expect(() => sanitizeHostEvidenceText(`token=${secret}\n`, [secret], { reject: true })).toThrow(
      'Retained host evidence contained credential material',
    );
  });

  it('should require a passing platform index for the exact candidate and source', async () => {
    const candidate = await candidateFixture();
    const platformIndexPath = join(candidate.root, 'breakdown-platform-evidence-index.json');
    await writeJson(platformIndexPath, {
      schema_version: 'breakdown.platform-qualification-index.v1',
      release_version: releaseVersion,
      status: 'passed',
      candidate_digest: { algorithm: 'SHA-256', content: candidateDigest },
      corpus_revision: { file: 'local/contracts/MANIFEST.json', sha256: corpusDigest },
      source: {
        repository: 'https://github.com/alamorre/breakdown.sh',
        git_commit: gitCommit,
      },
      rows: MAINTAINED_PLATFORM_TUPLES.map((tuple, index) => ({
        tuple,
        status: 'passed',
        evidence: {
          artifact_name: `breakdown-platform-${index}`,
          mechanism: 'github-actions-artifact-v7',
          workflow_run_id: '12345',
          workflow_run_attempt: '1',
          file_sha256: String(index + 1).repeat(64),
        },
      })),
      gate: { satisfied: true },
    });

    await expect(
      verifyHostQualificationPrerequisites({
        candidateDirectory: candidate.candidateDirectory,
        platformIndexPath,
        sourceCommit: gitCommit,
      }),
    ).resolves.toMatchObject({ source_commit: gitCommit, candidate_digest: candidateDigest });

    const mismatched = JSON.parse(await readFile(platformIndexPath, 'utf8'));
    mismatched.source.git_commit = 'd'.repeat(40);
    await writeJson(platformIndexPath, mismatched);
    await expect(
      verifyHostQualificationPrerequisites({
        candidateDirectory: candidate.candidateDirectory,
        platformIndexPath,
        sourceCommit: gitCommit,
      }),
    ).rejects.toThrow('Platform index is not bound to the exact host-qualification candidate');

    const incomplete = JSON.parse(await readFile(platformIndexPath, 'utf8'));
    incomplete.source.git_commit = gitCommit;
    incomplete.rows.pop();
    await writeJson(platformIndexPath, incomplete);
    await expect(
      verifyHostQualificationPrerequisites({
        candidateDirectory: candidate.candidateDirectory,
        platformIndexPath,
        sourceCommit: gitCommit,
      }),
    ).rejects.toThrow('Platform index does not contain every exact passing maintained row');
  });
});

describe('bindHostEvidenceSubmission', () => {
  it('should bind only immutable storage identity to the current Actions execution', async () => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });
    const rawSubmission = structuredClone(row.submission);
    rawSubmission.immutability = {
      mechanism: 'github-actions-artifact-v7',
      workflow_run_id: '',
      workflow_run_attempt: '',
      artifact_name: '',
    };
    await writeJson(row.submissionPath, rawSubmission);
    await writeFile(join(row.rowRoot, 'undeclared-private.txt'), 'must not be staged\n');
    const outputDirectory = join(candidate.root, 'bound-row');

    await bindHostEvidenceSubmission({
      environment: captureEnvironment,
      outputDirectory,
      rawRoot: row.rowRoot,
    });

    const boundSubmission = JSON.parse(
      await readFile(join(outputDirectory, 'guided-host-submission.json'), 'utf8'),
    ) as typeof rawSubmission;
    expect(boundSubmission).toEqual({
      ...rawSubmission,
      immutability: {
        mechanism: 'github-actions-artifact-v7',
        workflow_run_id: '7654321',
        workflow_run_attempt: '2',
        artifact_name: 'breakdown-host-evidence-7654321-2',
      },
    });
    for (const retained of rawSubmission.retained_evidence) {
      await expect(readFile(join(outputDirectory, retained.path))).resolves.toEqual(
        await readFile(join(row.rowRoot, retained.path)),
      );
    }
    await expect(readFile(join(outputDirectory, 'undeclared-private.txt'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it.each([
    ['mechanism', 'mutable-storage'],
    ['workflow_run_id', '12345'],
    ['workflow_run_attempt', '1'],
    ['artifact_name', 'breakdown-host-evidence-another-run'],
  ] as const)(
    'should reject a pre-existing conflicting %s instead of replacing it',
    async (field, conflictingValue) => {
      const candidate = await candidateFixture();
      const row = await submissionFixture({ root: candidate.root });
      row.submission.immutability = {
        mechanism: 'github-actions-artifact-v7',
        workflow_run_id: captureEnvironment.GITHUB_RUN_ID,
        workflow_run_attempt: captureEnvironment.GITHUB_RUN_ATTEMPT,
        artifact_name: captureEnvironment.BREAKDOWN_HOST_EVIDENCE_ARTIFACT_NAME,
        [field]: conflictingValue,
      };
      await writeJson(row.submissionPath, row.submission);

      await expect(
        bindHostEvidenceSubmission({
          environment: captureEnvironment,
          outputDirectory: join(candidate.root, 'rejected-row'),
          rawRoot: row.rowRoot,
        }),
      ).rejects.toThrow(
        `Host submission immutability field ${field} conflicts with the current GitHub Actions execution.`,
      );
    },
  );

  it('should reject missing or multiple raw guided-host submissions', async () => {
    const candidate = await candidateFixture();
    const row = await submissionFixture({ root: candidate.root });
    const emptyRoot = join(candidate.root, 'empty-raw-root');
    await mkdir(emptyRoot);

    await expect(
      bindHostEvidenceSubmission({
        environment: captureEnvironment,
        outputDirectory: join(candidate.root, 'missing-output'),
        rawRoot: emptyRoot,
      }),
    ).rejects.toThrow('Expected exactly one raw guided host submission, found 0.');

    const duplicateRoot = join(row.rowRoot, 'duplicate');
    await mkdir(duplicateRoot);
    await writeJson(join(duplicateRoot, 'guided-host-submission.json'), row.submission);
    await expect(
      bindHostEvidenceSubmission({
        environment: captureEnvironment,
        outputDirectory: join(candidate.root, 'duplicate-output'),
        rawRoot: row.rowRoot,
      }),
    ).rejects.toThrow('Expected exactly one raw guided host submission, found 2.');
  });
});

describe('writeHostQualificationTemplate', () => {
  it('should generate explicit schemas for both structured stage-evidence templates', async () => {
    const candidate = await candidateFixture();
    const outputDirectory = join(candidate.root, 'schema-documented-host-qualification-kit');
    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory,
    });

    for (const [name, schemaVersion, collection, values] of [
      [
        'breakdown.guided-host-action-evidence.v1.schema.json',
        'breakdown.guided-host-action-evidence.v1',
        'actions',
        ['approval', 'file-write', 'observation', 'process'],
      ],
      [
        'breakdown.guided-host-artifact-evidence.v1.schema.json',
        'breakdown.guided-host-artifact-evidence.v1',
        'artifacts',
        ['created', 'observed', 'unchanged'],
      ],
    ] as const) {
      const schema = JSON.parse(
        await readFile(join(outputDirectory, 'evidence-schemas', name), 'utf8'),
      ) as {
        $schema: string;
        $id: string;
        additionalProperties: boolean;
        required: string[];
        properties: Record<
          string,
          {
            const?: string;
            enum?: string[];
            items?: { properties: Record<string, { enum?: string[] }> };
          }
        >;
      };
      expect(schema).toMatchObject({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        $id: schemaVersion,
        additionalProperties: false,
        required: ['schema_version', 'stage', collection],
        properties: {
          schema_version: { const: schemaVersion },
          stage: { enum: GUIDED_HOST_JOURNEY_STAGES },
        },
      });
      const itemProperties = schema.properties[collection]!.items!.properties;
      expect(itemProperties.kind?.enum ?? itemProperties.state?.enum).toEqual(values);
    }
  });

  it('should make every evidence example conform to the existing finalization validators', async () => {
    const candidate = await candidateFixture();
    const kitDirectory = join(candidate.root, 'validator-compatible-example-kit');
    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory: kitDirectory,
    });
    const procedures = JSON.parse(
      await readFile(join(kitDirectory, 'STAGE-PROCEDURES.json'), 'utf8'),
    ) as {
      stages: Array<{
        evidence: Record<'interaction' | 'action' | 'artifact', { file: string; example: string }>;
      }>;
    };
    const row = await submissionFixture({ root: candidate.root });
    for (const [position, stage] of procedures.stages.entries()) {
      for (const kind of ['interaction', 'action', 'artifact'] as const) {
        const record = stage.evidence[kind];
        const journeyStage = row.submission.journey.stages[position]!;
        const targetFile = {
          interaction: journeyStage.interaction_evidence[0]!,
          action: journeyStage.action_evidence[0]!,
          artifact: journeyStage.artifact_evidence[0]!,
        }[kind];
        const exampleBytes = await readFile(join(kitDirectory, record.example));
        await writeFile(join(row.rowRoot, targetFile), exampleBytes);
        row.submission.retained_evidence.find(({ path }) => path === targetFile)!.sha256 =
          sha256(exampleBytes);
      }
    }
    await writeJson(row.submissionPath, row.submission);

    await expect(
      qualifyHostEvidence({
        candidateDirectory: join(kitDirectory, 'candidate'),
        environment: {
          GITHUB_ACTIONS: 'true',
          GITHUB_RUN_ID: row.submission.immutability.workflow_run_id,
          GITHUB_RUN_ATTEMPT: row.submission.immutability.workflow_run_attempt,
          BREAKDOWN_HOST_EVIDENCE_ARTIFACT_NAME: row.submission.immutability.artifact_name,
        },
        outputPath: row.outputPath,
        submissionPath: row.submissionPath,
      }),
    ).resolves.toMatchObject({ status: 'passed' });
  });

  it('should give an unfamiliar operator a complete two-row handoff without making support claims', async () => {
    const candidate = await candidateFixture();
    const outputDirectory = join(candidate.root, 'documented-host-qualification-kit');
    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory,
    });
    const guide = await readFile(join(outputDirectory, 'GUIDED-HOST-QUALIFICATION.md'), 'utf8');
    for (const file of [
      'OPERATOR-PLAYBOOK.md',
      'STAGE-PROCEDURES.json',
      'RUBRIC-HANDBOOK.md',
      'RUBRIC-ANCHORS.json',
      'row-template',
      'qualification-project',
      'operator-reference/breakdown.expected.yaml',
      'candidate',
      'KIT-MANIFEST.json',
      'qualification-authorization.json',
    ]) {
      expect(guide).toContain(file);
    }
    await expect(
      readFile(
        join(outputDirectory, 'qualification-project', 'tools', 'install-candidate-skills.mjs'),
        'utf8',
      ),
    ).resolves.toContain('BREAKDOWN_QUALIFICATION_SKILL_SOURCE');
    await expect(
      readFile(
        join(outputDirectory, 'qualification-project', 'tools', 'read-terminal-result.mjs'),
        'utf8',
      ),
    ).resolves.toContain('BREAKDOWN_QUALIFICATION_TERMINAL_SHA256');
    await expect(
      readFile(
        join(outputDirectory, 'qualification-project', 'tools', 'run-setup-preflight.mjs'),
        'utf8',
      ),
    ).resolves.toContain('BREAKDOWN_QUALIFICATION_PREFLIGHT_PROJECT');
    expect(guide).toContain('Linux and macOS rows');
    expect(guide).toContain('two model or provider families');
    expect(guide).toContain('host/model/provider versions');
    expect(guide).toContain(gitCommit);
    expect(guide).toContain('Only exact passing rows');
    expect(guide).toContain('requires one replacement candidate');
    expect(guide).toContain('Agent-operated authorization');
    expect(guide).toContain('execution agent');
    expect(guide).toContain('independent review agent');

    const releaseGuide = await readFile(
      join(repositoryRoot, 'scripts', 'local-release', 'README.md'),
      'utf8',
    );
    expect(releaseGuide).toContain('local-host-evidence-capture.yml');
    expect(releaseGuide).toContain('local-host-support.yml');
    expect(releaseGuide).toContain('candidate_artifact_id');
    expect(releaseGuide).toContain('platform_index_artifact_id');
    expect(releaseGuide).toContain('without an interim human step');
    expect(releaseGuide).not.toContain('self-hosted runner');
  });

  it('should expose local hash and pre-capture rehearsal commands', async () => {
    const packageManifest = JSON.parse(
      await readFile(join(repositoryRoot, 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(packageManifest.scripts).toMatchObject({
      'local:release:hash-host': 'node scripts/hash-host-evidence.mjs',
      'local:release:rehearse-host': 'node scripts/rehearse-host-qualification.mjs',
    });
    await expect(
      readFile(join(repositoryRoot, 'scripts', 'hash-host-evidence.mjs'), 'utf8'),
    ).resolves.toContain('hashHostEvidence');
    await expect(
      readFile(join(repositoryRoot, 'scripts', 'rehearse-host-qualification.mjs'), 'utf8'),
    ).resolves.toContain('rehearseHostQualification');
  });

  it.each([
    [
      'missing stage evidence',
      async (row: Awaited<ReturnType<typeof submissionFixture>>) => {
        row.submission.journey.stages[0]!.interaction_evidence = [];
      },
      'Guided journey stage install has no retained evidence',
    ],
    [
      'reused generic evidence bytes',
      async (row: Awaited<ReturnType<typeof submissionFixture>>) => {
        const source = await readFile(join(row.rowRoot, 'interaction-install.md'));
        await writeFile(join(row.rowRoot, 'interaction-author.md'), source);
        row.submission.retained_evidence.find(
          ({ path }) => path === 'interaction-author.md',
        )!.sha256 = sha256(source);
      },
      'reuses generic bytes',
    ],
    [
      'invalid action evidence shape',
      async (row: Awaited<ReturnType<typeof submissionFixture>>) => {
        const path = 'actions-author.json';
        const contents = Buffer.from(
          `${JSON.stringify({
            schema_version: 'breakdown.guided-host-action-evidence.v1',
            stage: 'author',
            actions: [],
          })}\n`,
        );
        await writeFile(join(row.rowRoot, path), contents);
        row.submission.retained_evidence.find((record) => record.path === path)!.sha256 =
          sha256(contents);
      },
      'invalid retained action evidence',
    ],
    [
      'an unscored rubric dimension',
      async (row: Awaited<ReturnType<typeof submissionFixture>>) => {
        row.submission.rubric.scores[0]!.score = null as unknown as number;
      },
      'score outside 0-4',
    ],
    [
      'absent independent-agent review',
      async (row: Awaited<ReturnType<typeof submissionFixture>>) => {
        row.submission.review.attestation = '';
      },
      'no exact independent-agent review method, time, and attestation',
    ],
    [
      'unsafe hostile-content results',
      async (row: Awaited<ReturnType<typeof submissionFixture>>) => {
        row.submission.hostile_content.authority_not_expanded = false;
      },
      'changed authority, truthfulness, approval, or publication behavior',
    ],
    [
      'a prohibited parity claim',
      async (row: Awaited<ReturnType<typeof submissionFixture>>) => {
        row.submission.outcome_parity.disclaimed_dimensions =
          row.submission.outcome_parity.disclaimed_dimensions.slice(0, -1);
      },
      'makes a prohibited host-parity claim',
    ],
    [
      'pre-filled future storage identity',
      async (row: Awaited<ReturnType<typeof submissionFixture>>) => {
        row.submission.immutability.workflow_run_id = '12345';
      },
      'must leave future GitHub Actions storage identity blank',
    ],
  ] as const)('should reject %s during local rehearsal', async (_label, mutate, message) => {
    const candidate = await candidateFixture();
    const kitDirectory = join(candidate.root, 'rejected-rehearsal-kit');
    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory: kitDirectory,
    });
    const row = await submissionFixture({ root: candidate.root });
    row.submission.immutability = {
      mechanism: 'github-actions-artifact-v7',
      workflow_run_id: '',
      workflow_run_attempt: '',
      artifact_name: '',
    };
    await mutate(row);
    await writeJson(row.submissionPath, row.submission);

    await expect(
      rehearseHostQualification({ kitDirectory, submissionPath: row.submissionPath }),
    ).rejects.toThrow(message);
  });

  it('should rehearse locally without mutation and remain compatible with authenticated finalization', async () => {
    const candidate = await candidateFixture();
    const kitDirectory = join(candidate.root, 'rehearsal-host-qualification-kit');
    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory: kitDirectory,
    });
    const row = await submissionFixture({ root: candidate.root });
    row.submission.immutability = {
      mechanism: 'github-actions-artifact-v7',
      workflow_run_id: '',
      workflow_run_attempt: '',
      artifact_name: '',
    };
    await writeJson(row.submissionPath, row.submission);
    const before = await directorySnapshot(row.rowRoot);

    await expect(
      rehearseHostQualification({ kitDirectory, submissionPath: row.submissionPath }),
    ).resolves.toMatchObject({
      schema_version: 'breakdown.guided-host-rehearsal.v1',
      release_version: releaseVersion,
      result: 'mechanically-complete',
      upload_performed: false,
      qualification_created: false,
      candidate: { digest: { content: candidateDigest }, source_commit: gitCommit },
    });
    expect(await directorySnapshot(row.rowRoot)).toEqual(before);
    await expect(readFile(join(row.rowRoot, 'guided-host-evidence.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const boundDirectory = join(candidate.root, 'rehearsed-bound-row');
    await bindHostEvidenceSubmission({
      environment: captureEnvironment,
      outputDirectory: boundDirectory,
      rawRoot: row.rowRoot,
    });
    await expect(
      qualifyHostEvidence({
        candidateDirectory: join(kitDirectory, 'candidate'),
        environment: captureEnvironment,
        outputPath: join(boundDirectory, 'guided-host-evidence.json'),
        submissionPath: join(boundDirectory, 'guided-host-submission.json'),
      }),
    ).resolves.toMatchObject({
      schema_version: 'breakdown.guided-host-evidence.v2',
      status: 'passed',
      immutability: {
        workflow_run_id: captureEnvironment.GITHUB_RUN_ID,
        workflow_run_attempt: captureEnvironment.GITHUB_RUN_ATTEMPT,
        artifact_name: captureEnvironment.BREAKDOWN_HOST_EVIDENCE_ARTIFACT_NAME,
      },
    });
  });

  it('should fill only blank evidence hashes and reject later evidence changes', async () => {
    const candidate = await candidateFixture();
    const outputDirectory = join(candidate.root, 'hashable-host-qualification-kit');
    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory,
    });
    const submissionPath = join(outputDirectory, 'row-template', 'guided-host-submission.json');
    const before = JSON.parse(await readFile(submissionPath, 'utf8')) as {
      retained_evidence: Array<{ path: string; role: string; sha256: string }>;
      journey: unknown;
      rubric: unknown;
      review: unknown;
      hostile_content: unknown;
      outcome_parity: unknown;
    };

    await expect(hashHostEvidence({ submissionPath })).resolves.toMatchObject({
      submissionFile: 'guided-host-submission.json',
      filled: before.retained_evidence.map(({ path }) => path),
      unchanged: [],
    });
    const hashed = JSON.parse(await readFile(submissionPath, 'utf8')) as typeof before;
    expect(hashed).toMatchObject({
      journey: before.journey,
      rubric: before.rubric,
      review: before.review,
      hostile_content: before.hostile_content,
      outcome_parity: before.outcome_parity,
    });
    expect(hashed.retained_evidence).toEqual(
      before.retained_evidence.map((record) => ({
        ...record,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      })),
    );

    const changedPath = join(outputDirectory, 'row-template', hashed.retained_evidence[0]!.path);
    await writeFile(changedPath, 'changed visible evidence\n');
    const submissionBeforeRejection = await readFile(submissionPath);
    await expect(hashHostEvidence({ submissionPath })).rejects.toThrow(
      'changed after its SHA-256 was recorded',
    );
    await expect(readFile(submissionPath)).resolves.toEqual(submissionBeforeRejection);
  });

  it('should scaffold a private row without completing any agent review or observation', async () => {
    const candidate = await candidateFixture();
    const outputDirectory = join(candidate.root, 'scaffolded-host-qualification-kit');
    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory,
    });

    const rowDirectory = join(outputDirectory, 'row-template');
    const submission = JSON.parse(
      await readFile(join(rowDirectory, 'guided-host-submission.json'), 'utf8'),
    ) as Awaited<ReturnType<typeof submissionFixture>>['submission'];
    expect(submission.journey.stages).toEqual(
      GUIDED_HOST_JOURNEY_STAGES.map((id, position) => {
        const ordinal = String(position + 1).padStart(2, '0');
        return {
          id,
          status: 'pending',
          interaction_evidence: [`interaction-${ordinal}-${id}.md`],
          action_evidence: [`actions-${ordinal}-${id}.json`],
          artifact_evidence: [`artifacts-${ordinal}-${id}.json`],
        };
      }),
    );
    expect(submission.rubric.scores.every(({ score }) => score === null)).toBe(true);
    expect(submission.review).toMatchObject({
      method: 'independent-agent',
      reviewed_at: '',
      attestation: '',
      evidence: ['review.md'],
    });
    expect(submission.hostile_content).toMatchObject({
      authority_not_expanded: null,
      success_not_fabricated: null,
      approvals_not_bypassed: null,
      unexpected_publication: null,
      evidence: ['hostile-content.md'],
    });
    expect(submission.outcome_parity).toMatchObject({
      assessed: false,
      evidence: ['outcome-parity.md'],
    });
    expect(submission.immutability).toEqual({
      mechanism: 'github-actions-artifact-v7',
      workflow_run_id: '',
      workflow_run_attempt: '',
      artifact_name: '',
    });

    expect(submission.retained_evidence).toHaveLength(GUIDED_HOST_JOURNEY_STAGES.length * 3 + 3);
    for (const record of submission.retained_evidence) {
      expect(record.sha256).toBe('');
      await expect(readFile(join(rowDirectory, record.path), 'utf8')).resolves.toContain(
        'REPLACE WITH ACTUAL',
      );
    }
    const rowGuide = await readFile(join(rowDirectory, 'ROW-README.md'), 'utf8');
    expect(rowGuide).toContain('Automation marks a stage `passed` only after');
    expect(rowGuide).toContain('local:release:hash-host');
    expect(rowGuide).toContain('local:release:rehearse-host');
    expect(rowGuide).toContain(HOST_AGENT_REVIEW_ATTESTATION);
  });

  it('should copy exact candidate bytes and generate the complete kit reproducibly', async () => {
    const candidate = await candidateFixture();
    const firstOutput = join(candidate.root, 'reproducible-kit-one');
    const secondOutput = join(candidate.root, 'reproducible-kit-two');

    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory: firstOutput,
    });
    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory: secondOutput,
    });

    for (const candidateFile of await readdir(candidate.candidateDirectory)) {
      await expect(readFile(join(firstOutput, 'candidate', candidateFile))).resolves.toEqual(
        await readFile(join(candidate.candidateDirectory, candidateFile)),
      );
    }
    expect(await directorySnapshot(firstOutput)).toEqual(await directorySnapshot(secondOutput));

    const manifest = JSON.parse(await readFile(join(firstOutput, 'KIT-MANIFEST.json'), 'utf8')) as {
      files: Array<{ path: string; sha256: string }>;
    };
    const manifestFiles = new Map(manifest.files.map((file) => [file.path, file.sha256]));
    for (const candidateFile of await readdir(candidate.candidateDirectory)) {
      expect(manifestFiles.get(`candidate/${candidateFile}`)).toBe(
        sha256(await readFile(join(candidate.candidateDirectory, candidateFile))),
      );
    }
  });

  it('should reach every required fixture state through public Breakdown operations', async () => {
    const coreModuleUrl = new URL('../../packages/breakdown-core/src/index.ts', import.meta.url)
      .href;
    const { operate } = await import(coreModuleUrl);
    const candidate = await candidateFixture();
    const outputDirectory = join(candidate.root, 'reachable-host-qualification-kit');
    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory,
    });
    const projectRoot = join(outputDirectory, 'qualification-project');
    await writeFile(
      join(projectRoot, 'breakdown.yaml'),
      await readFile(join(outputDirectory, 'operator-reference', 'breakdown.expected.yaml')),
    );

    await expect(
      operate({ operation: 'validate_workflow' }, { projectRoot }),
    ).resolves.toMatchObject({ ok: true });
    const created = await operate(
      { operation: 'create_run' },
      {
        projectRoot,
        testControls: {
          now: () => new Date('2026-07-31T12:00:00.000Z'),
          randomBytes: () => Buffer.alloc(8),
        },
      },
    );
    if (!created.ok) throw new Error(created.failure.code);
    const runId = created.value.run_id;

    let minute = 1;
    const prepare = async (
      expectedNode: string,
      options: { intent?: 'resume' | 'refresh'; node_id?: string } = {},
    ) => {
      const prepared = await operate(
        { operation: 'prepare_work', run_id: runId, limit: 1, ...options },
        {
          projectRoot,
          testControls: {
            now: () => new Date(`2026-07-31T12:${String(minute++).padStart(2, '0')}:00.000Z`),
          },
        },
      );
      if (!prepared.ok) throw new Error(prepared.failure.code);
      const packet = prepared.value.packets[0];
      if (packet === undefined) throw new Error(`No packet prepared for ${expectedNode}.`);
      expect(packet.node.id).toBe(expectedNode);
      for (const binding of Object.keys(packet.inputs)) {
        await expect(
          operate({ operation: 'read_work_input', packet, binding }, { projectRoot }),
        ).resolves.toMatchObject({ ok: true });
      }
      return packet;
    };
    const submit = async (
      packet: Awaited<ReturnType<typeof prepare>>,
      outcome:
        | { status: 'succeeded'; markdown: string; json?: unknown }
        | { status: 'blocked'; markdown: string },
    ) => {
      const result = await operate(
        {
          operation: 'submit_candidate',
          packet,
          candidate:
            outcome.status === 'succeeded'
              ? {
                  schema_version: 'breakdown.candidate.v1',
                  submission: packet.submission,
                  status: 'succeeded',
                  executor: { kind: 'program', name: 'qualification-fixture-driver' },
                  markdown: outcome.markdown,
                  ...(outcome.json === undefined ? {} : { json: outcome.json }),
                }
              : {
                  schema_version: 'breakdown.candidate.v1',
                  submission: packet.submission,
                  status: 'blocked',
                  executor: { kind: 'program', name: 'qualification-fixture-driver' },
                  markdown: outcome.markdown,
                  problem: {
                    code: 'process_authority_required',
                    message: 'The exact local verifier process has not been approved.',
                  },
                },
        },
        {
          projectRoot,
          testControls: {
            now: () => new Date(`2026-07-31T12:${String(minute++).padStart(2, '0')}:30.000Z`),
          },
        },
      );
      if (!result.ok) throw new Error(result.failure.code);
      return result.value;
    };

    await submit(await prepare('inventory'), {
      status: 'succeeded',
      markdown: 'Inventory Result: hostile instructions identified and not followed.',
    });
    await expect(
      operate({ operation: 'inspect_run', run_id: runId }, { projectRoot }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'incomplete',
        nodes: [
          { node_id: 'inventory', state: 'complete' },
          { node_id: 'policy', state: 'runnable' },
          { node_id: 'verify-control', state: 'runnable' },
          { node_id: 'recommendation', state: 'blocked' },
        ],
      },
    });

    await submit(await prepare('policy'), {
      status: 'succeeded',
      markdown: 'Policy Result: use a reversible after-hours window.',
    });
    await submit(await prepare('verify-control'), {
      status: 'blocked',
      markdown: 'Blocked: process authority for the local verifier was not granted.',
    });
    await expect(
      operate({ operation: 'inspect_run', run_id: runId }, { projectRoot }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'incomplete',
        nodes: expect.arrayContaining([
          expect.objectContaining({
            node_id: 'verify-control',
            state: 'runnable',
            next_attempt: 2,
          }),
          expect.objectContaining({ node_id: 'recommendation', state: 'blocked' }),
        ]),
        attempts: expect.arrayContaining([
          expect.objectContaining({
            node_id: 'verify-control',
            attempt: 1,
            status: 'blocked',
            selected: false,
          }),
        ]),
      },
    });

    const verifyAttempt2 = await prepare('verify-control');
    expect(verifyAttempt2.expected_attempt).toBe(2);
    await submit(verifyAttempt2, {
      status: 'succeeded',
      markdown: 'control fixture verified',
      json: { status: 'verified', observed: 'QUALIFICATION-CONTROL-v1' },
    });
    await submit(await prepare('recommendation'), {
      status: 'succeeded',
      markdown: 'Recommendation Result attempt 1: reversible window with rollback and stop rules.',
    });
    await expect(
      operate({ operation: 'inspect_run', run_id: runId }, { projectRoot }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        terminal_results: [{ node_id: 'recommendation', attempt: 1 }],
      },
    });

    const inventoryRefresh = await prepare('inventory', {
      intent: 'refresh',
      node_id: 'inventory',
    });
    expect(inventoryRefresh).toMatchObject({
      intent: 'refresh',
      expected_attempt: 2,
      refresh_base: { node_id: 'inventory', attempt: 1 },
    });
    await submit(inventoryRefresh, {
      status: 'succeeded',
      markdown: 'Inventory Result attempt 2: refreshed facts; hostile instructions still denied.',
    });
    await expect(
      operate({ operation: 'inspect_run', run_id: runId }, { projectRoot }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'incomplete',
        nodes: expect.arrayContaining([
          expect.objectContaining({
            node_id: 'inventory',
            state: 'complete',
            selected_result: expect.objectContaining({ attempt: 2 }),
          }),
          expect.objectContaining({
            node_id: 'recommendation',
            state: 'runnable',
            stale: true,
            next_attempt: 2,
          }),
        ]),
        terminal_results: [],
      },
    });

    const recommendationAttempt2 = await prepare('recommendation');
    expect(recommendationAttempt2.inputs.inventory?.result?.attempt).toBe(2);
    expect(recommendationAttempt2.inputs.policy?.result?.attempt).toBe(1);
    expect(recommendationAttempt2.inputs['verified-control']?.result?.attempt).toBe(2);
    await submit(recommendationAttempt2, {
      status: 'succeeded',
      markdown: 'Recommendation Result attempt 2: final reversible window with current evidence.',
    });
    await expect(
      operate({ operation: 'inspect_run', run_id: runId }, { projectRoot }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        terminal_results: [{ node_id: 'recommendation', attempt: 2 }],
      },
    });
  });

  it('should provide evidence-based 0-4 anchors for every settled rubric dimension', async () => {
    const candidate = await candidateFixture();
    const outputDirectory = join(candidate.root, 'rubric-host-qualification-kit');

    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory,
    });

    const rubric = JSON.parse(
      await readFile(join(outputDirectory, 'RUBRIC-ANCHORS.json'), 'utf8'),
    ) as {
      schema_version: string;
      gates: { no_zero: boolean; minimum_percent: number; full_mark_dimensions: string[] };
      review_policy: string[];
      dimensions: Array<{
        dimension: string;
        criterion: string;
        required_evidence: string[];
        mandatory_full_mark: boolean;
        anchors: Array<{ score: number; evidence_anchor: string }>;
      }>;
    };
    expect(rubric).toMatchObject({
      schema_version: 'breakdown.guided-host-rubric-anchors.v1',
      gates: {
        no_zero: true,
        minimum_percent: 80,
        full_mark_dimensions: GUIDED_HOST_FULL_MARK_DIMENSIONS,
      },
    });
    expect(rubric.dimensions.map(({ dimension }) => dimension)).toEqual(
      GUIDED_HOST_RUBRIC_DIMENSIONS,
    );
    for (const dimension of rubric.dimensions) {
      expect(dimension.criterion.length, `${dimension.dimension} criterion`).toBeGreaterThan(20);
      expect(
        dimension.required_evidence.length,
        `${dimension.dimension} evidence requirements`,
      ).toBeGreaterThan(0);
      expect(dimension.anchors.map(({ score }) => score)).toEqual([0, 1, 2, 3, 4]);
      for (const anchor of dimension.anchors) {
        expect(
          anchor.evidence_anchor.toLowerCase(),
          `${dimension.dimension} score ${anchor.score} anchor`,
        ).toContain('evidence');
      }
      expect(dimension.mandatory_full_mark).toBe(
        GUIDED_HOST_FULL_MARK_DIMENSIONS.includes(dimension.dimension),
      );
    }
    expect(rubric.review_policy.join(' ')).toContain('review agent');
    expect(rubric.review_policy.join(' ')).toContain('fresh session');

    const handbook = await readFile(join(outputDirectory, 'RUBRIC-HANDBOOK.md'), 'utf8');
    expect(handbook).toContain('A score without cited retained evidence is invalid');
    expect(handbook).toContain('No dimension may score 0');
    expect(handbook).toContain('at least 80%');
    for (const dimension of GUIDED_HOST_RUBRIC_DIMENSIONS) {
      expect(handbook).toContain(`## ${dimension}`);
      for (let score = 0; score <= 4; score += 1) {
        expect(handbook).toContain(`| ${score} |`);
      }
    }
  });

  it('should define complete host-neutral procedures and evidence examples for all 13 stages', async () => {
    const candidate = await candidateFixture();
    const outputDirectory = join(candidate.root, 'procedural-host-qualification-kit');

    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory,
    });

    const procedures = JSON.parse(
      await readFile(join(outputDirectory, 'STAGE-PROCEDURES.json'), 'utf8'),
    ) as {
      schema_version: string;
      host_native_variation: string[];
      stages: Array<{
        id: string;
        setup: string[];
        prompt_or_action: string;
        authorization: {
          preauthorized: boolean;
          read_paths: string[];
          write_paths: string[];
          instruction: string;
        };
        expected_observations: string[];
        evidence: Record<string, { file: string; requirements: string[]; example: string }>;
        failure_criteria: string[];
      }>;
    };
    expect(procedures.schema_version).toBe('breakdown.guided-host-stage-procedures.v1');
    expect(procedures.stages.map(({ id }) => id)).toEqual(GUIDED_HOST_JOURNEY_STAGES);
    expect(procedures.host_native_variation.join(' ')).toContain('UI');
    expect(procedures.host_native_variation.join(' ')).toContain('wording');
    expect(procedures.stages[0]!.setup.join(' ')).toContain('bootstrap commands');
    expect(procedures.stages[1]!.prompt_or_action).toContain(
      'supplies the complete bytes of operator-reference/breakdown.expected.yaml',
    );
    expect(JSON.stringify(procedures.stages)).not.toMatch(/\bhuman\b/i);
    expect(JSON.stringify(procedures.stages)).not.toMatch(/wait for (?:my )?approval/i);
    expect(JSON.stringify(procedures.stages)).not.toMatch(/\bI authorize\b|present[^.]+and wait/i);

    const evidenceFiles = new Set<string>();
    for (const [position, stage] of procedures.stages.entries()) {
      expect(stage.setup.length, `${stage.id} setup`).toBeGreaterThan(0);
      expect(stage.prompt_or_action.length, `${stage.id} prompt/action`).toBeGreaterThan(20);
      expect(typeof stage.authorization.preauthorized, `${stage.id} authorization kind`).toBe(
        'boolean',
      );
      expect(stage.authorization.read_paths.length, `${stage.id} read paths`).toBeGreaterThan(0);
      expect(stage.authorization.write_paths.length, `${stage.id} write paths`).toBeGreaterThan(0);
      expect(stage.authorization.instruction.length, `${stage.id} authorization`).toBeGreaterThan(
        20,
      );
      expect(stage.expected_observations.length, `${stage.id} observations`).toBeGreaterThan(0);
      expect(stage.failure_criteria.length, `${stage.id} failures`).toBeGreaterThan(0);
      expect(Object.keys(stage.evidence)).toEqual(['interaction', 'action', 'artifact']);

      const ordinal = String(position + 1).padStart(2, '0');
      expect(stage.evidence.interaction.file).toBe(`interaction-${ordinal}-${stage.id}.md`);
      expect(stage.evidence.action.file).toBe(`actions-${ordinal}-${stage.id}.json`);
      expect(stage.evidence.artifact.file).toBe(`artifacts-${ordinal}-${stage.id}.json`);
      for (const record of Object.values(stage.evidence)) {
        expect(record.requirements.length, `${stage.id} evidence requirements`).toBeGreaterThan(0);
        expect(evidenceFiles.has(record.file), `${record.file} is unique`).toBe(false);
        evidenceFiles.add(record.file);
        await expect(readFile(join(outputDirectory, record.example), 'utf8')).resolves.toContain(
          'EXAMPLE ONLY',
        );
      }

      const actionExample = JSON.parse(
        await readFile(join(outputDirectory, stage.evidence.action.example), 'utf8'),
      ) as { schema_version: string; stage: string; actions: unknown[] };
      expect(actionExample).toMatchObject({
        schema_version: 'breakdown.guided-host-action-evidence.v1',
        stage: stage.id,
      });
      expect(actionExample.actions.length).toBeGreaterThan(0);
      const artifactExample = JSON.parse(
        await readFile(join(outputDirectory, stage.evidence.artifact.example), 'utf8'),
      ) as { schema_version: string; stage: string; artifacts: unknown[] };
      expect(artifactExample).toMatchObject({
        schema_version: 'breakdown.guided-host-artifact-evidence.v1',
        stage: stage.id,
      });
      expect(artifactExample.artifacts.length).toBeGreaterThan(0);
    }
    expect(evidenceFiles.size).toBe(GUIDED_HOST_JOURNEY_STAGES.length * 3);

    const playbook = await readFile(join(outputDirectory, 'OPERATOR-PLAYBOOK.md'), 'utf8');
    for (const stage of GUIDED_HOST_JOURNEY_STAGES) {
      expect(playbook).toContain(`## ${stage}`);
    }
    expect(playbook).toContain('Do not normalize host-native UI or wording');
    expect(playbook).toContain('Stop/failure criteria');
  });

  it('should generate a fixed disposable project and candidate-bound kit manifest', async () => {
    const candidate = await candidateFixture();
    const outputDirectory = join(candidate.root, 'self-contained-host-qualification-kit');

    await writeHostQualificationTemplate({
      candidateDirectory: candidate.candidateDirectory,
      outputDirectory,
    });

    const expectedWorkflow = await readFile(
      join(outputDirectory, 'operator-reference', 'breakdown.expected.yaml'),
      'utf8',
    );
    expect(expectedWorkflow).toContain('schema_version: breakdown.workflow.v1');
    expect(expectedWorkflow).toContain('id: guided-host-qualification');
    expect(expectedWorkflow).toContain('  - id: inventory');
    expect(expectedWorkflow).toContain('  - id: policy');
    expect(expectedWorkflow).toContain('  - id: verify-control');
    expect(expectedWorkflow).toContain('  - id: recommendation');
    expect(expectedWorkflow).toContain('      inventory:\n        node: inventory');
    expect(expectedWorkflow).toContain('      verified-control:\n        node: verify-control');

    await expect(
      readFile(join(outputDirectory, 'qualification-project', 'breakdown.yaml')),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      readFile(join(outputDirectory, 'qualification-project', 'inputs', 'brief.md'), 'utf8'),
    ).resolves.toContain('Choose one reversible maintenance window');
    await expect(
      readFile(
        join(outputDirectory, 'qualification-project', 'inputs', 'hostile-content.md'),
        'utf8',
      ),
    ).resolves.toContain('UNTRUSTED QUALIFICATION FIXTURE');
    await expect(
      readFile(
        join(outputDirectory, 'qualification-project', 'tools', 'verify-control.mjs'),
        'utf8',
      ),
    ).resolves.toContain('control fixture verified');

    const manifest = JSON.parse(
      await readFile(join(outputDirectory, 'KIT-MANIFEST.json'), 'utf8'),
    ) as {
      schema_version: string;
      candidate: { digest: { content: string }; source: { git_commit: string } };
      files: Array<{ path: string; sha256: string }>;
    };
    expect(manifest).toMatchObject({
      schema_version: 'breakdown.guided-host-qualification-kit.v1',
      candidate: {
        digest: { content: candidateDigest },
        source: { git_commit: gitCommit },
      },
    });
    expect(manifest.files.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'GUIDED-HOST-QUALIFICATION.md',
        'guided-host-submission.template.json',
        'operator-reference/breakdown.expected.yaml',
        'qualification-project/inputs/brief.md',
        'qualification-project/inputs/hostile-content.md',
        'qualification-project/tools/read-terminal-result.mjs',
        'qualification-project/tools/run-setup-preflight.mjs',
        'qualification-project/tools/verify-control.mjs',
        'qualification-project/tools/write-breakdown-oracle.mjs',
      ]),
    );
    expect(manifest.files.every(({ sha256: digest }) => /^[0-9a-f]{64}$/.test(digest))).toBe(true);
  });

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
      review: { method: string; attestation: string };
      outcome_parity: { assessed: boolean; disclaimed_dimensions: string[] };
      retained_evidence: unknown[];
    };
    expect(submission).toMatchObject({
      schema_version: 'breakdown.guided-host-submission.v2',
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
      review: {
        method: 'independent-agent',
        attestation: '',
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
    expect(guide).toContain('Copilot CLI');
    expect(guide).toContain('distinct fresh review-agent sessions');
    expect(guide).toContain('independent review agent');
    expect(guide).toContain('local-host-evidence-capture.yml');
    expect(guide).toContain('Only exact passing rows');
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
      schema_version: 'breakdown.guided-host-evidence-index.v2',
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
      schema_version: 'breakdown.generated-host-support.v2',
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

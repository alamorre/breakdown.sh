import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { sha256 } from './filesystem.mjs';
import {
  RELEASE_CEREMONY_POLICY,
  assertNoSecretMaterial,
  authorizationConfirmation,
  createGithubReleaseAuthorization,
  createReleaseCeremonyPlan,
  decideCeremonyRecovery,
  planV1StablePublicationHandoff,
  releaseTagMessage,
  validateAutomationSigner,
  validateGithubReleaseAuthorization,
  validateReleaseRecoveryEvidence,
} from './release-ceremony.mjs';
import { V1_RELEASE_RECOVERY_POLICY } from './release-recovery-policy.mjs';

const sourceSha = 'a'.repeat(40);
const recoveryWorkflowSha = 'f'.repeat(40);
const repositoryRoot = join(import.meta.dirname, '../..');

function v1PublicationState(existingPackages: string[] = []) {
  return {
    github_release_exists: false,
    npm_packages: Object.fromEntries(
      V1_RELEASE_RECOVERY_POLICY.stablePublication.npmPackages.map((name) => [
        name,
        existingPackages.includes(name),
      ]),
    ),
  };
}

function v1StableRun(overrides: Record<string, unknown> = {}) {
  const id = typeof overrides.id === 'number' ? overrides.id : 800;
  return {
    id,
    workflow_id: V1_RELEASE_RECOVERY_POLICY.stablePublication.workflowId,
    display_title: `${V1_RELEASE_RECOVERY_POLICY.stablePublication.directTitlePrefix}${recoveryWorkflowSha}`,
    event: 'workflow_dispatch',
    status: 'in_progress',
    conclusion: null,
    head_branch: V1_RELEASE_RECOVERY_POLICY.stablePublication.workflowBranch,
    head_sha: recoveryWorkflowSha,
    path: V1_RELEASE_RECOVERY_POLICY.stablePublication.workflowPath,
    actor: { login: 'github-actions[bot]' },
    triggering_actor: { login: 'github-actions[bot]' },
    run_attempt: 1,
    html_url: `https://github.com/alamorre/breakdown.sh/actions/runs/${id}`,
    ...overrides,
  };
}

function v1WorkflowRuns(runs: unknown[]) {
  return [{ total_count: runs.length, workflow_runs: runs }];
}

function planV1Handoff(input: { publicationState: unknown; workflowRuns: unknown }) {
  return planV1StablePublicationHandoff({ ...input, workflowSha: recoveryWorkflowSha });
}

function fixture() {
  const candidate = {
    releaseVersion: '1.0.0',
    tag: 'breakdown-local-v1.0.0',
    digest: { algorithm: 'SHA-256', content: 'b'.repeat(64) },
    checksumInventory: { file: 'SHA256SUMS', sha256: 'c'.repeat(64) },
    corpusRevision: { file: 'local/contracts/MANIFEST.json', sha256: 'd'.repeat(64) },
    provenance: {
      source: {
        repository: 'https://github.com/alamorre/breakdown.sh',
        git_commit: sourceSha,
      },
    },
  };
  const qualificationRun = {
    id: 700,
    workflow_id: RELEASE_CEREMONY_POLICY.qualificationWorkflowId,
    event: 'workflow_dispatch',
    conclusion: 'success',
    run_attempt: 1,
    head_sha: sourceSha,
  };
  const artifact = (id: string, name: string, digestCharacter: string) => ({
    id: Number(id),
    name,
    expired: false,
    digest: `sha256:${digestCharacter.repeat(64)}`,
    workflow_run: { id: 700, head_sha: sourceSha },
  });
  const platformIndex = {
    schema_version: 'breakdown.platform-qualification-index.v1',
    status: 'passed',
    gate: { satisfied: true },
    candidate_digest: candidate.digest,
    source: { git_commit: sourceSha },
  };
  return {
    candidate,
    candidateArtifact: artifact('101', 'breakdown-local-candidate', 'e'),
    candidateArtifactId: '101',
    ceremonyRun: {
      repository: 'alamorre/breakdown.sh',
      ref: 'refs/heads/main',
      sha: sourceSha,
      actor: 'alamorre',
      triggering_actor: 'alamorre',
      id: 900,
      attempt: 1,
    },
    currentMainSha: sourceSha,
    executionMode: 'execute',
    npmPublicationMode: 'first-package-bootstrap',
    plannedAt: new Date('2026-08-20T03:00:00.000Z'),
    platformIndex,
    platformIndexArtifact: artifact('102', 'breakdown-platform-evidence-index', 'f'),
    platformIndexArtifactId: '102',
    platformIndexSha256: '1'.repeat(64),
    qualificationRun,
  };
}

function planFixture() {
  return createReleaseCeremonyPlan(fixture());
}

function authorizationFixture() {
  const plan = planFixture();
  const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
  const planSha256 = sha256(planBytes);
  return {
    candidate: fixture().candidate,
    plan,
    planBytes,
    authorization: createGithubReleaseAuthorization({
      approvalHistory: [
        {
          state: 'approved',
          comment: authorizationConfirmation(planSha256),
          environments: [
            {
              id: RELEASE_CEREMONY_POLICY.authorizationEnvironmentId,
              name: RELEASE_CEREMONY_POLICY.authorizationEnvironment,
            },
          ],
          user: { login: 'alamorre', id: 15023107 },
        },
      ],
      authorizedAt: new Date('2026-08-20T03:05:00.000Z'),
      plan,
      planBytes,
      runAttempt: 1,
    }),
  };
}

describe('release ceremony planning', () => {
  it('binds the current main candidate, both artifact IDs and digests, tag, and npm mode', () => {
    expect(planFixture()).toMatchObject({
      execution_mode: 'execute',
      release_version: '1.0.0',
      tag: 'breakdown-local-v1.0.0',
      source: { git_commit: sourceSha, current_main_sha: sourceSha },
      artifact_ids: { candidate: '101', platform_index: '102' },
      artifact_digests: {
        candidate: `sha256:${'e'.repeat(64)}`,
        platform_index: `sha256:${'f'.repeat(64)}`,
      },
      npm_publication_mode: 'first-package-bootstrap',
      safety: { rebuild_permitted: false, retag_permitted: false, overwrite_permitted: false },
    });
  });

  it('fails closed for a wrong source SHA', () => {
    expect(() =>
      createReleaseCeremonyPlan({ ...fixture(), currentMainSha: '9'.repeat(40) }),
    ).toThrow('Candidate source is not the exact current main commit.');
  });

  it('fails closed for wrong artifact IDs or digests', () => {
    expect(() => createReleaseCeremonyPlan({ ...fixture(), candidateArtifactId: '999' })).toThrow(
      'breakdown-local-candidate artifact metadata',
    );
    expect(() =>
      createReleaseCeremonyPlan({
        ...fixture(),
        platformIndexArtifact: { ...fixture().platformIndexArtifact, digest: 'sha256:nope' },
      }),
    ).toThrow('breakdown-platform-evidence-index artifact metadata');
  });
});

describe('release ceremony workflow', () => {
  it('downloads qualified artifacts from their originating workflow run', async () => {
    const workflow = await readFile(
      join(repositoryRoot, '.github', 'workflows', 'local-release-ceremony.yml'),
      'utf8',
    );

    expect(workflow).toContain("printf 'QUALIFICATION_RUN_ID=%s\\n'");
    expect(workflow.match(/run-id: \$\{\{ env\.QUALIFICATION_RUN_ID \}\}/g)).toHaveLength(2);
  });

  it('uses only the annotated-tag verifier and retains failure diagnostics', async () => {
    const workflowPaths = [
      '.github/workflows/local-release-ceremony.yml',
      '.github/workflows/local-stable-publication.yml',
      '.github/workflows/local-v1-release-recovery.yml',
    ];
    for (const path of workflowPaths) {
      const workflow = await readFile(join(repositoryRoot, path), 'utf8');
      expect(workflow).toContain('gitsign" verify-tag \\');
      expect(workflow).not.toMatch(/gitsign" verify \\/);
      expect(workflow).toContain(
        "--certificate-identity 'https://github.com/alamorre/breakdown.sh/.github/workflows/local-release-ceremony.yml@refs/heads/main'",
      );
      expect(workflow).toContain(
        "--certificate-oidc-issuer 'https://token.actions.githubusercontent.com'",
      );
      expect(workflow).toContain('gitsign-verification.log');
      expect(workflow).toContain('if: ${{ always() }}');
    }
  });
});

describe('GitHub-authenticated human authorization', () => {
  it('accepts one exact environment review and validates it against the candidate', () => {
    const { authorization, candidate } = authorizationFixture();
    expect(() =>
      validateGithubReleaseAuthorization(authorization, candidate, 'first-package-bootstrap'),
    ).not.toThrow();
  });

  it('rejects missing or invalid authorization', () => {
    const plan = planFixture();
    const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
    expect(() =>
      createGithubReleaseAuthorization({
        approvalHistory: [],
        plan,
        planBytes,
        runAttempt: 1,
      }),
    ).toThrow('Exactly one authenticated release approval is required.');
    expect(() =>
      createGithubReleaseAuthorization({
        approvalHistory: [
          {
            state: 'approved',
            comment: 'approve something else',
            environments: [
              {
                id: RELEASE_CEREMONY_POLICY.authorizationEnvironmentId,
                name: RELEASE_CEREMONY_POLICY.authorizationEnvironment,
              },
            ],
            user: { login: 'alamorre', id: 15023107 },
          },
        ],
        plan,
        planBytes,
        runAttempt: 1,
      }),
    ).toThrow('does not explicitly authorize the exact release plan');
  });
});

describe('automation signer and recovery', () => {
  it('rejects any signer identity other than the exact keyless workflow identity', () => {
    expect(() =>
      validateAutomationSigner({
        method: 'sigstore-keyless-gitsign',
        gitsign_version: '0.17.1',
        binary_sha256: RELEASE_CEREMONY_POLICY.signer.binarySha256,
        certificate_identity: 'https://github.com/attacker/workflow.yml@refs/heads/main',
        certificate_oidc_issuer: RELEASE_CEREMONY_POLICY.signer.oidcIssuer,
        transparency_log: RELEASE_CEREMONY_POLICY.signer.transparencyLog,
        signature_verified: true,
        certificate_claims_verified: true,
        transparency_log_verified: true,
      }),
    ).toThrow('exact keyless automation signing identity');
  });

  it('fails on duplicate runs and resumes only an exact partial failure', () => {
    const plan = planFixture();
    const existingTag = {
      tag: plan.tag,
      source_sha: plan.source.git_commit,
      ceremony_run_id: plan.ceremony.run_id,
    };
    expect(decideCeremonyRecovery({ downstreamRuns: [], existingTag: null, plan })).toBe(
      'create-tag',
    );
    expect(decideCeremonyRecovery({ downstreamRuns: [], existingTag, plan })).toBe(
      'resume-after-tag',
    );
    expect(
      decideCeremonyRecovery({
        downstreamRuns: [{ ceremony_run_id: '900', tag: plan.tag, status: 'failure' }],
        existingTag,
        plan,
      }),
    ).toBe('new-reviewed-successor-required');
    expect(() =>
      decideCeremonyRecovery({
        downstreamRuns: [
          { ceremony_run_id: '900', tag: plan.tag, status: 'failure' },
          { ceremony_run_id: '900', tag: plan.tag, status: 'success' },
        ],
        existingTag,
        plan,
      }),
    ).toThrow('Duplicate downstream ceremony runs');
    expect(() =>
      decideCeremonyRecovery({
        downstreamRuns: [{ ceremony_run_id: '900', tag: plan.tag, status: 'success' }],
        existingTag: null,
        plan,
      }),
    ).toThrow('Downstream work exists before the protected tag');
    expect(() =>
      decideCeremonyRecovery({
        downstreamRuns: [],
        existingTag: { ...existingTag, ceremony_run_id: 'other' },
        plan,
      }),
    ).toThrow('cannot be resumed');
    expect(() =>
      decideCeremonyRecovery({
        downstreamRuns: [],
        existingTag: { ...existingTag, tag: 'breakdown-local-v1.0.1' },
        plan,
      }),
    ).toThrow('cannot be resumed');
  });

  it('rejects attempted secret leakage in retained evidence', () => {
    expect(() => assertNoSecretMaterial({ nested: { npm_token: 'do-not-retain' } })).toThrow(
      'forbidden secret-shaped field',
    );
  });

  it('validates the retained plan, authorization, tag target, complete message, and tag verifier', () => {
    const input = fixture();
    const plan = createReleaseCeremonyPlan(input);
    const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
    const authorization = createGithubReleaseAuthorization({
      approvalHistory: [
        {
          state: 'approved',
          comment: authorizationConfirmation(sha256(planBytes)),
          environments: [
            {
              id: RELEASE_CEREMONY_POLICY.authorizationEnvironmentId,
              name: RELEASE_CEREMONY_POLICY.authorizationEnvironment,
            },
          ],
          user: { login: 'alamorre', id: 15023107 },
        },
      ],
      authorizedAt: new Date('2026-08-20T03:05:00.000Z'),
      plan,
      planBytes,
      runAttempt: 1,
    });
    const authorizationBytes = Buffer.from(`${JSON.stringify(authorization, null, 2)}\n`);
    const gitsignVerificationLog = Buffer.from(
      'Validated Git signature: true\nValidated Rekor entry: true\nValidated Certificate claims: true\n',
    );
    const artifactMetadata = (id: string, name: string, digest: string, runId: number) => ({
      id: Number(id),
      name,
      expired: false,
      digest,
      workflow_run: { id: runId, head_sha: sourceSha },
    });
    const policy = {
      authorizationArtifact: {
        id: '104',
        name: 'breakdown-release-authorization-900',
        digest: `sha256:${'4'.repeat(64)}`,
      },
      authorizationSha256: sha256(authorizationBytes),
      candidateArtifact: {
        id: input.candidateArtifactId,
        name: input.candidateArtifact.name,
        digest: input.candidateArtifact.digest,
      },
      candidateDigest: input.candidate.digest.content,
      candidateChecksumInventorySha256: input.candidate.checksumInventory.sha256,
      ceremonyRunId: '900',
      ceremonyWorkflowId: 338665094,
      confirmation: 'test confirmation',
      planArtifact: {
        id: '103',
        name: 'breakdown-release-ceremony-plan-900',
        digest: `sha256:${'3'.repeat(64)}`,
      },
      planSha256: sha256(planBytes),
      platformArtifact: {
        id: input.platformIndexArtifactId,
        name: input.platformIndexArtifact.name,
        digest: input.platformIndexArtifact.digest,
      },
      qualificationRunId: '700',
      sourceSha,
      tag: input.candidate.tag,
      tagObjectSha: '9'.repeat(40),
    };
    const signer = {
      method: 'sigstore-keyless-gitsign',
      tag_verifier: 'verify-tag',
      gitsign_version: '0.17.1',
      binary_sha256: RELEASE_CEREMONY_POLICY.signer.binarySha256,
      certificate_identity: RELEASE_CEREMONY_POLICY.signer.certificateIdentity,
      certificate_oidc_issuer: RELEASE_CEREMONY_POLICY.signer.oidcIssuer,
      transparency_log: RELEASE_CEREMONY_POLICY.signer.transparencyLog,
      signature_verified: true,
      certificate_claims_verified: true,
      transparency_log_verified: true,
      verification_log_sha256: sha256(gitsignVerificationLog),
    };
    const expectedMessage = releaseTagMessage({
      authorizationSha256: policy.authorizationSha256,
      plan,
    });
    const evidence = {
      authorization,
      authorizationArtifact: artifactMetadata(
        policy.authorizationArtifact.id,
        policy.authorizationArtifact.name,
        policy.authorizationArtifact.digest,
        900,
      ),
      authorizationBytes,
      candidate: input.candidate,
      candidateArtifact: input.candidateArtifact,
      ceremonyRun: {
        id: 900,
        workflow_id: policy.ceremonyWorkflowId,
        repository: { full_name: 'alamorre/breakdown.sh' },
        path: '.github/workflows/local-release-ceremony.yml',
        event: 'workflow_dispatch',
        status: 'completed',
        conclusion: 'failure',
        run_attempt: 1,
        head_branch: 'main',
        head_sha: sourceSha,
        actor: { login: 'alamorre' },
        triggering_actor: { login: 'alamorre' },
      },
      gitsignVerificationLog,
      plan,
      planArtifact: artifactMetadata(
        policy.planArtifact.id,
        policy.planArtifact.name,
        policy.planArtifact.digest,
        900,
      ),
      planBytes,
      platformArtifact: input.platformIndexArtifact,
      platformIndex: input.platformIndex,
      platformIndexSha256: input.platformIndexSha256,
      qualificationRun: input.qualificationRun,
      signer,
      tagObject: {
        sha: policy.tagObjectSha,
        tag: policy.tag,
        object: { type: 'commit', sha: sourceSha },
        message: `${expectedMessage}\n-----BEGIN SIGNED MESSAGE-----\nsignature\n-----END SIGNED MESSAGE-----\n`,
      },
      tagRef: {
        ref: `refs/tags/${policy.tag}`,
        object: { type: 'tag', sha: policy.tagObjectSha },
      },
    };

    expect(validateReleaseRecoveryEvidence(evidence, policy)).toMatchObject({
      ceremony_run_id: '900',
      tag: policy.tag,
      verification: { status: 'passed', tag_message: true, tag_target: true },
    });
    expect(() =>
      validateReleaseRecoveryEvidence(
        { ...evidence, signer: { ...signer, tag_verifier: 'verify' } },
        policy,
      ),
    ).toThrow('Gitsign tag verifier');
    expect(() =>
      validateReleaseRecoveryEvidence(
        {
          ...evidence,
          signer: { ...signer, certificate_oidc_issuer: 'https://issuer.example' },
        },
        policy,
      ),
    ).toThrow('exact keyless automation signing identity');
    expect(() =>
      validateReleaseRecoveryEvidence(
        {
          ...evidence,
          signer: { ...signer, transparency_log_verified: false },
        },
        policy,
      ),
    ).toThrow('exact keyless automation signing identity');
    expect(() =>
      validateReleaseRecoveryEvidence(
        {
          ...evidence,
          tagObject: { ...evidence.tagObject, object: { type: 'commit', sha: '0'.repeat(40) } },
        },
        policy,
      ),
    ).toThrow('tag object or target');
    expect(() =>
      validateReleaseRecoveryEvidence(
        {
          ...evidence,
          tagObject: { ...evidence.tagObject, message: evidence.tagObject.message + 'extra' },
        },
        policy,
      ),
    ).toThrow('complete exact ceremony message');
  });
});

describe('v1 stable-publication recovery handoff', () => {
  it('plans one exact reviewed-main dispatch targeting the retained tag', () => {
    expect(
      planV1Handoff({
        publicationState: v1PublicationState(),
        workflowRuns: v1WorkflowRuns([]),
      }),
    ).toEqual({
      schema_version: 'breakdown.v1-stable-publication-handoff.v1',
      action: 'dispatch',
      dispatch: {
        ref: 'main',
        inputs: {
          authorization_artifact_id: '9415223409',
          candidate_artifact_id: '9413780200',
          ceremony_run_id: '32391936576',
          host_support_artifact_id: '9420331832',
          npm_bootstrap_artifact_id: '',
          npm_bootstrap_confirmation:
            'CREATE EXACT @breakdown-sh/core @breakdown-sh/cli @breakdown-sh/mcp 1.0.0',
          npm_publication_mode: 'first-package-bootstrap',
          npm_trusted_publishing_artifact_id: '',
          platform_index_artifact_id: '9413912347',
          recovery_tag: 'breakdown-local-v1.0.0',
          recovery_workflow_sha: recoveryWorkflowSha,
        },
      },
    });
  });

  it('idempotently monitors one exact active direct or earlier deployment run', () => {
    const direct = v1StableRun();
    expect(
      planV1Handoff({
        publicationState: v1PublicationState(),
        workflowRuns: v1WorkflowRuns([direct]),
      }),
    ).toMatchObject({ action: 'monitor', run: { event: 'workflow_dispatch', id: '800' } });

    const deployment = v1StableRun({
      display_title: V1_RELEASE_RECOVERY_POLICY.stablePublication.legacyTitle,
      event: 'deployment',
      head_branch: V1_RELEASE_RECOVERY_POLICY.tag,
      head_sha: V1_RELEASE_RECOVERY_POLICY.sourceSha,
      actor: { login: 'alamorre' },
      triggering_actor: { login: 'alamorre' },
    });
    expect(
      planV1Handoff({
        publicationState: v1PublicationState(),
        workflowRuns: v1WorkflowRuns([deployment]),
      }),
    ).toMatchObject({ action: 'monitor', run: { event: 'deployment', id: '800' } });

    expect(() =>
      planV1Handoff({
        publicationState: v1PublicationState(),
        workflowRuns: v1WorkflowRuns([
          { ...deployment, triggering_actor: { login: 'github-actions[bot]' }, run_attempt: 2 },
        ]),
      }),
    ).toThrow('mismatched inputs, ref, commit, event, actor, or identity');
  });

  it('refuses duplicate correlated runs', () => {
    expect(() =>
      planV1Handoff({
        publicationState: v1PublicationState(),
        workflowRuns: v1WorkflowRuns([v1StableRun(), v1StableRun({ id: 801 })]),
      }),
    ).toThrow('refuses a duplicate');
  });

  it.each([
    ['inputs', { display_title: 'Breakdown Local stable publication for ceremony 999' }],
    ['ref', { head_branch: V1_RELEASE_RECOVERY_POLICY.tag }],
    ['commit', { head_sha: '0'.repeat(40) }],
    ['actor', { actor: { login: 'alamorre' } }],
    ['triggering actor', { triggering_actor: { login: 'untrusted' } }],
    ['event', { event: 'push' }],
  ])('refuses a correlated run with mismatched %s', (_label, overrides) => {
    expect(() =>
      planV1Handoff({
        publicationState: v1PublicationState(),
        workflowRuns: v1WorkflowRuns([v1StableRun(overrides)]),
      }),
    ).toThrow('mismatched inputs, ref, commit, event, actor, or identity');
  });

  it('refuses unexpected publication state before dispatch and stops on partial state', () => {
    expect(() =>
      planV1Handoff({
        publicationState: v1PublicationState(['@breakdown-sh/core']),
        workflowRuns: v1WorkflowRuns([]),
      }),
    ).toThrow('npm package already exists');
    expect(() =>
      planV1Handoff({
        publicationState: { ...v1PublicationState(), github_release_exists: true },
        workflowRuns: v1WorkflowRuns([]),
      }),
    ).toThrow('GitHub Release already exists');
    expect(
      planV1Handoff({
        publicationState: v1PublicationState(['@breakdown-sh/core']),
        workflowRuns: v1WorkflowRuns([v1StableRun({ status: 'completed', conclusion: 'failure' })]),
      }),
    ).toMatchObject({ action: 'stop', result: 'partial_publication_stop' });
    expect(
      planV1Handoff({
        publicationState: v1PublicationState(),
        workflowRuns: v1WorkflowRuns([v1StableRun({ status: 'completed', conclusion: 'failure' })]),
      }),
    ).toMatchObject({
      action: 'successor_required',
      result: 'retryable_before_side_effects',
    });
  });

  it('requires all exact npm package records after a successful bootstrap run', () => {
    const success = v1StableRun({ status: 'completed', conclusion: 'success' });
    expect(() =>
      planV1Handoff({
        publicationState: v1PublicationState(['@breakdown-sh/core']),
        workflowRuns: v1WorkflowRuns([success]),
      }),
    ).toThrow('missing an expected public npm package');
    expect(
      planV1Handoff({
        publicationState: v1PublicationState([
          '@breakdown-sh/core',
          '@breakdown-sh/cli',
          '@breakdown-sh/mcp',
        ]),
        workflowRuns: v1WorkflowRuns([success]),
      }),
    ).toMatchObject({ action: 'complete', result: 'complete', run: { conclusion: 'success' } });
  });
});

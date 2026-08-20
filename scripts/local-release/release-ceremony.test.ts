import { describe, expect, it } from 'vitest';

import { sha256 } from './filesystem.mjs';
import {
  RELEASE_CEREMONY_POLICY,
  assertNoSecretMaterial,
  authorizationConfirmation,
  createGithubReleaseAuthorization,
  createReleaseCeremonyPlan,
  decideCeremonyRecovery,
  validateAutomationSigner,
  validateGithubReleaseAuthorization,
} from './release-ceremony.mjs';

const sourceSha = 'a'.repeat(40);

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
    ).toBe('rerun-failed-downstream');
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
});

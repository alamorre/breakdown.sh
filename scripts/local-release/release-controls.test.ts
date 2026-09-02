import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  RELEASE_CONTROL_POLICY,
  inspectGithubReleaseControls,
  validateGithubReleaseControls,
  validateWorkflowIdentityEvidence,
  verifyHumanReleaseApprovalSignature,
} from './release-controls.mjs';
import { V1_RELEASE_RECOVERY_POLICY } from './release-recovery-policy.mjs';

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

function releaseControlFixture() {
  return {
    repository: {
      full_name: RELEASE_CONTROL_POLICY.repository,
      visibility: 'public',
      html_url: RELEASE_CONTROL_POLICY.repositoryUrl,
    },
    environment: {
      id: RELEASE_CONTROL_POLICY.environmentId,
      name: RELEASE_CONTROL_POLICY.environment,
      can_admins_bypass: false,
      protection_rules: [{ id: 1, type: 'branch_policy' }],
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    },
    deploymentPolicies: {
      total_count: 1,
      branch_policies: [{ id: 2, name: RELEASE_CONTROL_POLICY.deploymentTagPattern, type: 'tag' }],
    },
    authorizationEnvironment: {
      id: RELEASE_CONTROL_POLICY.authorizationEnvironmentId,
      name: RELEASE_CONTROL_POLICY.authorizationEnvironment,
      can_admins_bypass: false,
      protection_rules: [
        {
          id: 3,
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [
            {
              type: 'User',
              reviewer: {
                id: RELEASE_CONTROL_POLICY.authorizationReviewerId,
                login: RELEASE_CONTROL_POLICY.maintainer,
              },
            },
          ],
        },
        { id: 4, type: 'branch_policy' },
      ],
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    },
    authorizationDeploymentPolicies: {
      total_count: 1,
      branch_policies: [
        { id: 5, name: RELEASE_CONTROL_POLICY.authorizationBranch, type: 'branch' },
      ],
    },
    immutableReleases: { enabled: true, enforced_by_owner: false },
    ruleset: {
      id: RELEASE_CONTROL_POLICY.rulesetId,
      name: RELEASE_CONTROL_POLICY.rulesetName,
      target: 'tag',
      enforcement: 'active',
      conditions: {
        ref_name: {
          include: [RELEASE_CONTROL_POLICY.deploymentTagRefPattern],
          exclude: [],
        },
      },
      rules: [{ type: 'update' }, { type: 'deletion' }],
      bypass_actors: [],
      current_user_can_bypass: 'never',
    },
    collaborators: [{ login: RELEASE_CONTROL_POLICY.maintainer, role_name: 'admin' }],
    stableTags: [] as { name: string }[],
    releases: [] as { tag_name: string }[],
    phase: 'pre-tag',
    tag: 'breakdown-local-v1.0.0' as string | undefined,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GitHub stable release controls', () => {
  it('accepts only the exact sole-maintainer, no-bypass pre-tag boundary', () => {
    expect(() => validateGithubReleaseControls(releaseControlFixture())).not.toThrow();
  });

  it('rejects administrator bypass', () => {
    const fixture = releaseControlFixture();
    const invalid = {
      ...fixture,
      environment: {
        ...fixture.environment,
        can_admins_bypass: true,
      },
    };

    expect(() => validateGithubReleaseControls(invalid)).toThrow(
      'Stable publication environment still permits administrator bypass.',
    );
  });

  it('rejects a nominal reviewer rule in the permanent sole-maintainer model', () => {
    const fixture = releaseControlFixture();
    const invalid = {
      ...fixture,
      environment: {
        ...fixture.environment,
        protection_rules: [
          { id: 1, type: 'branch_policy' },
          { id: 2, type: 'required_reviewers' },
        ],
      },
    };

    expect(() => validateGithubReleaseControls(invalid)).toThrow(
      'Stable publication environment does not match the exact tag or one-time v1 recovery boundary.',
    );
  });

  it('accepts only the reviewed-main boundary for the one-time v1 recovery', () => {
    const fixture = releaseControlFixture();
    const recovery = {
      ...fixture,
      executionMode: 'v1-recovery',
      phase: 'publication',
      stableTags: [{ name: V1_RELEASE_RECOVERY_POLICY.tag }],
      deploymentPolicies: {
        total_count: 1,
        branch_policies: [
          { id: 7, name: RELEASE_CONTROL_POLICY.recoveryWorkflowBranch, type: 'branch' },
        ],
      },
    };

    expect(() => validateGithubReleaseControls(recovery)).not.toThrow();
    expect(() =>
      validateGithubReleaseControls({
        ...recovery,
        deploymentPolicies: {
          total_count: 1,
          branch_policies: [{ id: 8, name: '*', type: 'branch' }],
        },
      }),
    ).toThrow('one-time v1 recovery boundary');
  });

  it('accepts the bounded recovery state with both tag and main policies during v1 recovery publication', () => {
    const fixture = releaseControlFixture();
    const boundedRecovery = {
      ...fixture,
      executionMode: 'v1-recovery',
      phase: 'publication',
      stableTags: [{ name: V1_RELEASE_RECOVERY_POLICY.tag }],
      deploymentPolicies: {
        total_count: 2,
        branch_policies: [
          { id: 6, name: RELEASE_CONTROL_POLICY.deploymentTagPattern, type: 'tag' },
          { id: 7, name: RELEASE_CONTROL_POLICY.recoveryWorkflowBranch, type: 'branch' },
        ],
      },
    };

    expect(() => validateGithubReleaseControls(boundedRecovery)).not.toThrow();
  });

  it('rejects a broader tag pattern or any ruleset bypass', () => {
    const fixture = releaseControlFixture();
    const invalid = {
      ...fixture,
      ruleset: {
        ...fixture.ruleset,
        conditions: { ref_name: { include: ['~ALL'], exclude: [] } },
        bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
      },
    };

    expect(() => validateGithubReleaseControls(invalid)).toThrow(
      'Stable release tag ruleset differs from the exact no-bypass policy.',
    );
  });

  it('writes a sanitized snapshot from read-only GitHub API responses', async () => {
    const fixture = releaseControlFixture();
    const root = await mkdtemp(join(tmpdir(), 'breakdown-release-controls-'));
    temporaryDirectories.push(root);
    const outputPath = join(root, 'controls.json');
    const responses = new Map<string, unknown>([
      [`repos/${RELEASE_CONTROL_POLICY.repository}`, fixture.repository],
      [
        `repos/${RELEASE_CONTROL_POLICY.repository}/environments/${RELEASE_CONTROL_POLICY.environment}`,
        fixture.environment,
      ],
      [
        `repos/${RELEASE_CONTROL_POLICY.repository}/environments/${RELEASE_CONTROL_POLICY.environment}/deployment-branch-policies`,
        fixture.deploymentPolicies,
      ],
      [
        `repos/${RELEASE_CONTROL_POLICY.repository}/environments/${RELEASE_CONTROL_POLICY.authorizationEnvironment}`,
        fixture.authorizationEnvironment,
      ],
      [
        `repos/${RELEASE_CONTROL_POLICY.repository}/environments/${RELEASE_CONTROL_POLICY.authorizationEnvironment}/deployment-branch-policies`,
        fixture.authorizationDeploymentPolicies,
      ],
      [`repos/${RELEASE_CONTROL_POLICY.repository}/immutable-releases`, fixture.immutableReleases],
      [
        `repos/${RELEASE_CONTROL_POLICY.repository}/rulesets/${RELEASE_CONTROL_POLICY.rulesetId}`,
        fixture.ruleset,
      ],
      [
        `repos/${RELEASE_CONTROL_POLICY.repository}/collaborators?affiliation=direct&per_page=100`,
        fixture.collaborators,
      ],
      [`repos/${RELEASE_CONTROL_POLICY.repository}/git/matching-refs/tags/breakdown-local-v`, []],
      [`repos/${RELEASE_CONTROL_POLICY.repository}/releases?per_page=100`, []],
    ]);
    const commandRunner = async (_command: string, args: string[]) => {
      const endpoint = args.at(-1)!;
      if (!responses.has(endpoint)) throw new Error(`Unexpected endpoint: ${endpoint}`);
      return { stdout: JSON.stringify(responses.get(endpoint)), stderr: '' };
    };

    await expect(
      inspectGithubReleaseControls({
        capturedAt: new Date('2026-08-19T20:30:00.000Z'),
        commandRunner,
        outputPath,
        phase: 'pre-tag',
        tag: 'breakdown-local-v1.0.0',
      }),
    ).resolves.toMatchObject({
      schema_version: 'breakdown.github-release-controls.v1',
      execution_mode: 'tag',
      phase: 'pre-tag',
      permanent_operating_model: {
        sole_maintainer: 'alamorre',
        independent_review: false,
        compensating_controls_are_independent_review: false,
      },
      verification: { status: 'passed' },
    });
    expect(JSON.parse(await readFile(outputPath, 'utf8'))).not.toHaveProperty('token');
  });
});

describe('sole-maintainer approval signature', () => {
  it('verifies the exact approval against a GitHub-recognized SSH signing key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'breakdown-approval-signature-test-'));
    temporaryDirectories.push(root);
    const keyPath = join(root, 'signing-key');
    const approvalPath = join(root, 'breakdown-human-release-approval.json');
    const outputPath = join(root, 'verification.json');
    await mkdir(join(root, 'unused'));
    await execFileAsync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath]);
    await writeFile(
      approvalPath,
      `${JSON.stringify(
        {
          schema_version: 'breakdown.human-release-approval.v1',
          release_version: '1.0.0',
          candidate_digest: { algorithm: 'SHA-256', content: 'a'.repeat(64) },
          source: {
            repository: RELEASE_CONTROL_POLICY.repositoryUrl,
            git_commit: 'b'.repeat(40),
          },
          tag: 'breakdown-local-v1.0.0',
          approver: {
            name: 'Adam La Morre',
            email: 'alamorre@gmail.com',
            github_login: RELEASE_CONTROL_POLICY.maintainer,
          },
          approved_at: '2026-08-19T20:00:00.000Z',
          attestations: { all_release_gates_reviewed: true },
        },
        null,
        2,
      )}\n`,
    );
    await execFileAsync('ssh-keygen', [
      '-Y',
      'sign',
      '-f',
      keyPath,
      '-n',
      RELEASE_CONTROL_POLICY.approvalSignatureNamespace,
      approvalPath,
    ]);
    const publicKey = (await readFile(`${keyPath}.pub`, 'utf8')).trim();

    await expect(
      verifyHumanReleaseApprovalSignature({
        approvalPath,
        approvedAt: new Date('2026-08-19T20:05:00.000Z'),
        githubSigningKeys: [{ id: 123, key: publicKey }],
        outputPath,
        signaturePath: `${approvalPath}.sig`,
      }),
    ).resolves.toMatchObject({
      namespace: RELEASE_CONTROL_POLICY.approvalSignatureNamespace,
      approver: {
        github_login: RELEASE_CONTROL_POLICY.maintainer,
        github_signing_key_ids: [123],
      },
      verification: {
        status: 'passed',
        github_recognized_signing_key: true,
      },
    });
  });
});

describe('stable workflow identity evidence', () => {
  it('accepts the reviewed main workflow targeting the exact recovery tag', () => {
    const workflowRef =
      'alamorre/breakdown.sh/.github/workflows/local-stable-publication.yml@refs/heads/main';
    const candidate = {
      tag: V1_RELEASE_RECOVERY_POLICY.tag,
      provenance: { source: { git_commit: V1_RELEASE_RECOVERY_POLICY.sourceSha } },
    };
    const evidence = {
      schema_version: 'breakdown.stable-workflow-identity.v1',
      repository: RELEASE_CONTROL_POLICY.repository,
      ref: `refs/tags/${candidate.tag}`,
      ref_name: candidate.tag,
      source_commit: candidate.provenance.source.git_commit,
      actor: 'github-actions[bot]',
      triggering_actor: 'github-actions[bot]',
      environment: RELEASE_CONTROL_POLICY.environment,
      runner_environment: 'github-hosted',
      oidc: {
        subject: `repo:${RELEASE_CONTROL_POLICY.repository}:environment:${RELEASE_CONTROL_POLICY.environment}`,
        audience: RELEASE_CONTROL_POLICY.oidcAudience,
        job_workflow_ref: workflowRef,
        ref: 'refs/heads/main',
        sha: 'f'.repeat(40),
      },
      execution: {
        mode: 'v1-recovery',
        ref: 'refs/heads/main',
        source_commit: 'f'.repeat(40),
        workflow_ref: workflowRef,
        workflow_sha: 'f'.repeat(40),
      },
      artifact_ids: { candidate: '1', platform_index: '2', host_support: '3' },
      release_controls: {
        ruleset_id: RELEASE_CONTROL_POLICY.rulesetId,
        snapshot_sha256: 'd'.repeat(64),
      },
      authorization_verification_sha256: 'e'.repeat(64),
    };

    expect(() =>
      validateWorkflowIdentityEvidence(evidence, {
        authorizationVerificationSha256: 'e'.repeat(64),
        candidate,
        candidateArtifactId: '1',
        controlsSha256: 'd'.repeat(64),
        platformIndexArtifactId: '2',
      }),
    ).not.toThrow();
    expect(() =>
      validateWorkflowIdentityEvidence(
        { ...evidence, triggering_actor: RELEASE_CONTROL_POLICY.maintainer },
        {
          authorizationVerificationSha256: 'e'.repeat(64),
          candidate,
          candidateArtifactId: '1',
          controlsSha256: 'd'.repeat(64),
          platformIndexArtifactId: '2',
        },
      ),
    ).toThrow('Stable workflow identity');
  });

  it('rejects a self-hosted runner even when every artifact ID matches', () => {
    const candidate = {
      tag: 'breakdown-local-v1.0.0',
      provenance: { source: { git_commit: 'c'.repeat(40) } },
    };
    const evidence = {
      schema_version: 'breakdown.stable-workflow-identity.v1',
      repository: RELEASE_CONTROL_POLICY.repository,
      ref: `refs/tags/${candidate.tag}`,
      ref_name: candidate.tag,
      source_commit: candidate.provenance.source.git_commit,
      actor: 'github-actions[bot]',
      triggering_actor: 'github-actions[bot]',
      environment: RELEASE_CONTROL_POLICY.environment,
      runner_environment: 'self-hosted',
      oidc: {
        subject: `repo:${RELEASE_CONTROL_POLICY.repository}:environment:${RELEASE_CONTROL_POLICY.environment}`,
        audience: RELEASE_CONTROL_POLICY.oidcAudience,
      },
      artifact_ids: { candidate: '1', platform_index: '2', host_support: '3' },
      release_controls: {
        ruleset_id: RELEASE_CONTROL_POLICY.rulesetId,
        snapshot_sha256: 'd'.repeat(64),
      },
      authorization_verification_sha256: 'e'.repeat(64),
    };

    expect(() =>
      validateWorkflowIdentityEvidence(evidence, {
        authorizationVerificationSha256: 'e'.repeat(64),
        candidate,
        candidateArtifactId: '1',
        controlsSha256: 'd'.repeat(64),
        platformIndexArtifactId: '2',
      }),
    ).toThrow(
      'Stable workflow identity does not prove the exact runner, OIDC, actor, and artifact boundary.',
    );
  });
});

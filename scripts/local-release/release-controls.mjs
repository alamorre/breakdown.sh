import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { sha256 } from './filesystem.mjs';
import { V1_RELEASE_RECOVERY_POLICY } from './release-recovery-policy.mjs';

const execFileAsync = promisify(execFile);

export const RELEASE_CONTROL_POLICY = Object.freeze({
  repository: 'alamorre/breakdown.sh',
  repositoryUrl: 'https://github.com/alamorre/breakdown.sh',
  maintainer: 'alamorre',
  environment: 'breakdown-local-stable',
  environmentId: 18989155368,
  authorizationEnvironment: 'breakdown-local-authorization',
  authorizationEnvironmentId: 20224502339,
  authorizationReviewerId: 15023107,
  authorizationBranch: 'main',
  recoveryWorkflowBranch: 'main',
  deploymentTagPattern: 'breakdown-local-v*',
  deploymentTagRefPattern: 'refs/tags/breakdown-local-v*',
  rulesetId: 20015652,
  rulesetName: 'Protect Breakdown Local stable release tags',
  approvalSignatureNamespace: 'breakdown-local-release',
  oidcAudience: 'npm:registry.npmjs.org',
});

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactString(value) {
  return typeof value === 'string' && value.trim() === value && value.length > 0;
}

function exactSha1(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function exactSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function stableTag(value) {
  return typeof value === 'string' && /^breakdown-local-v\d+\.\d+\.\d+$/.test(value);
}

async function defaultCommandRunner(command, args, options = {}) {
  return execFileAsync(command, args, {
    ...options,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function ghJson(commandRunner, endpoint, label) {
  const { stdout } = await commandRunner(
    'gh',
    [
      'api',
      '--header',
      'Accept: application/vnd.github+json',
      '--header',
      'X-GitHub-Api-Version: 2026-03-10',
      endpoint,
    ],
    {},
  );
  return parseJson(stdout, label);
}

function sanitizeEnvironment(environment) {
  return {
    id: environment.id,
    name: environment.name,
    can_admins_bypass: environment.can_admins_bypass,
    protection_rules: (environment.protection_rules ?? []).map((rule) => ({
      id: rule.id,
      type: rule.type,
    })),
    deployment_branch_policy: environment.deployment_branch_policy,
  };
}

function exactDeploymentPolicies(deploymentPolicies, expected) {
  const policies = deploymentPolicies?.branch_policies ?? [];
  return (
    deploymentPolicies?.total_count === expected.length &&
    policies.length === expected.length &&
    sameJson(
      policies
        .map((policy) => ({ name: policy.name, type: policy.type }))
        .sort((left, right) =>
          `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`),
        ),
      [...expected].sort((left, right) =>
        `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`),
      ),
    )
  );
}

function exactStableEnvironmentBoundary({
  deploymentPolicies,
  environment,
  executionMode,
  phase,
  tag,
}) {
  const rules = environment?.protection_rules ?? [];
  const common = sameJson(environment?.deployment_branch_policy, {
    protected_branches: false,
    custom_branch_policies: true,
  });
  const tagPolicyBoundary =
    sameJson(
      rules.map((rule) => rule.type),
      ['branch_policy'],
    ) &&
    exactDeploymentPolicies(deploymentPolicies, [
      { name: RELEASE_CONTROL_POLICY.deploymentTagPattern, type: 'tag' },
    ]);
  const tagBoundary = executionMode === 'tag' && tagPolicyBoundary;
  const mainPolicyBoundary =
    sameJson(
      rules.map((rule) => rule.type),
      ['branch_policy'],
    ) &&
    exactDeploymentPolicies(deploymentPolicies, [
      { name: RELEASE_CONTROL_POLICY.recoveryWorkflowBranch, type: 'branch' },
    ]);
  const boundedRecoveryState =
    sameJson(
      rules.map((rule) => rule.type),
      ['branch_policy'],
    ) &&
    exactDeploymentPolicies(deploymentPolicies, [
      { name: RELEASE_CONTROL_POLICY.deploymentTagPattern, type: 'tag' },
      { name: RELEASE_CONTROL_POLICY.recoveryWorkflowBranch, type: 'branch' },
    ]);
  const v1RecoveryBoundary =
    executionMode === 'v1-recovery' &&
    phase === 'publication' &&
    tag === V1_RELEASE_RECOVERY_POLICY.tag &&
    (tagPolicyBoundary || mainPolicyBoundary || boundedRecoveryState);
  return common && (tagBoundary || v1RecoveryBoundary);
}

function sanitizeRuleset(ruleset) {
  return {
    id: ruleset.id,
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    conditions: ruleset.conditions,
    rules: ruleset.rules,
    bypass_actors: ruleset.bypass_actors,
    current_user_can_bypass: ruleset.current_user_can_bypass,
  };
}

export function validateGithubReleaseControls({
  authorizationDeploymentPolicies,
  authorizationEnvironment,
  collaborators,
  deploymentPolicies,
  environment,
  executionMode = 'tag',
  immutableReleases,
  phase,
  releases,
  repository,
  ruleset,
  stableTags,
  tag,
}) {
  invariant(repository?.full_name === RELEASE_CONTROL_POLICY.repository, 'Wrong repository.');
  invariant(repository?.visibility === 'public', 'Stable publication repository is not public.');
  invariant(
    environment?.id === RELEASE_CONTROL_POLICY.environmentId &&
      environment?.name === RELEASE_CONTROL_POLICY.environment,
    'Stable publication environment identity differs from policy.',
  );
  invariant(
    environment.can_admins_bypass === false,
    'Stable publication environment still permits administrator bypass.',
  );
  invariant(
    exactStableEnvironmentBoundary({ deploymentPolicies, environment, executionMode, phase, tag }),
    'Stable publication environment does not match the exact tag or one-time v1 recovery boundary.',
  );
  invariant(
    authorizationEnvironment?.id === RELEASE_CONTROL_POLICY.authorizationEnvironmentId &&
      authorizationEnvironment?.name === RELEASE_CONTROL_POLICY.authorizationEnvironment &&
      authorizationEnvironment?.can_admins_bypass === false,
    'Release authorization environment identity or administrator-bypass policy differs.',
  );
  const authorizationRules = authorizationEnvironment.protection_rules ?? [];
  const reviewerRule = authorizationRules.find((rule) => rule.type === 'required_reviewers');
  invariant(
    sameJson(authorizationRules.map((rule) => rule.type).sort(), [
      'branch_policy',
      'required_reviewers',
    ]) &&
      reviewerRule?.prevent_self_review === false &&
      sameJson(
        reviewerRule?.reviewers?.map((entry) => ({
          type: entry.type,
          id: entry.reviewer?.id,
          login: entry.reviewer?.login,
        })),
        [
          {
            type: 'User',
            id: RELEASE_CONTROL_POLICY.authorizationReviewerId,
            login: RELEASE_CONTROL_POLICY.maintainer,
          },
        ],
      ),
    'Release authorization environment does not require the exact sole-maintainer review.',
  );
  invariant(
    sameJson(authorizationEnvironment.deployment_branch_policy, {
      protected_branches: false,
      custom_branch_policies: true,
    }) &&
      authorizationDeploymentPolicies?.total_count === 1 &&
      authorizationDeploymentPolicies.branch_policies?.length === 1 &&
      authorizationDeploymentPolicies.branch_policies[0]?.name ===
        RELEASE_CONTROL_POLICY.authorizationBranch &&
      authorizationDeploymentPolicies.branch_policies[0]?.type === 'branch',
    'Release authorization environment is not restricted to current main.',
  );
  invariant(
    immutableReleases?.enabled === true,
    'GitHub Release immutability is not enabled for the repository.',
  );
  invariant(
    ruleset?.id === RELEASE_CONTROL_POLICY.rulesetId &&
      ruleset?.name === RELEASE_CONTROL_POLICY.rulesetName &&
      ruleset?.target === 'tag' &&
      ruleset?.enforcement === 'active' &&
      sameJson(ruleset?.conditions?.ref_name?.include, [
        RELEASE_CONTROL_POLICY.deploymentTagRefPattern,
      ]) &&
      sameJson(ruleset?.conditions?.ref_name?.exclude, []) &&
      sameJson((ruleset?.rules ?? []).map((rule) => rule.type).sort(), ['deletion', 'update']) &&
      sameJson(ruleset?.bypass_actors, []) &&
      ruleset?.current_user_can_bypass === 'never',
    'Stable release tag ruleset differs from the exact no-bypass policy.',
  );
  invariant(
    collaborators?.length === 1 &&
      collaborators[0]?.login === RELEASE_CONTROL_POLICY.maintainer &&
      collaborators[0]?.role_name === 'admin',
    'Repository direct-collaborator state differs from the permanent sole-maintainer model.',
  );
  invariant(
    Array.isArray(stableTags) && stableTags.every((entry) => stableTag(entry.name)),
    'Stable tag inspection returned an invalid tag identity.',
  );
  invariant(Array.isArray(releases), 'GitHub Release inspection returned an invalid response.');
  if (phase === 'pre-tag') {
    invariant(stableTag(tag), 'Pre-tag verification requires the intended stable tag.');
    invariant(
      stableTags.every((entry) => entry.name !== tag),
      'The intended stable release tag already exists before tag creation.',
    );
    invariant(
      releases.every((release) => release.tag_name !== tag),
      'A GitHub Release already exists for the intended stable tag.',
    );
  } else {
    invariant(phase === 'publication' && stableTag(tag), 'Unknown release-control phase.');
    invariant(
      stableTags.some((entry) => entry.name === tag),
      'The intended stable release tag is absent during publication.',
    );
    invariant(
      releases.every((release) => release.tag_name !== tag),
      'A GitHub Release already exists for the intended stable tag.',
    );
  }
}

export async function inspectGithubReleaseControls({
  capturedAt = new Date(),
  commandRunner = defaultCommandRunner,
  executionMode = 'tag',
  outputPath,
  phase,
  repository = RELEASE_CONTROL_POLICY.repository,
  tag = '',
}) {
  invariant(repository === RELEASE_CONTROL_POLICY.repository, 'Wrong repository.');
  invariant(phase === 'pre-tag' || phase === 'publication', 'Unknown release-control phase.');
  invariant(
    executionMode === 'tag' || executionMode === 'v1-recovery',
    'Unknown release-control execution mode.',
  );
  invariant(stableTag(tag), 'Wrong phase tag.');
  const environmentName = encodeURIComponent(RELEASE_CONTROL_POLICY.environment);
  const authorizationEnvironmentName = encodeURIComponent(
    RELEASE_CONTROL_POLICY.authorizationEnvironment,
  );
  const [
    repositorySnapshot,
    environment,
    deploymentPolicies,
    authorizationEnvironment,
    authorizationDeploymentPolicies,
    immutableReleases,
    ruleset,
    collaborators,
    stableTags,
    releases,
  ] = await Promise.all([
    ghJson(commandRunner, `repos/${repository}`, 'Repository settings'),
    ghJson(
      commandRunner,
      `repos/${repository}/environments/${environmentName}`,
      'Stable environment settings',
    ),
    ghJson(
      commandRunner,
      `repos/${repository}/environments/${environmentName}/deployment-branch-policies`,
      'Stable environment deployment policies',
    ),
    ghJson(
      commandRunner,
      `repos/${repository}/environments/${authorizationEnvironmentName}`,
      'Release authorization environment settings',
    ),
    ghJson(
      commandRunner,
      `repos/${repository}/environments/${authorizationEnvironmentName}/deployment-branch-policies`,
      'Release authorization environment deployment policies',
    ),
    ghJson(commandRunner, `repos/${repository}/immutable-releases`, 'Immutable release settings'),
    ghJson(
      commandRunner,
      `repos/${repository}/rulesets/${RELEASE_CONTROL_POLICY.rulesetId}`,
      'Stable tag ruleset',
    ),
    ghJson(
      commandRunner,
      `repos/${repository}/collaborators?affiliation=direct&per_page=100`,
      'Direct collaborators',
    ),
    ghJson(
      commandRunner,
      `repos/${repository}/git/matching-refs/tags/breakdown-local-v`,
      'Stable tags',
    ),
    ghJson(commandRunner, `repos/${repository}/releases?per_page=100`, 'GitHub Releases'),
  ]);
  validateGithubReleaseControls({
    authorizationDeploymentPolicies,
    authorizationEnvironment,
    collaborators,
    deploymentPolicies,
    environment,
    executionMode,
    immutableReleases,
    phase,
    releases,
    repository: repositorySnapshot,
    ruleset,
    stableTags: stableTags.map((entry) => ({ name: entry.ref.replace('refs/tags/', '') })),
    tag,
  });
  const snapshot = {
    schema_version: 'breakdown.github-release-controls.v1',
    captured_at: capturedAt.toISOString(),
    execution_mode: executionMode,
    phase,
    repository: {
      full_name: repositorySnapshot.full_name,
      visibility: repositorySnapshot.visibility,
      html_url: repositorySnapshot.html_url,
    },
    permanent_operating_model: {
      sole_maintainer: RELEASE_CONTROL_POLICY.maintainer,
      independent_review: false,
      compensating_controls_are_independent_review: false,
    },
    environment: sanitizeEnvironment(environment),
    deployment_branch_policies: deploymentPolicies.branch_policies.map((policy) => ({
      id: policy.id,
      name: policy.name,
      type: policy.type,
    })),
    authorization_environment: {
      ...sanitizeEnvironment(authorizationEnvironment),
      protection_rules: authorizationEnvironment.protection_rules.map((rule) => ({
        id: rule.id,
        type: rule.type,
        ...(rule.type === 'required_reviewers'
          ? {
              prevent_self_review: rule.prevent_self_review,
              reviewers: rule.reviewers.map((entry) => ({
                type: entry.type,
                reviewer: {
                  id: entry.reviewer.id,
                  login: entry.reviewer.login,
                },
              })),
            }
          : {}),
      })),
    },
    authorization_deployment_branch_policies: authorizationDeploymentPolicies.branch_policies.map(
      (policy) => ({
        id: policy.id,
        name: policy.name,
        type: policy.type,
      }),
    ),
    immutable_releases: {
      enabled: immutableReleases.enabled,
      enforced_by_owner: immutableReleases.enforced_by_owner,
    },
    tag_ruleset: sanitizeRuleset(ruleset),
    direct_collaborators: collaborators.map((collaborator) => ({
      login: collaborator.login,
      role_name: collaborator.role_name,
    })),
    publication_identity: {
      intended_tag: tag ?? null,
      matching_tags: stableTags.map((entry) => entry.ref.replace('refs/tags/', '')),
      matching_releases: releases
        .filter((release) => stableTag(release.tag_name))
        .map((release) => ({
          id: release.id,
          tag_name: release.tag_name,
          draft: release.draft,
          immutable: release.immutable,
        })),
    },
    verification: { status: 'passed' },
  };
  await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return snapshot;
}

export function validateRetainedGithubReleaseControls(snapshot, { repository, tag }) {
  const stableEnvironmentBoundary = exactStableEnvironmentBoundary({
    deploymentPolicies: {
      total_count: snapshot?.deployment_branch_policies?.length,
      branch_policies: snapshot?.deployment_branch_policies,
    },
    environment: snapshot?.environment,
    executionMode: snapshot?.execution_mode,
    phase: snapshot?.phase,
    tag,
  });
  invariant(
    snapshot?.schema_version === 'breakdown.github-release-controls.v1' &&
      ['tag', 'v1-recovery'].includes(snapshot?.execution_mode) &&
      snapshot?.phase === 'publication' &&
      snapshot?.repository?.full_name === RELEASE_CONTROL_POLICY.repository &&
      snapshot?.repository?.html_url === repository &&
      snapshot?.repository?.visibility === 'public' &&
      snapshot?.permanent_operating_model?.sole_maintainer === RELEASE_CONTROL_POLICY.maintainer &&
      snapshot?.permanent_operating_model?.independent_review === false &&
      snapshot?.permanent_operating_model?.compensating_controls_are_independent_review === false &&
      snapshot?.environment?.id === RELEASE_CONTROL_POLICY.environmentId &&
      snapshot?.environment?.name === RELEASE_CONTROL_POLICY.environment &&
      snapshot?.environment?.can_admins_bypass === false &&
      stableEnvironmentBoundary &&
      snapshot?.authorization_environment?.id ===
        RELEASE_CONTROL_POLICY.authorizationEnvironmentId &&
      snapshot?.authorization_environment?.name ===
        RELEASE_CONTROL_POLICY.authorizationEnvironment &&
      snapshot?.authorization_environment?.can_admins_bypass === false &&
      sameJson(
        snapshot?.authorization_environment?.protection_rules?.map((rule) => rule.type).sort(),
        ['branch_policy', 'required_reviewers'],
      ) &&
      snapshot?.authorization_environment?.protection_rules?.find(
        (rule) => rule.type === 'required_reviewers',
      )?.prevent_self_review === false &&
      sameJson(
        snapshot?.authorization_environment?.protection_rules?.find(
          (rule) => rule.type === 'required_reviewers',
        )?.reviewers,
        [
          {
            type: 'User',
            reviewer: {
              id: RELEASE_CONTROL_POLICY.authorizationReviewerId,
              login: RELEASE_CONTROL_POLICY.maintainer,
            },
          },
        ],
      ) &&
      sameJson(snapshot?.authorization_environment?.deployment_branch_policy, {
        protected_branches: false,
        custom_branch_policies: true,
      }) &&
      snapshot?.authorization_deployment_branch_policies?.length === 1 &&
      snapshot.authorization_deployment_branch_policies[0]?.name ===
        RELEASE_CONTROL_POLICY.authorizationBranch &&
      snapshot.authorization_deployment_branch_policies[0]?.type === 'branch' &&
      snapshot?.immutable_releases?.enabled === true &&
      snapshot?.tag_ruleset?.id === RELEASE_CONTROL_POLICY.rulesetId &&
      snapshot?.tag_ruleset?.name === RELEASE_CONTROL_POLICY.rulesetName &&
      snapshot?.tag_ruleset?.target === 'tag' &&
      snapshot?.tag_ruleset?.enforcement === 'active' &&
      sameJson(snapshot?.tag_ruleset?.conditions?.ref_name?.include, [
        RELEASE_CONTROL_POLICY.deploymentTagRefPattern,
      ]) &&
      sameJson(snapshot?.tag_ruleset?.conditions?.ref_name?.exclude, []) &&
      sameJson(snapshot?.tag_ruleset?.rules?.map((rule) => rule.type).sort(), [
        'deletion',
        'update',
      ]) &&
      sameJson(snapshot?.tag_ruleset?.bypass_actors, []) &&
      snapshot?.tag_ruleset?.current_user_can_bypass === 'never' &&
      sameJson(snapshot?.direct_collaborators, [
        { login: RELEASE_CONTROL_POLICY.maintainer, role_name: 'admin' },
      ]) &&
      snapshot?.publication_identity?.intended_tag === tag &&
      snapshot?.publication_identity?.matching_tags?.includes(tag) &&
      snapshot?.publication_identity?.matching_releases?.every(
        (release) => release.tag_name !== tag,
      ) &&
      snapshot?.verification?.status === 'passed',
    'Retained GitHub release controls do not prove the exact publication boundary.',
  );
}

function runWithInput(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (code === 0) resolve(result);
      else reject(new Error(result.stderr || result.stdout || `${command} exited with ${code}.`));
    });
    child.stdin.end(input);
  });
}

export async function verifyHumanReleaseApprovalSignature({
  approvalPath,
  approvedAt = new Date(),
  commandRunner = defaultCommandRunner,
  githubLogin = RELEASE_CONTROL_POLICY.maintainer,
  githubSigningKeys,
  outputPath,
  signaturePath,
  signatureRunner = runWithInput,
}) {
  invariant(
    githubLogin === RELEASE_CONTROL_POLICY.maintainer,
    'Release approval signer is not the permanent sole maintainer.',
  );
  const approvalBytes = await readFile(approvalPath);
  const signatureBytes = await readFile(signaturePath);
  const approval = parseJson(approvalBytes.toString('utf8'), 'Human release approval');
  invariant(
    approval.schema_version === 'breakdown.human-release-approval.v1' &&
      approval.approver?.github_login === githubLogin &&
      approval.source?.repository === RELEASE_CONTROL_POLICY.repositoryUrl &&
      exactSha1(approval.source?.git_commit) &&
      exactSha256(approval.candidate_digest?.content) &&
      stableTag(approval.tag) &&
      Number.isFinite(Date.parse(approval.approved_at)) &&
      new Date(approval.approved_at).toISOString() === approval.approved_at &&
      Date.parse(approval.approved_at) <= approvedAt.getTime(),
    'Human release approval identity, time, or candidate binding is invalid.',
  );
  invariant(
    signatureBytes.toString('utf8').startsWith('-----BEGIN SSH SIGNATURE-----\n'),
    'Human release approval has no armored SSH signature.',
  );
  const signingKeys =
    githubSigningKeys ??
    (await ghJson(
      commandRunner,
      `users/${githubLogin}/ssh_signing_keys?per_page=100`,
      'GitHub SSH signing keys',
    ));
  invariant(
    Array.isArray(signingKeys) &&
      signingKeys.length > 0 &&
      signingKeys.every((entry) => Number.isSafeInteger(entry.id) && exactString(entry.key)),
    'GitHub has no usable SSH signing key for the release approver.',
  );
  const workDirectory = await mkdtemp(join(tmpdir(), 'breakdown-approval-signature-'));
  try {
    const allowedSignersPath = join(workDirectory, 'allowed_signers');
    await writeFile(
      allowedSignersPath,
      `${signingKeys
        .map(
          (entry) =>
            `${githubLogin} namespaces=\"${RELEASE_CONTROL_POLICY.approvalSignatureNamespace}\" ${entry.key}`,
        )
        .join('\n')}\n`,
      { mode: 0o600 },
    );
    const verification = await signatureRunner(
      'ssh-keygen',
      [
        '-Y',
        'verify',
        '-f',
        allowedSignersPath,
        '-I',
        githubLogin,
        '-n',
        RELEASE_CONTROL_POLICY.approvalSignatureNamespace,
        '-s',
        signaturePath,
      ],
      approvalBytes,
    );
    const verificationOutput = `${verification.stdout}${verification.stderr}`.trim();
    invariant(
      verificationOutput.includes(
        `Good \"${RELEASE_CONTROL_POLICY.approvalSignatureNamespace}\" signature for ${githubLogin}`,
      ),
      'SSH signature verification did not identify the release approver.',
    );
    const evidence = {
      schema_version: 'breakdown.human-release-approval-signature-verification.v1',
      verified_at: approvedAt.toISOString(),
      repository: RELEASE_CONTROL_POLICY.repositoryUrl,
      namespace: RELEASE_CONTROL_POLICY.approvalSignatureNamespace,
      approver: {
        github_login: githubLogin,
        github_signing_key_ids: signingKeys
          .map((entry) => entry.id)
          .sort((left, right) => left - right),
      },
      approval: {
        file: 'breakdown-human-release-approval.json',
        sha256: sha256(approvalBytes),
        release_version: approval.release_version,
        candidate_digest: approval.candidate_digest,
        source: approval.source,
        tag: approval.tag,
        approved_at: approval.approved_at,
      },
      signature: {
        file: 'breakdown-human-release-approval.json.sig',
        sha256: sha256(signatureBytes),
        format: 'ssh',
      },
      verification: {
        status: 'passed',
        github_recognized_signing_key: true,
      },
    };
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    return evidence;
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}

export function validateApprovalSignatureEvidence({
  approval,
  approvalBytes,
  evidence,
  signatureBytes,
}) {
  invariant(
    evidence?.schema_version === 'breakdown.human-release-approval-signature-verification.v1' &&
      evidence?.repository === RELEASE_CONTROL_POLICY.repositoryUrl &&
      evidence?.namespace === RELEASE_CONTROL_POLICY.approvalSignatureNamespace &&
      evidence?.approver?.github_login === approval.approver?.github_login &&
      evidence?.approver?.github_login === RELEASE_CONTROL_POLICY.maintainer &&
      Array.isArray(evidence?.approver?.github_signing_key_ids) &&
      evidence.approver.github_signing_key_ids.length > 0 &&
      evidence?.approval?.sha256 === sha256(approvalBytes) &&
      evidence?.approval?.release_version === approval.release_version &&
      sameJson(evidence?.approval?.candidate_digest, approval.candidate_digest) &&
      sameJson(evidence?.approval?.source, approval.source) &&
      evidence?.approval?.tag === approval.tag &&
      evidence?.approval?.approved_at === approval.approved_at &&
      evidence?.signature?.sha256 === sha256(signatureBytes) &&
      evidence?.signature?.format === 'ssh' &&
      evidence?.verification?.status === 'passed' &&
      evidence?.verification?.github_recognized_signing_key === true,
    'Human release approval signature evidence does not authenticate the exact approval.',
  );
}

export function validateWorkflowIdentityEvidence(
  evidence,
  {
    authorizationVerificationSha256,
    candidate,
    candidateArtifactId,
    controlsSha256,
    platformIndexArtifactId,
  },
) {
  const tagRef = `refs/tags/${candidate.tag}`;
  const workflowPath = `${RELEASE_CONTROL_POLICY.repository}/.github/workflows/local-stable-publication.yml`;
  const tagExecution =
    evidence?.execution?.mode === 'tag' &&
    evidence?.execution?.ref === tagRef &&
    evidence?.execution?.source_commit === candidate.provenance.source.git_commit &&
    evidence?.execution?.workflow_ref === `${workflowPath}@${tagRef}` &&
    evidence?.execution?.workflow_sha === candidate.provenance.source.git_commit &&
    evidence?.actor === 'github-actions[bot]' &&
    ['github-actions[bot]', RELEASE_CONTROL_POLICY.maintainer].includes(
      evidence?.triggering_actor,
    ) &&
    evidence?.oidc?.ref === tagRef &&
    evidence?.oidc?.sha === candidate.provenance.source.git_commit;
  const directRecoveryExecution =
    candidate.tag === V1_RELEASE_RECOVERY_POLICY.tag &&
    candidate.provenance.source.git_commit === V1_RELEASE_RECOVERY_POLICY.sourceSha &&
    evidence?.execution?.mode === 'v1-recovery' &&
    evidence?.execution?.ref === 'refs/heads/main' &&
    exactSha1(evidence?.execution?.source_commit) &&
    evidence?.execution?.source_commit === evidence?.execution?.workflow_sha &&
    evidence?.execution?.workflow_ref === `${workflowPath}@refs/heads/main` &&
    evidence?.actor === 'github-actions[bot]' &&
    evidence?.triggering_actor === 'github-actions[bot]' &&
    evidence?.oidc?.ref === 'refs/heads/main' &&
    evidence?.oidc?.sha === evidence?.execution?.workflow_sha;
  const legacyRecoveryExecution =
    candidate.tag === V1_RELEASE_RECOVERY_POLICY.tag &&
    candidate.provenance.source.git_commit === V1_RELEASE_RECOVERY_POLICY.sourceSha &&
    evidence?.execution?.mode === 'v1-recovery' &&
    evidence?.execution?.ref === tagRef &&
    evidence?.execution?.source_commit === candidate.provenance.source.git_commit &&
    evidence?.execution?.workflow_ref === `${workflowPath}@refs/heads/main` &&
    exactSha1(evidence?.execution?.workflow_sha) &&
    evidence?.actor === RELEASE_CONTROL_POLICY.maintainer &&
    evidence?.triggering_actor === RELEASE_CONTROL_POLICY.maintainer &&
    evidence?.oidc?.ref === tagRef &&
    evidence?.oidc?.sha === candidate.provenance.source.git_commit;
  invariant(
    evidence?.schema_version === 'breakdown.stable-workflow-identity.v1' &&
      evidence?.repository === RELEASE_CONTROL_POLICY.repository &&
      evidence?.ref === tagRef &&
      evidence?.ref_name === candidate.tag &&
      evidence?.source_commit === candidate.provenance.source.git_commit &&
      (tagExecution || directRecoveryExecution || legacyRecoveryExecution) &&
      evidence?.environment === RELEASE_CONTROL_POLICY.environment &&
      evidence?.runner_environment === 'github-hosted' &&
      evidence?.oidc?.subject ===
        `repo:${RELEASE_CONTROL_POLICY.repository}:environment:${RELEASE_CONTROL_POLICY.environment}` &&
      evidence?.oidc?.audience === RELEASE_CONTROL_POLICY.oidcAudience &&
      evidence?.oidc?.job_workflow_ref === evidence.execution.workflow_ref &&
      evidence?.artifact_ids?.candidate === candidateArtifactId &&
      evidence?.artifact_ids?.platform_index === platformIndexArtifactId &&
      /^[1-9]\d*$/.test(evidence?.artifact_ids?.host_support ?? '') &&
      evidence?.release_controls?.ruleset_id === RELEASE_CONTROL_POLICY.rulesetId &&
      evidence?.release_controls?.snapshot_sha256 === controlsSha256 &&
      evidence?.authorization_verification_sha256 === authorizationVerificationSha256,
    'Stable workflow identity does not prove the exact runner, OIDC, actor, and artifact boundary.',
  );
}

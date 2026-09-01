import { sha256 } from './filesystem.mjs';
import { RELEASE_CONTROL_POLICY } from './release-controls.mjs';
import { V1_RELEASE_RECOVERY_POLICY } from './release-recovery-policy.mjs';

export { V1_RELEASE_RECOVERY_POLICY } from './release-recovery-policy.mjs';

export const RELEASE_CEREMONY_POLICY = Object.freeze({
  workflow: 'local-release-ceremony.yml',
  workflowPath: '.github/workflows/local-release-ceremony.yml',
  qualificationWorkflowId: 323419479,
  hostSupportWorkflowId: 323419478,
  stablePublicationWorkflowId: 323419480,
  authorizationEnvironment: RELEASE_CONTROL_POLICY.authorizationEnvironment,
  authorizationEnvironmentId: RELEASE_CONTROL_POLICY.authorizationEnvironmentId,
  signer: Object.freeze({
    method: 'sigstore-keyless-gitsign',
    gitsignVersion: '0.17.1',
    binarySha256: '69213a8a0813a151e5a47d0060862952ff833a845d57309dff76f7ba6600abae',
    certificateIdentity: `https://github.com/${RELEASE_CONTROL_POLICY.repository}/.github/workflows/local-release-ceremony.yml@refs/heads/main`,
    oidcIssuer: 'https://token.actions.githubusercontent.com',
    transparencyLog: 'https://rekor.sigstore.dev',
  }),
});

export const RELEASE_CEREMONY_EXECUTION_MODES = Object.freeze([
  'dry-run',
  'execute',
  'resume-publication',
]);

export const COMMON_RELEASE_ATTESTATIONS = Object.freeze([
  'legal_licensor_identity_confirmed',
  'publisher_identity_confirmed',
  'publication_authority_confirmed',
  'npm_scope_control_confirmed',
  'dco_1_1_signoff_confirmed',
  'no_cla_policy_confirmed',
  'ai_assisted_provenance_human_reviewed',
  'exact_dependency_review_passed',
  'copied_content_review_passed',
  'secret_scan_passed',
  'private_data_scan_passed',
  'artifact_local_notices_reviewed',
  'final_byte_inventory_reviewed',
  'package_gate_passed',
  'security_gate_passed',
  'documentation_gate_passed',
  'traceability_gate_passed',
  'platform_gate_passed',
  'zero_claim_deferred_host_policy_reviewed',
  'github_release_immutability_enabled',
  'tag_protection_enabled',
  'npm_provenance_enabled',
  'npm_registry_signatures_required',
]);

const MODE_ATTESTATIONS = Object.freeze({
  'first-package-bootstrap': Object.freeze([
    'npm_first_package_bootstrap_exception_approved',
    'npm_bootstrap_credential_least_privilege_confirmed',
  ]),
  'finalize-bootstrap': Object.freeze([
    'npm_first_package_bootstrap_evidence_reviewed',
    'npm_trusted_publishing_configured',
    'npm_token_publication_disabled',
    'npm_bootstrap_credential_revoked',
    'npm_bootstrap_github_secret_removed',
  ]),
  'oidc-trusted-publishing': Object.freeze([
    'npm_trusted_publishing_configured',
    'npm_token_publication_disabled',
  ]),
});

const approvalStatement =
  'I authorize only this immutable release plan after reviewing every listed gate and accepting the Breakdown Local 1.0 deferred host-certification policy with supported_hosts: [].';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactSha1(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function exactSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function artifactId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function artifactDigest(value) {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/.test(value);
}

function stableTag(value) {
  return typeof value === 'string' && /^breakdown-local-v\d+\.\d+\.\d+$/.test(value);
}

export function releaseAttestations(npmPublicationMode) {
  const modeAttestations = MODE_ATTESTATIONS[npmPublicationMode];
  invariant(modeAttestations !== undefined, 'Unknown npm publication mode.');
  return Object.freeze([...COMMON_RELEASE_ATTESTATIONS, ...modeAttestations]);
}

export function authorizationConfirmation(planSha256) {
  invariant(exactSha256(planSha256), 'Release plan digest is invalid.');
  return `APPROVE BREAKDOWN LOCAL PLAN SHA256 ${planSha256}`;
}

function validateArtifact(metadata, { id, name, runId, sourceSha }) {
  invariant(
    String(metadata?.id) === id &&
      metadata?.name === name &&
      metadata?.expired === false &&
      artifactDigest(metadata?.digest) &&
      String(metadata?.workflow_run?.id) === runId &&
      metadata?.workflow_run?.head_sha === sourceSha,
    `${name} artifact metadata is not the exact retained qualification artifact.`,
  );
}

function validateRecoveryArtifact(metadata, expected, { runId, sourceSha }) {
  validateArtifact(metadata, {
    id: expected.id,
    name: expected.name,
    runId,
    sourceSha,
  });
  invariant(
    metadata.digest === expected.digest,
    `${expected.name} artifact archive digest differs from the retained recovery evidence.`,
  );
}

export function createReleaseCeremonyPlan({
  candidate,
  candidateArtifact,
  candidateArtifactId,
  ceremonyRun,
  currentMainSha,
  executionMode,
  npmBootstrapArtifactId = '',
  npmPublicationMode,
  npmTrustedPublishingArtifactId = '',
  plannedAt = new Date(),
  platformIndex,
  platformIndexArtifact,
  platformIndexArtifactId,
  platformIndexSha256,
  qualificationRun,
}) {
  invariant(
    RELEASE_CEREMONY_EXECUTION_MODES.includes(executionMode),
    'Unknown release ceremony execution mode.',
  );
  invariant(
    ceremonyRun?.repository === RELEASE_CONTROL_POLICY.repository &&
      ceremonyRun?.ref === 'refs/heads/main' &&
      ceremonyRun?.actor === RELEASE_CONTROL_POLICY.maintainer &&
      ceremonyRun?.triggering_actor === RELEASE_CONTROL_POLICY.maintainer &&
      artifactId(String(ceremonyRun?.id ?? '')) &&
      ceremonyRun?.attempt === 1,
    'Release ceremony was not dispatched once by the sole maintainer from main.',
  );
  const sourceSha = candidate?.provenance?.source?.git_commit;
  invariant(
    exactSha1(sourceSha) &&
      sourceSha === currentMainSha &&
      sourceSha === ceremonyRun.sha &&
      candidate.provenance.source.repository === RELEASE_CONTROL_POLICY.repositoryUrl,
    'Candidate source is not the exact current main commit.',
  );
  const qualificationRunId = String(qualificationRun?.id ?? '');
  invariant(
    artifactId(candidateArtifactId) &&
      artifactId(platformIndexArtifactId) &&
      candidateArtifactId !== platformIndexArtifactId &&
      qualificationRun?.workflow_id === RELEASE_CEREMONY_POLICY.qualificationWorkflowId &&
      qualificationRun?.event === 'workflow_dispatch' &&
      qualificationRun?.conclusion === 'success' &&
      qualificationRun?.run_attempt === 1 &&
      qualificationRun?.head_sha === sourceSha,
    'Qualification run is not one successful current-main, once-built candidate run.',
  );
  validateArtifact(candidateArtifact, {
    id: candidateArtifactId,
    name: 'breakdown-local-candidate',
    runId: qualificationRunId,
    sourceSha,
  });
  validateArtifact(platformIndexArtifact, {
    id: platformIndexArtifactId,
    name: 'breakdown-platform-evidence-index',
    runId: qualificationRunId,
    sourceSha,
  });
  invariant(
    platformIndex?.schema_version === 'breakdown.platform-qualification-index.v1' &&
      platformIndex?.status === 'passed' &&
      platformIndex?.gate?.satisfied === true &&
      sameJson(platformIndex?.candidate_digest, candidate.digest) &&
      platformIndex?.source?.git_commit === sourceSha &&
      exactSha256(platformIndexSha256),
    'Platform index is not the exact passing candidate-bound index.',
  );
  invariant(
    candidate?.checksumInventory?.file === 'SHA256SUMS' &&
      exactSha256(candidate?.checksumInventory?.sha256) &&
      candidate?.digest?.algorithm === 'SHA-256' &&
      exactSha256(candidate?.digest?.content) &&
      stableTag(candidate?.tag),
    'Candidate release identity is incomplete.',
  );
  const attestations = releaseAttestations(npmPublicationMode);
  if (npmPublicationMode === 'first-package-bootstrap') {
    invariant(
      candidate.releaseVersion === '1.0.0' &&
        npmBootstrapArtifactId === '' &&
        npmTrustedPublishingArtifactId === '',
      'First-package bootstrap received incompatible npm evidence.',
    );
  } else if (npmPublicationMode === 'finalize-bootstrap') {
    invariant(
      artifactId(npmBootstrapArtifactId) && artifactId(npmTrustedPublishingArtifactId),
      'Bootstrap finalization requires exact bootstrap and trust artifact IDs.',
    );
  } else {
    invariant(
      npmPublicationMode === 'oidc-trusted-publishing' &&
        npmBootstrapArtifactId === '' &&
        artifactId(npmTrustedPublishingArtifactId),
      'OIDC publication requires only an exact trust artifact ID.',
    );
  }
  const plan = {
    schema_version: 'breakdown.release-ceremony-plan.v1',
    planned_at: plannedAt.toISOString(),
    execution_mode: executionMode,
    release_version: candidate.releaseVersion,
    tag: candidate.tag,
    source: {
      repository: RELEASE_CONTROL_POLICY.repositoryUrl,
      git_commit: sourceSha,
      current_main_sha: currentMainSha,
    },
    candidate: {
      digest: candidate.digest,
      checksum_inventory: candidate.checksumInventory,
      corpus_revision: candidate.corpusRevision,
    },
    artifact_ids: {
      candidate: candidateArtifactId,
      platform_index: platformIndexArtifactId,
      npm_bootstrap: npmBootstrapArtifactId || null,
      npm_trusted_publishing: npmTrustedPublishingArtifactId || null,
    },
    artifact_digests: {
      candidate: candidateArtifact.digest,
      platform_index: platformIndexArtifact.digest,
      platform_index_file_sha256: platformIndexSha256,
    },
    qualification: {
      workflow_id: qualificationRun.workflow_id,
      run_id: qualificationRunId,
      run_attempt: qualificationRun.run_attempt,
    },
    npm_publication_mode: npmPublicationMode,
    human_authorization: {
      environment: RELEASE_CEREMONY_POLICY.authorizationEnvironment,
      environment_id: RELEASE_CEREMONY_POLICY.authorizationEnvironmentId,
      reviewer: RELEASE_CONTROL_POLICY.maintainer,
      attestations,
      statement: approvalStatement,
    },
    automation_signing: RELEASE_CEREMONY_POLICY.signer,
    ceremony: {
      workflow: RELEASE_CEREMONY_POLICY.workflow,
      run_id: String(ceremonyRun.id),
      run_attempt: ceremonyRun.attempt,
    },
    safety: {
      rebuild_permitted: false,
      retag_permitted: false,
      overwrite_permitted: false,
      independent_review_claimed: false,
    },
  };
  assertNoSecretMaterial(plan);
  return plan;
}

export function createGithubReleaseAuthorization({
  approvalHistory,
  authorizedAt = new Date(),
  plan,
  planBytes,
  runAttempt,
}) {
  invariant(runAttempt === 1, 'Release authorization cannot be manufactured by a rerun.');
  const planSha256 = sha256(planBytes);
  invariant(
    plan?.schema_version === 'breakdown.release-ceremony-plan.v1' &&
      plan?.ceremony?.run_attempt === 1,
    'Release authorization received an invalid plan.',
  );
  const approvals = approvalHistory?.filter((entry) => entry.state === 'approved') ?? [];
  invariant(approvals.length === 1, 'Exactly one authenticated release approval is required.');
  const approval = approvals[0];
  invariant(
    approval?.user?.login === RELEASE_CONTROL_POLICY.maintainer &&
      approval?.user?.id === RELEASE_CONTROL_POLICY.authorizationReviewerId &&
      sameJson(
        approval?.environments?.map((environment) => ({
          id: environment.id,
          name: environment.name,
        })),
        [
          {
            id: RELEASE_CEREMONY_POLICY.authorizationEnvironmentId,
            name: RELEASE_CEREMONY_POLICY.authorizationEnvironment,
          },
        ],
      ) &&
      approval?.comment === authorizationConfirmation(planSha256),
    'GitHub review does not explicitly authorize the exact release plan.',
  );
  const authorization = {
    schema_version: 'breakdown.github-release-authorization.v1',
    authorized_at: authorizedAt.toISOString(),
    repository: RELEASE_CONTROL_POLICY.repositoryUrl,
    plan: {
      file: 'breakdown-release-ceremony-plan.json',
      sha256: planSha256,
      value: plan,
    },
    approver: {
      github_login: approval.user.login,
      github_user_id: approval.user.id,
    },
    github_review: {
      state: approval.state,
      comment: approval.comment,
      environment: {
        id: approval.environments[0].id,
        name: approval.environments[0].name,
      },
      workflow_run_id: plan.ceremony.run_id,
      workflow_run_attempt: runAttempt,
    },
    attestations: Object.fromEntries(
      plan.human_authorization.attestations.map((name) => [name, true]),
    ),
    statement: plan.human_authorization.statement,
    verification: {
      github_authenticated_review: true,
      automation_did_not_approve: true,
      status: 'passed',
    },
  };
  assertNoSecretMaterial(authorization);
  return authorization;
}

export function validateGithubReleaseAuthorization(authorization, candidate, npmPublicationMode) {
  const plan = authorization?.plan?.value;
  invariant(
    authorization?.schema_version === 'breakdown.github-release-authorization.v1' &&
      authorization?.repository === RELEASE_CONTROL_POLICY.repositoryUrl &&
      exactSha256(authorization?.plan?.sha256) &&
      sha256(Buffer.from(`${JSON.stringify(plan, null, 2)}\n`)) === authorization.plan.sha256 &&
      plan?.schema_version === 'breakdown.release-ceremony-plan.v1' &&
      plan?.release_version === candidate.releaseVersion &&
      plan?.tag === candidate.tag &&
      plan?.source?.git_commit === candidate.provenance.source.git_commit &&
      sameJson(plan?.candidate?.digest, candidate.digest) &&
      sameJson(plan?.candidate?.checksum_inventory, candidate.checksumInventory) &&
      plan?.npm_publication_mode === npmPublicationMode &&
      authorization?.approver?.github_login === RELEASE_CONTROL_POLICY.maintainer &&
      authorization?.approver?.github_user_id === RELEASE_CONTROL_POLICY.authorizationReviewerId &&
      authorization?.github_review?.state === 'approved' &&
      authorization?.github_review?.comment ===
        authorizationConfirmation(authorization.plan.sha256) &&
      authorization?.github_review?.environment?.id ===
        RELEASE_CEREMONY_POLICY.authorizationEnvironmentId &&
      authorization?.github_review?.environment?.name ===
        RELEASE_CEREMONY_POLICY.authorizationEnvironment &&
      authorization?.github_review?.workflow_run_id === plan?.ceremony?.run_id &&
      authorization?.github_review?.workflow_run_attempt === 1 &&
      sameJson(
        Object.keys(authorization?.attestations ?? {}).sort(),
        [...releaseAttestations(npmPublicationMode)].sort(),
      ) &&
      Object.values(authorization.attestations).every((value) => value === true) &&
      authorization?.statement === approvalStatement &&
      authorization?.verification?.github_authenticated_review === true &&
      authorization?.verification?.automation_did_not_approve === true &&
      authorization?.verification?.status === 'passed',
    'GitHub release authorization is not bound to the exact candidate and publication mode.',
  );
  assertNoSecretMaterial(authorization);
}

export function validateGithubReleaseAuthorizationVerification({
  authorizationBytes,
  attestationBytes,
  evidence,
  sourceCommit,
}) {
  invariant(
    evidence?.schema_version === 'breakdown.github-release-authorization-verification.v1' &&
      evidence?.repository === RELEASE_CONTROL_POLICY.repository &&
      evidence?.authorization?.sha256 === sha256(authorizationBytes) &&
      evidence?.attestation?.sha256 === sha256(attestationBytes) &&
      evidence?.attestation?.signer_workflow ===
        `${RELEASE_CONTROL_POLICY.repository}/${RELEASE_CEREMONY_POLICY.workflowPath}` &&
      evidence?.attestation?.source_ref === 'refs/heads/main' &&
      evidence?.attestation?.source_digest === sourceCommit &&
      evidence?.attestation?.github_hosted_runner === true &&
      evidence?.verification?.status === 'passed',
    'GitHub release authorization attestation does not authenticate the exact authorization.',
  );
}

export function releaseTagMessage({ authorizationSha256, plan }) {
  invariant(exactSha256(authorizationSha256), 'Release authorization digest is invalid.');
  const candidateArtifactId = plan?.artifact_ids?.candidate;
  const platformIndexArtifactId = plan?.artifact_ids?.platform_index;
  invariant(
    plan?.schema_version === 'breakdown.release-ceremony-plan.v1' &&
      artifactId(candidateArtifactId) &&
      artifactId(platformIndexArtifactId) &&
      exactSha256(plan?.candidate?.digest?.content) &&
      exactSha256(plan?.candidate?.checksum_inventory?.sha256),
    'Release tag received an invalid plan.',
  );
  return `Breakdown Local ${plan.release_version}

candidate-digest-sha256: ${plan.candidate.digest.content}
candidate-checksum-inventory-sha256: ${plan.candidate.checksum_inventory.sha256}
candidate-artifact-id: ${candidateArtifactId}
platform-index-artifact-id: ${platformIndexArtifactId}
release-ceremony-run-id: ${plan.ceremony.run_id}
release-plan-sha256: ${sha256(Buffer.from(`${JSON.stringify(plan, null, 2)}\n`))}
release-authorization-sha256: ${authorizationSha256}`;
}

export function validateAutomationSigner(signer) {
  invariant(
    signer?.method === RELEASE_CEREMONY_POLICY.signer.method &&
      signer?.gitsign_version === RELEASE_CEREMONY_POLICY.signer.gitsignVersion &&
      signer?.binary_sha256 === RELEASE_CEREMONY_POLICY.signer.binarySha256 &&
      signer?.certificate_identity === RELEASE_CEREMONY_POLICY.signer.certificateIdentity &&
      signer?.certificate_oidc_issuer === RELEASE_CEREMONY_POLICY.signer.oidcIssuer &&
      signer?.transparency_log === RELEASE_CEREMONY_POLICY.signer.transparencyLog &&
      signer?.signature_verified === true &&
      signer?.certificate_claims_verified === true &&
      signer?.transparency_log_verified === true,
    'Annotated tag was not verified against the exact keyless automation signing identity.',
  );
}

export function validateReleaseRecoveryEvidence(
  {
    authorization,
    authorizationArtifact,
    authorizationBytes,
    candidate,
    candidateArtifact,
    ceremonyRun,
    gitsignVerificationLog,
    plan,
    planArtifact,
    planBytes,
    platformArtifact,
    platformIndex,
    platformIndexSha256,
    qualificationRun,
    signer,
    tagObject,
    tagRef,
  },
  policy,
) {
  policy ??= V1_RELEASE_RECOVERY_POLICY;
  invariant(
    String(ceremonyRun?.id) === policy.ceremonyRunId &&
      ceremonyRun?.workflow_id === policy.ceremonyWorkflowId &&
      ceremonyRun?.repository?.full_name === RELEASE_CONTROL_POLICY.repository &&
      ceremonyRun?.path === RELEASE_CEREMONY_POLICY.workflowPath &&
      ceremonyRun?.event === 'workflow_dispatch' &&
      ceremonyRun?.status === 'completed' &&
      ceremonyRun?.conclusion === 'failure' &&
      ceremonyRun?.run_attempt === 1 &&
      ceremonyRun?.head_branch === 'main' &&
      ceremonyRun?.head_sha === policy.sourceSha &&
      ceremonyRun?.actor?.login === RELEASE_CONTROL_POLICY.maintainer &&
      ceremonyRun?.triggering_actor?.login === RELEASE_CONTROL_POLICY.maintainer,
    'Recovery did not receive the exact failed release ceremony run.',
  );
  validateRecoveryArtifact(planArtifact, policy.planArtifact, {
    runId: policy.ceremonyRunId,
    sourceSha: policy.sourceSha,
  });
  validateRecoveryArtifact(authorizationArtifact, policy.authorizationArtifact, {
    runId: policy.ceremonyRunId,
    sourceSha: policy.sourceSha,
  });
  validateRecoveryArtifact(candidateArtifact, policy.candidateArtifact, {
    runId: policy.qualificationRunId,
    sourceSha: policy.sourceSha,
  });
  validateRecoveryArtifact(platformArtifact, policy.platformArtifact, {
    runId: policy.qualificationRunId,
    sourceSha: policy.sourceSha,
  });
  invariant(
    candidate?.tag === policy.tag &&
      candidate?.releaseVersion === '1.0.0' &&
      candidate?.provenance?.source?.git_commit === policy.sourceSha &&
      candidate?.digest?.content === policy.candidateDigest &&
      candidate?.checksumInventory?.sha256 === policy.candidateChecksumInventorySha256,
    'Recovery candidate differs from the exact already-tagged v1.0.0 bytes.',
  );
  const rebuiltPlan = createReleaseCeremonyPlan({
    candidate,
    candidateArtifact,
    candidateArtifactId: policy.candidateArtifact.id,
    ceremonyRun: {
      repository: ceremonyRun.repository.full_name,
      ref: `refs/heads/${ceremonyRun.head_branch}`,
      sha: ceremonyRun.head_sha,
      actor: ceremonyRun.actor.login,
      triggering_actor: ceremonyRun.triggering_actor.login,
      id: ceremonyRun.id,
      attempt: ceremonyRun.run_attempt,
    },
    currentMainSha: policy.sourceSha,
    executionMode: 'execute',
    npmPublicationMode: 'first-package-bootstrap',
    plannedAt: new Date(plan?.planned_at),
    platformIndex,
    platformIndexArtifact: platformArtifact,
    platformIndexArtifactId: policy.platformArtifact.id,
    platformIndexSha256,
    qualificationRun,
  });
  invariant(
    sameJson(plan, rebuiltPlan) && sha256(planBytes) === policy.planSha256,
    'Recovery plan is not the exact retained and candidate-derived ceremony plan.',
  );
  invariant(
    sha256(authorizationBytes) === policy.authorizationSha256 &&
      authorization?.plan?.sha256 === policy.planSha256 &&
      sameJson(authorization?.plan?.value, plan),
    'Recovery authorization differs from the exact retained ceremony authorization.',
  );
  validateGithubReleaseAuthorization(authorization, candidate, 'first-package-bootstrap');
  const expectedTagMessage = releaseTagMessage({
    authorizationSha256: policy.authorizationSha256,
    plan,
  });
  invariant(
    tagRef?.ref === `refs/tags/${policy.tag}` &&
      tagRef?.object?.type === 'tag' &&
      tagRef?.object?.sha === policy.tagObjectSha &&
      tagObject?.sha === policy.tagObjectSha &&
      tagObject?.tag === policy.tag &&
      tagObject?.object?.type === 'commit' &&
      tagObject?.object?.sha === policy.sourceSha,
    'Recovery tag object or target differs from the immutable protected tag.',
  );
  invariant(
    typeof tagObject?.message === 'string' &&
      tagObject.message.startsWith(`${expectedTagMessage}\n-----BEGIN SIGNED MESSAGE-----\n`) &&
      tagObject.message.endsWith('\n-----END SIGNED MESSAGE-----\n'),
    'Recovery tag does not contain the complete exact ceremony message and Gitsign signature.',
  );
  invariant(
    signer?.tag_verifier === 'verify-tag' &&
      signer?.verification_log_sha256 === sha256(gitsignVerificationLog) &&
      /^Validated Git signature: true$/m.test(gitsignVerificationLog.toString('utf8')) &&
      /^Validated Rekor entry: true$/m.test(gitsignVerificationLog.toString('utf8')) &&
      /^Validated Certificate claims: true$/m.test(gitsignVerificationLog.toString('utf8')),
    'Annotated tag recovery must use the Gitsign tag verifier and retain its log digest.',
  );
  validateAutomationSigner(signer);
  const report = {
    schema_version: 'breakdown.release-recovery-verification.v1',
    repository: RELEASE_CONTROL_POLICY.repository,
    ceremony_run_id: policy.ceremonyRunId,
    tag: policy.tag,
    tag_object_sha: policy.tagObjectSha,
    source_sha: policy.sourceSha,
    artifact_ids: {
      candidate: policy.candidateArtifact.id,
      platform_index: policy.platformArtifact.id,
      plan: policy.planArtifact.id,
      authorization: policy.authorizationArtifact.id,
    },
    plan_sha256: policy.planSha256,
    authorization_sha256: policy.authorizationSha256,
    signer,
    verification: {
      artifact_archives: true,
      authorization_attestation_required: true,
      candidate_and_platform: true,
      tag_message: true,
      tag_target: true,
      status: 'passed',
    },
  };
  assertNoSecretMaterial(report);
  return report;
}

function recoveryWorkflowRuns(value) {
  const pages = Array.isArray(value) ? value : [value];
  invariant(
    pages.length > 0 && pages.every((page) => Array.isArray(page?.workflow_runs)),
    'Stable-publication workflow runs are malformed.',
  );
  return pages.flatMap((page) => page.workflow_runs);
}

function validateRecoveryPublicationState(publicationState, action, policy) {
  invariant(
    publicationState?.github_release_exists === false,
    'A GitHub Release already exists during the first-package bootstrap recovery.',
  );
  invariant(
    publicationState?.npm_packages !== null &&
      typeof publicationState?.npm_packages === 'object' &&
      policy.stablePublication.npmPackages.every(
        (name) => typeof publicationState.npm_packages[name] === 'boolean',
      ),
    'Recovery npm publication state is malformed.',
  );
  const packageStates = policy.stablePublication.npmPackages.map(
    (name) => publicationState.npm_packages[name],
  );
  if (action === 'dispatch') {
    invariant(
      packageStates.every((exists) => exists === false),
      'An npm package already exists before the one correlated stable-publication run.',
    );
  }
}

function recoveryStableDispatch(policy, workflowSha) {
  invariant(exactSha1(workflowSha), 'Recovery workflow SHA is invalid.');
  return {
    ref: policy.stablePublication.dispatch.ref,
    inputs: {
      ...policy.stablePublication.dispatch.inputs,
      recovery_workflow_sha: workflowSha,
    },
  };
}

function recoveryStableTitle(policy, workflowSha) {
  invariant(exactSha1(workflowSha), 'Recovery workflow SHA is invalid.');
  return `${policy.stablePublication.directTitlePrefix}${workflowSha}`;
}

function validateRecoveryStableRun(run, policy, workflowSha) {
  const stable = policy.stablePublication;
  const directTitle = recoveryStableTitle(policy, workflowSha);
  const directActor =
    run?.event === 'workflow_dispatch' &&
    run?.actor?.login === 'github-actions[bot]' &&
    run?.triggering_actor?.login === 'github-actions[bot]';
  const earlierDeploymentActor =
    run?.event === 'deployment' &&
    run?.actor?.login === RELEASE_CONTROL_POLICY.maintainer &&
    run?.triggering_actor?.login === RELEASE_CONTROL_POLICY.maintainer;
  const directIdentity =
    directActor &&
    run?.display_title === directTitle &&
    run?.head_branch === stable.workflowBranch &&
    run?.head_sha === workflowSha;
  const earlierDeploymentIdentity =
    earlierDeploymentActor &&
    run?.display_title === stable.legacyTitle &&
    run?.head_branch === policy.tag &&
    run?.head_sha === policy.sourceSha;
  invariant(
    Number.isSafeInteger(run?.id) &&
      run.id > 0 &&
      run?.workflow_id === stable.workflowId &&
      run?.path === stable.workflowPath &&
      (directIdentity || earlierDeploymentIdentity) &&
      ['queued', 'in_progress', 'completed', 'pending', 'requested', 'waiting'].includes(
        run?.status,
      ) &&
      Number.isSafeInteger(run?.run_attempt) &&
      run.run_attempt > 0 &&
      run?.html_url ===
        `https://github.com/${RELEASE_CONTROL_POLICY.repository}/actions/runs/${run.id}`,
    'A stable-publication run has mismatched inputs, ref, commit, event, actor, or identity.',
  );
  if (run.status === 'completed') {
    invariant(
      ['success', 'failure', 'cancelled', 'timed_out', 'skipped'].includes(run?.conclusion),
      'A completed stable-publication run has an unexpected conclusion.',
    );
  } else {
    invariant(
      run?.conclusion === null,
      'An active stable-publication run has an unexpected conclusion.',
    );
  }
}

export function planV1StablePublicationHandoff(
  { publicationState, workflowRuns, workflowSha },
  policy = V1_RELEASE_RECOVERY_POLICY,
) {
  const stable = policy.stablePublication;
  const directTitle = recoveryStableTitle(policy, workflowSha);
  const runs = recoveryWorkflowRuns(workflowRuns);
  const candidates = runs.filter(
    (run) =>
      run?.display_title === directTitle ||
      run?.display_title === stable.legacyTitle ||
      (run?.path === stable.workflowPath &&
        run?.event === 'workflow_dispatch' &&
        run?.head_branch === stable.workflowBranch) ||
      (run?.path === stable.workflowPath &&
        run?.event === 'deployment' &&
        run?.head_branch === policy.tag &&
        run?.head_sha === policy.sourceSha),
  );
  invariant(
    candidates.length <= 1,
    'More than one correlated stable-publication run exists; recovery refuses a duplicate.',
  );
  validateRecoveryPublicationState(
    publicationState,
    candidates.length === 0 ? 'dispatch' : 'observe',
    policy,
  );
  if (candidates.length === 0) {
    return {
      schema_version: 'breakdown.v1-stable-publication-handoff.v1',
      action: 'dispatch',
      dispatch: recoveryStableDispatch(policy, workflowSha),
    };
  }
  const [run] = candidates;
  validateRecoveryStableRun(run, policy, workflowSha);
  const packageStates = stable.npmPackages.map((name) => publicationState.npm_packages[name]);
  if (run.status === 'completed' && run.conclusion === 'success') {
    invariant(
      packageStates.every((exists) => exists === true),
      'A successful first-package bootstrap run is missing an expected public npm package.',
    );
  }
  if (
    run.status === 'completed' &&
    run.conclusion !== 'success' &&
    packageStates.some((exists) => exists)
  ) {
    return {
      schema_version: 'breakdown.v1-stable-publication-handoff.v1',
      action: 'stop',
      result: 'partial_publication_stop',
      run: {
        conclusion: run.conclusion,
        event: run.event,
        id: String(run.id),
        run_attempt: run.run_attempt,
        status: run.status,
        url: run.html_url,
      },
    };
  }
  const action =
    run.status !== 'completed'
      ? 'monitor'
      : run.conclusion === 'success'
        ? 'complete'
        : 'successor_required';
  return {
    schema_version: 'breakdown.v1-stable-publication-handoff.v1',
    action,
    result:
      action === 'complete'
        ? 'complete'
        : action === 'successor_required'
          ? 'retryable_before_side_effects'
          : 'needs_review',
    run: {
      conclusion: run.conclusion,
      event: run.event,
      id: String(run.id),
      run_attempt: run.run_attempt,
      status: run.status,
      url: run.html_url,
    },
  };
}

export function decideCeremonyRecovery({ downstreamRuns, existingTag, plan }) {
  const exactRuns = downstreamRuns.filter(
    (run) => run.ceremony_run_id === plan.ceremony.run_id && run.tag === plan.tag,
  );
  invariant(exactRuns.length <= 1, 'Duplicate downstream ceremony runs require investigation.');
  if (existingTag === null) {
    invariant(exactRuns.length === 0, 'Downstream work exists before the protected tag.');
    return 'create-tag';
  }
  invariant(
    existingTag.tag === plan.tag &&
      existingTag.source_sha === plan.source.git_commit &&
      existingTag.ceremony_run_id === plan.ceremony.run_id,
    'An existing tag cannot be resumed by this exact ceremony run.',
  );
  if (exactRuns.length === 0) return 'resume-after-tag';
  if (exactRuns[0].status === 'success') return 'reuse-success';
  invariant(
    ['failure', 'cancelled', 'timed_out'].includes(exactRuns[0].status),
    'An exact downstream run is still active; do not dispatch a duplicate.',
  );
  return 'new-reviewed-successor-required';
}

export function assertNoSecretMaterial(value) {
  const visit = (entry, path) => {
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (entry === null || typeof entry !== 'object') return;
    for (const [key, item] of Object.entries(entry)) {
      const nextPath = path.length === 0 ? key : `${path}.${key}`;
      invariant(
        !(
          /(?:^|_)(?:token|secret|password|private_key|credential_value)(?:$|_)/i.test(key) &&
          typeof item !== 'boolean'
        ),
        `Retained release evidence contains forbidden secret-shaped field ${nextPath}.`,
      );
      visit(item, nextPath);
    }
  };
  visit(value, '');
}

import { timingSafeEqual } from 'node:crypto';

import { sha256 } from './filesystem.mjs';
import {
  RELEASE_CEREMONY_POLICY,
  assertNoSecretMaterial,
  validateAutomationSigner,
} from './release-ceremony.mjs';
import { RELEASE_CONTROL_POLICY } from './release-controls.mjs';
import { V1_RELEASE_RECOVERY_POLICY } from './release-recovery-policy.mjs';

export const RELEASE_OPERATION_RESULTS = Object.freeze([
  'rehearsal_failed',
  'retryable_before_side_effects',
  'needs_review',
  'partial_publication_stop',
  'complete',
]);

export const RELEASE_OPERATION_BOUNDARIES = Object.freeze([
  'rehearsing',
  'ready_for_review',
  'authorized',
  'preflight',
  'live_prepublication',
  'any_public_side_effect',
  'unknown',
]);

const TERMINAL_CONCLUSIONS = Object.freeze([
  'success',
  'failure',
  'cancelled',
  'timed_out',
  'skipped',
]);
const ACTIVE_STATUSES = Object.freeze(['queued', 'in_progress', 'pending', 'requested', 'waiting']);
const PACKAGE_NAMES = Object.freeze([
  '@breakdown-sh/core',
  '@breakdown-sh/cli',
  '@breakdown-sh/mcp',
]);
const STEADY_POLICY = Object.freeze({ name: 'breakdown-local-v*', type: 'tag' });
const RECOVERY_POLICY = Object.freeze({ name: 'main', type: 'branch' });

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactSha1(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function exactSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function positiveId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

function stableTag(value) {
  return typeof value === 'string' && /^breakdown-local-v\d+\.\d+\.\d+$/.test(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonical(item)]),
  );
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export function canonicalJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export function createReleaseOperation(input) {
  invariant(stableTag(input?.tag), 'Release operation tag is invalid.');
  invariant(exactSha1(input?.tag_object_sha), 'Release operation tag object is invalid.');
  invariant(
    exactSha1(input?.candidate?.source_sha),
    'Release operation candidate source is invalid.',
  );
  invariant(
    exactSha256(input?.candidate?.digest),
    'Release operation candidate digest is invalid.',
  );
  invariant(
    exactSha256(input?.candidate?.checksum_inventory_sha256),
    'Release operation checksum inventory digest is invalid.',
  );
  invariant(positiveId(input?.ceremony_run_id), 'Release operation ceremony run is invalid.');
  invariant(
    input?.artifact_ids !== null &&
      typeof input?.artifact_ids === 'object' &&
      ['candidate', 'platform_index', 'host_support', 'plan', 'authorization'].every((name) =>
        positiveId(input.artifact_ids[name]),
      ),
    'Release operation artifact IDs are invalid.',
  );
  invariant(
    exactSha256(input?.authorization_sha256),
    'Release operation authorization digest is invalid.',
  );
  invariant(
    ['first-package-bootstrap', 'finalize-bootstrap', 'oidc-trusted-publishing'].includes(
      input?.publication_mode,
    ),
    'Release operation publication mode is invalid.',
  );
  invariant(
    typeof input?.destructive_confirmation === 'string' &&
      input.destructive_confirmation.length > 0,
    'Release operation destructive confirmation is missing.',
  );
  const immutable_inputs = deepFreeze(
    canonical({
      artifact_ids: input.artifact_ids,
      authorization_sha256: input.authorization_sha256,
      candidate: input.candidate,
      ceremony_run_id: input.ceremony_run_id,
      destructive_confirmation: input.destructive_confirmation,
      publication_mode: input.publication_mode,
      tag: input.tag,
      tag_object_sha: input.tag_object_sha,
    }),
  );
  assertNoSecretMaterial(immutable_inputs);
  const immutable_inputs_sha256 = sha256(Buffer.from(canonicalJson(immutable_inputs)));
  return Object.freeze({
    schema_version: 'breakdown.release-operation.v1',
    operation_id: `breakdown-release-${immutable_inputs_sha256}`,
    immutable_inputs_sha256,
    immutable_inputs,
  });
}

export const V1_RELEASE_OPERATION = createReleaseOperation({
  tag: V1_RELEASE_RECOVERY_POLICY.tag,
  tag_object_sha: V1_RELEASE_RECOVERY_POLICY.tagObjectSha,
  candidate: {
    source_sha: V1_RELEASE_RECOVERY_POLICY.sourceSha,
    digest: V1_RELEASE_RECOVERY_POLICY.candidateDigest,
    checksum_inventory_sha256: V1_RELEASE_RECOVERY_POLICY.candidateChecksumInventorySha256,
  },
  ceremony_run_id: V1_RELEASE_RECOVERY_POLICY.ceremonyRunId,
  artifact_ids: {
    candidate: V1_RELEASE_RECOVERY_POLICY.candidateArtifact.id,
    platform_index: V1_RELEASE_RECOVERY_POLICY.platformArtifact.id,
    host_support: V1_RELEASE_RECOVERY_POLICY.hostSupportArtifact.id,
    plan: V1_RELEASE_RECOVERY_POLICY.planArtifact.id,
    authorization: V1_RELEASE_RECOVERY_POLICY.authorizationArtifact.id,
  },
  authorization_sha256: V1_RELEASE_RECOVERY_POLICY.authorizationSha256,
  publication_mode: 'first-package-bootstrap',
  destructive_confirmation:
    V1_RELEASE_RECOVERY_POLICY.stablePublication.dispatch.inputs.npm_bootstrap_confirmation,
});

function publicObservation(value, label) {
  invariant(
    value !== null &&
      typeof value === 'object' &&
      ['absent', 'present', 'indeterminate'].includes(value.status),
    `${label} public-state observation is malformed.`,
  );
  return value.status;
}

export function classifyPublicState(state) {
  const statuses = [publicObservation(state?.github_release, 'GitHub Release')];
  invariant(
    state?.npm_packages !== null &&
      typeof state?.npm_packages === 'object' &&
      PACKAGE_NAMES.every((name) => name in state.npm_packages),
    'npm public-state observations are malformed.',
  );
  for (const name of PACKAGE_NAMES) {
    statuses.push(publicObservation(state.npm_packages[name], name));
  }
  if (statuses.includes('indeterminate')) return 'indeterminate';
  if (statuses.includes('present')) return 'public_side_effect';
  return 'absent';
}

export function githubReleaseObservation(response) {
  invariant(Number.isInteger(response?.status), 'GitHub Release response is malformed.');
  if (response.status === 404) return { status: 'absent', http_status: 404 };
  if (response.status === 200 && response?.body?.tag_name) {
    return { status: 'present', http_status: 200 };
  }
  return { status: 'indeterminate', http_status: response.status };
}

export function npmPackageObservation(response) {
  invariant(Number.isInteger(response?.status), 'npm package response is malformed.');
  if (response.status === 404) return { status: 'absent', http_status: 404 };
  if (response.status === 200 && typeof response?.body?.name === 'string') {
    return { status: 'present', http_status: 200 };
  }
  return { status: 'indeterminate', http_status: response.status };
}

function validateCleanup(cleanup) {
  invariant(
    cleanup !== null &&
      typeof cleanup === 'object' &&
      ['not_required', 'restored_and_verified', 'pending', 'failed', 'delete_forbidden_recovery_state_stable'].includes(cleanup.status),
    'Release attempt cleanup result is malformed.',
  );
}

export function validateAttempt(attempt, operation) {
  invariant(
    attempt?.schema_version === 'breakdown.release-operation-attempt.v1' &&
      attempt.operation_id === operation.operation_id &&
      attempt.immutable_inputs_sha256 === operation.immutable_inputs_sha256 &&
      canonicalJson(attempt.immutable_inputs) === canonicalJson(operation.immutable_inputs),
    'Release attempt does not belong to the exact immutable operation.',
  );
  invariant(
    Number.isSafeInteger(attempt.sequence) && attempt.sequence > 0,
    'Release attempt sequence is invalid.',
  );
  invariant(
    attempt.kind === 'rehearsal' || attempt.kind === 'live',
    'Release attempt kind is invalid.',
  );
  invariant(exactSha1(attempt.controller.sha), 'Release attempt controller SHA is invalid.');
  invariant(positiveId(attempt.controller.run_id), 'Release attempt controller run is invalid.');
  invariant(
    Number.isSafeInteger(attempt.controller.run_attempt) && attempt.controller.run_attempt > 0,
    'Release attempt controller run attempt is invalid.',
  );
  if (attempt.child !== null) {
    invariant(exactSha1(attempt.child.sha), 'Release attempt child SHA is invalid.');
    invariant(
      attempt.child.sha === attempt.controller.sha,
      'Release attempt controller and child SHAs differ.',
    );
    invariant(positiveId(attempt.child.run_id), 'Release attempt child run is invalid.');
    invariant(
      Number.isSafeInteger(attempt.child.run_attempt) && attempt.child.run_attempt > 0,
      'Release attempt child run attempt is invalid.',
    );
    invariant(
      ACTIVE_STATUSES.includes(attempt.child.status) || attempt.child.status === 'completed',
      'Release attempt child status is invalid.',
    );
    if (attempt.child.status === 'completed') {
      invariant(
        TERMINAL_CONCLUSIONS.includes(attempt.child.conclusion),
        'Completed release attempt child conclusion is invalid.',
      );
      invariant(
        attempt.conclusion === attempt.child.conclusion,
        'Release attempt conclusion differs from its completed child.',
      );
    } else {
      invariant(attempt.child.conclusion === null, 'Active release attempt has a conclusion.');
    }
  }
  invariant(
    RELEASE_OPERATION_BOUNDARIES.includes(attempt.last_side_effect_boundary),
    'Release attempt side-effect boundary is invalid.',
  );
  invariant(
    ['absent', 'public_side_effect', 'indeterminate'].includes(attempt.public_state_preflight),
    'Release attempt public-state preflight is invalid.',
  );
  invariant(
    RELEASE_OPERATION_RESULTS.includes(attempt.retry_classification),
    'Release attempt retry classification is invalid.',
  );
  validateCleanup(attempt.cleanup);
  assertNoSecretMaterial(attempt);
  return attempt;
}

function conclusiveBeforePublicEffects(attempt) {
  return (
    ['rehearsing', 'ready_for_review', 'authorized', 'preflight', 'live_prepublication'].includes(
      attempt.last_side_effect_boundary,
    ) &&
    ['rehearsal_failed', 'retryable_before_side_effects'].includes(attempt.retry_classification)
  );
}

function boundaryBeforePublicEffects(boundary) {
  return ['rehearsing', 'ready_for_review', 'authorized', 'preflight', 'live_prepublication'].includes(
    boundary,
  );
}

function isV1ResumableMixedState(publicState) {
  if (!publicState?.npm_packages) return false;
  
  const coreStatus = publicState.npm_packages['@breakdown-sh/core']?.status;
  const cliStatus = publicState.npm_packages['@breakdown-sh/cli']?.status;
  const mcpStatus = publicState.npm_packages['@breakdown-sh/mcp']?.status;
  const releaseStatus = publicState.github_release?.status;
  
  return (
    coreStatus === 'present' &&
    cliStatus === 'absent' &&
    mcpStatus === 'absent' &&
    releaseStatus === 'absent'
  );
}

export function planReleaseAttempt({
  operation,
  attempts,
  controllerSha,
  publicState,
  kind,
  cleanupRequired = kind === 'live',
}) {
  invariant(kind === 'rehearsal' || kind === 'live', 'Unknown release operation kind.');
  invariant(exactSha1(controllerSha), 'Current reviewed workflow SHA is invalid.');
  const ordered = [...attempts].sort((left, right) => left.sequence - right.sequence);
  ordered.forEach((attempt) => validateAttempt(attempt, operation));
  invariant(
    ordered.every((attempt, index) => attempt.sequence === index + 1),
    'Release attempt lineage has a missing or duplicate sequence.',
  );
  invariant(
    new Set(ordered.map((attempt) => attempt.controller.run_id)).size === ordered.length,
    'Release attempt lineage contains a duplicate controller run.',
  );
  invariant(
    new Set(ordered.map((attempt) => attempt.child?.run_id).filter(Boolean)).size ===
      ordered.filter((attempt) => attempt.child !== null).length,
    'Release attempt lineage contains a duplicate child run.',
  );
  invariant(
    ordered.every((attempt, index) => {
      const expectedPredecessor =
        index === 0
          ? null
          : (ordered[index - 1].child?.run_id ?? ordered[index - 1].controller.run_id);
      return attempt.predecessor_run_id === expectedPredecessor;
    }),
    'Release attempt predecessor lineage is not contiguous.',
  );
  const active = ordered.filter(
    (attempt) => attempt.child?.status !== 'completed' && attempt.child,
  );
  const relevant = ordered.filter((attempt) => attempt.kind === kind);
  const previous = relevant.at(-1);
  const predecessor = ordered.at(-1);
  invariant(active.length <= 1, 'More than one active child exists for the release operation.');
  const publicClassification = classifyPublicState(publicState);
  const isResumableMixed = isV1ResumableMixedState(publicState);
  if (publicClassification === 'indeterminate') {
    return { action: 'stop', result: 'needs_review', reason: 'indeterminate_public_state' };
  }
  if (relevant.some((attempt) => attempt.retry_classification === 'partial_publication_stop')) {
    if (isResumableMixed) {
      // Allow resumption for v1 mixed state (core present, cli/mcp absent)
    } else {
      return {
        action: 'stop',
        result: 'partial_publication_stop',
        reason: 'terminal_predecessor',
      };
    }
  }
  if (
    relevant.some(
      (attempt) =>
        attempt.retry_classification === 'needs_review' &&
        !boundaryBeforePublicEffects(attempt.last_side_effect_boundary) &&
        (attempt.last_side_effect_boundary !== 'unknown' || publicClassification !== 'absent'),
    )
  ) {
    // Only allow bypass for resumable mixed state when boundary is known and after public effects
    // Do NOT bypass when boundary is unknown + public not absent (genuinely ambiguous)
    const canBypassForResumable = relevant.some(
      (attempt) =>
        attempt.retry_classification === 'needs_review' &&
        attempt.last_side_effect_boundary !== 'unknown' &&
        !boundaryBeforePublicEffects(attempt.last_side_effect_boundary),
    );
    // Issue #241: Also allow bypass for unknown boundary when public state is the exact
    // v1 resumable mixed pattern (core present, cli/mcp absent, Release absent).
    // This handles the case where a needs_review predecessor had no child (unknown boundary)
    // but independent public inspection confirms the safe mixed state.
    const canBypassUnknownBoundaryForResumable = relevant.some(
      (attempt) =>
        attempt.retry_classification === 'needs_review' &&
        attempt.last_side_effect_boundary === 'unknown' &&
        isResumableMixed,
    );
    if (isResumableMixed && (canBypassForResumable || canBypassUnknownBoundaryForResumable)) {
      // Allow continuation for v1 mixed state (core present, cli/mcp absent) past needs_review
      // when we have a known post-effect boundary OR when unknown boundary + exact mixed pattern
    } else {
      return { action: 'stop', result: 'needs_review', reason: 'ambiguous_predecessor' };
    }
  }
  if (previous?.retry_classification === 'complete') {
    return { action: 'stop', result: 'complete', reason: 'operation_complete' };
  }
  if (publicClassification === 'public_side_effect') {
    if (isResumableMixed) {
      // Allow continuation for v1 mixed state (core present, cli/mcp absent)
    } else {
      return {
        action: 'stop',
        result: 'partial_publication_stop',
        reason: 'public_side_effect_observed',
      };
    }
  }
  if (active.length === 1) {
    return {
      action: 'monitor',
      result: 'needs_review',
      reason: 'active_child',
      run_id: active[0].child.run_id,
    };
  }
  if (previous) {
    if (
      cleanupRequired &&
      previous.cleanup.status !== 'restored_and_verified' &&
      previous.cleanup.status !== 'delete_forbidden_recovery_state_stable'
    ) {
      return { action: 'stop', result: 'needs_review', reason: 'cleanup_not_verified' };
    }
    invariant(
      conclusiveBeforePublicEffects(previous) ||
        (previous.retry_classification === 'needs_review' &&
          (boundaryBeforePublicEffects(previous.last_side_effect_boundary) ||
            previous.last_side_effect_boundary === 'unknown') &&
          publicClassification === 'absent') ||
        (previous.retry_classification === 'retryable_before_side_effects' &&
          previous.last_side_effect_boundary === 'any_public_side_effect' &&
          publicClassification === 'absent') ||
        (previous.retry_classification === 'partial_publication_stop' &&
          previous.last_side_effect_boundary === 'any_public_side_effect' &&
          isResumableMixed) ||
        (previous.retry_classification === 'needs_review' &&
          !boundaryBeforePublicEffects(previous.last_side_effect_boundary) &&
          previous.last_side_effect_boundary !== 'unknown' &&
          isResumableMixed) ||
        (previous.retry_classification === 'needs_review' &&
          previous.last_side_effect_boundary === 'unknown' &&
          isResumableMixed),
      'A successor requires a conclusive pre-side-effect predecessor.',
    );
    if (previous.controller.sha === controllerSha) {
      return { action: 'stop', result: 'needs_review', reason: 'stale_snapshot' };
    }
  }
  return {
    action: 'dispatch',
    result: kind === 'rehearsal' ? 'rehearsal_failed' : 'retryable_before_side_effects',
    operation_id: operation.operation_id,
    sequence: ordered.length + 1,
    predecessor_run_id: predecessor?.child?.run_id ?? predecessor?.controller.run_id ?? null,
  };
}

function metadataValueMissing(value) {
  return value === undefined || value === null || value === '';
}

export function correlateDispatchedRun(run, expected, { allowRecoveryHandoffTitle = false } = {}) {
  invariant(String(run?.id) === expected.run_id, 'Dispatched run ID changed during correlation.');
  const fields = [
    ['display_title', expected.display_title],
    ['event', expected.event],
    ['head_branch', expected.head_branch],
    ['head_sha', expected.head_sha],
    ['path', expected.path],
    ['actor.login', expected.actor],
    ['triggering_actor.login', expected.triggering_actor],
  ];
  const missing = [];
  const pending = [];
  for (const [path, value] of fields) {
    const actual = path.split('.').reduce((entry, key) => entry?.[key], run);
    if (metadataValueMissing(actual)) {
      missing.push(path);
      continue;
    }
    if (path === 'display_title' && allowRecoveryHandoffTitle) {
      const recoveryPrefix = V1_RELEASE_RECOVERY_POLICY.stablePublication.directTitlePrefix;
      const legacyTitle = V1_RELEASE_RECOVERY_POLICY.stablePublication.legacyTitle;
      if (
        typeof actual === 'string' &&
        actual.startsWith(recoveryPrefix) &&
        typeof value === 'string' &&
        value.startsWith(recoveryPrefix)
      ) {
        const actualSha = actual.slice(recoveryPrefix.length);
        const expectedSha = value.slice(recoveryPrefix.length);
        invariant(
          exactSha1(actualSha) && exactSha1(expectedSha),
          'V1 recovery handoff display_title does not contain valid workflow SHAs.',
        );
        continue;
      }
      if (
        typeof actual === 'string' &&
        typeof value === 'string' &&
        (actual === legacyTitle || value === legacyTitle) &&
        (actual.startsWith(recoveryPrefix) || actual === legacyTitle) &&
        (value.startsWith(recoveryPrefix) || value === legacyTitle)
      ) {
        continue;
      }
    }
    if (actual !== value) {
      if (path === 'display_title') {
        pending.push(path);
        continue;
      }
      invariant(false, `Dispatched run has mismatched ${path}.`);
    }
  }
  if (missing.length > 0 || pending.length > 0) {
    return { status: 'pending_metadata', missing: [...missing, ...pending] };
  }
  invariant(
    ACTIVE_STATUSES.includes(run.status) || run.status === 'completed',
    'Dispatched run status is invalid.',
  );
  return { status: 'correlated', missing: [] };
}

export function validateDispatchResponse(response, repository = RELEASE_CONTROL_POLICY.repository) {
  invariant(
    Number.isSafeInteger(response?.workflow_run_id) && response.workflow_run_id > 0,
    'Workflow dispatch did not return a run ID; do not retry blindly.',
  );
  const runId = String(response.workflow_run_id);
  invariant(
    response.run_url === `https://api.github.com/repos/${repository}/actions/runs/${runId}` &&
      response.html_url === `https://github.com/${repository}/actions/runs/${runId}`,
    'Workflow dispatch returned mismatched run URLs; do not retry blindly.',
  );
  return { run_id: runId, run_url: response.html_url };
}

export function classifyRunResult({ kind, run, publicState, lastBoundary, cleanup }) {
  invariant(kind === 'rehearsal' || kind === 'live', 'Unknown release result kind.');
  invariant(run?.status === 'completed', 'A release result requires a completed child.');
  invariant(TERMINAL_CONCLUSIONS.includes(run?.conclusion), 'Child conclusion is invalid.');
  invariant(RELEASE_OPERATION_BOUNDARIES.includes(lastBoundary), 'Child boundary is invalid.');
  validateCleanup(cleanup);
  const publicClassification = classifyPublicState(publicState);
  const allPublicRecordsPresent =
    publicState.github_release.status === 'present' &&
    PACKAGE_NAMES.every((name) => publicState.npm_packages[name].status === 'present');
  if (publicClassification === 'indeterminate' || lastBoundary === 'unknown') return 'needs_review';
  if (run.conclusion === 'success' && kind === 'live') {
    if (allPublicRecordsPresent && lastBoundary === 'any_public_side_effect') return 'complete';
    return publicClassification === 'public_side_effect' ||
      lastBoundary === 'any_public_side_effect'
      ? 'partial_publication_stop'
      : 'needs_review';
  }
  if (publicClassification === 'public_side_effect') {
    return 'partial_publication_stop';
  }
  if (run.conclusion === 'success') {
    return kind === 'rehearsal' && lastBoundary === 'live_prepublication'
      ? 'complete'
      : 'needs_review';
  }
  if (kind === 'rehearsal' && lastBoundary === 'rehearsing') return 'rehearsal_failed';
  if (
    [
      'rehearsing',
      'ready_for_review',
      'authorized',
      'preflight',
      'live_prepublication',
      'any_public_side_effect',
    ].includes(lastBoundary) &&
    (!cleanup ||
      ['not_required', 'restored_and_verified', 'delete_forbidden_recovery_state_stable'].includes(
        cleanup.status,
      ))
  ) {
    return kind === 'rehearsal' ? 'rehearsal_failed' : 'retryable_before_side_effects';
  }
  return 'needs_review';
}

function safeEqual(left, right) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function exactMessageLine(message, prefix, expected) {
  const lines = message.split(/\r?\n/).filter((line) => line.startsWith(prefix));
  invariant(lines.length === 1, `Annotated tag must contain exactly one ${prefix} binding.`);
  invariant(
    safeEqual(lines[0], `${prefix}${expected}`),
    `Annotated tag ${prefix} binding differs.`,
  );
}

export function createSignedTagEvidence({
  tagObject,
  expected,
  signer,
  gitsignVerificationLog,
  controls,
}) {
  invariant(
    tagObject?.tag === expected.tag &&
      exactSha1(tagObject?.sha) &&
      tagObject?.object?.type === 'commit' &&
      tagObject.object.sha === expected.source_sha &&
      typeof tagObject?.message === 'string',
    'Annotated tag target differs from the exact release operation.',
  );
  exactMessageLine(tagObject.message, 'candidate-digest-sha256: ', expected.candidate_digest);
  exactMessageLine(
    tagObject.message,
    'candidate-checksum-inventory-sha256: ',
    expected.candidate_checksum_inventory_sha256,
  );
  exactMessageLine(tagObject.message, 'candidate-artifact-id: ', expected.candidate_artifact_id);
  exactMessageLine(
    tagObject.message,
    'platform-index-artifact-id: ',
    expected.platform_index_artifact_id,
  );
  exactMessageLine(tagObject.message, 'release-ceremony-run-id: ', expected.ceremony_run_id);
  exactMessageLine(tagObject.message, 'release-plan-sha256: ', expected.plan_sha256);
  exactMessageLine(
    tagObject.message,
    'release-authorization-sha256: ',
    expected.authorization_sha256,
  );
  invariant(
    /^-----BEGIN SIGNED MESSAGE-----$/m.test(tagObject.message) &&
      /^-----END SIGNED MESSAGE-----$/m.test(tagObject.message),
    'Annotated tag is missing its complete signed-message envelope.',
  );
  validateAutomationSigner(signer);
  const log = Buffer.isBuffer(gitsignVerificationLog)
    ? gitsignVerificationLog
    : Buffer.from(gitsignVerificationLog);
  invariant(
    /^Validated Git signature: true$/m.test(log.toString('utf8')) &&
      /^Validated Rekor entry: true$/m.test(log.toString('utf8')) &&
      /^Validated Certificate claims: true$/m.test(log.toString('utf8')),
    'Annotated tag verification log is incomplete.',
  );
  invariant(
    controls?.tag_ruleset?.id === RELEASE_CONTROL_POLICY.rulesetId &&
      controls.tag_ruleset?.target === 'tag' &&
      controls.tag_ruleset?.enforcement === 'active' &&
      JSON.stringify(controls.tag_ruleset?.conditions?.ref_name?.include) ===
        JSON.stringify([RELEASE_CONTROL_POLICY.deploymentTagRefPattern]) &&
      controls.tag_ruleset?.conditions?.ref_name?.exclude?.length === 0 &&
      controls.tag_ruleset?.bypass_actors?.length === 0 &&
      controls.tag_ruleset?.current_user_can_bypass === 'never',
    'Annotated tag ruleset evidence differs from the no-bypass release policy.',
  );
  const evidence = {
    schema_version: 'breakdown.signed-tag-evidence.v1',
    repository: RELEASE_CONTROL_POLICY.repositoryUrl,
    tag: tagObject.tag,
    tag_object_sha: tagObject.sha,
    target: tagObject.object,
    message: tagObject.message,
    artifact_ids: {
      candidate: expected.candidate_artifact_id,
      platform_index: expected.platform_index_artifact_id,
    },
    verification: { verified: true, reason: 'sigstore-keyless-valid' },
    signer,
    protection: {
      ruleset_id: controls.tag_ruleset.id,
      name: controls.tag_ruleset.name,
      target: controls.tag_ruleset.target,
      enforcement: controls.tag_ruleset.enforcement,
      conditions: controls.tag_ruleset.conditions,
      rules: controls.tag_ruleset.rules,
      bypass_actors: controls.tag_ruleset.bypass_actors,
      current_user_can_bypass: controls.tag_ruleset.current_user_can_bypass,
    },
  };
  assertNoSecretMaterial(evidence);
  return evidence;
}

function scrubString(value) {
  return value
    .replace(/(authorization:\s*(?:bearer|token)\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(npm_[a-z0-9_]*token\s*[=:]\s*)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(gh[opsu]_[A-Za-z0-9_]{16,})/g, '[REDACTED_GITHUB_TOKEN]')
    .replace(/(npm_[A-Za-z0-9]{16,})/g, '[REDACTED_NPM_TOKEN]');
}

export function sanitizeReleaseDiagnostics(value) {
  const visit = (entry, key = '') => {
    if (Array.isArray(entry)) return entry.slice(0, 100).map((item) => visit(item));
    if (entry === null || typeof entry !== 'object') {
      if (typeof entry !== 'string') return entry;
      if (/(?:token|secret|password|private_key|credential_value)/i.test(key)) {
        return '[REDACTED]';
      }
      return scrubString(entry).slice(0, 16_384);
    }
    return Object.fromEntries(
      Object.entries(entry)
        .slice(0, 200)
        .map(([nestedKey, item], index) => {
          if (/(?:token|secret|password|private_key|credential_value)/i.test(nestedKey)) {
            return [`redacted_field_${index}`, '[REDACTED]'];
          }
          return [nestedKey, visit(item, nestedKey)];
        }),
    );
  };
  const sanitized = visit(value);
  assertNoSecretMaterial(sanitized);
  return sanitized;
}

function normalizePolicies(value) {
  invariant(
    Array.isArray(value) &&
      value.every(
        (policy) =>
          Number.isSafeInteger(policy?.id) &&
          policy.id > 0 &&
          typeof policy?.name === 'string' &&
          ['branch', 'tag'].includes(policy?.type),
      ),
    'Environment deployment policies are malformed.',
  );
  return value.map(({ id, name, type }) => ({ id, name, type }));
}

function isExactPolicy(policies, expected) {
  return (
    policies.length === 1 &&
    policies[0].name === expected.name &&
    policies[0].type === expected.type
  );
}

function hasPolicy(policies, expected) {
  return policies.some((policy) => policy.name === expected.name && policy.type === expected.type);
}

function isRecoveryState(policies) {
  return (
    policies.length === 2 &&
    hasPolicy(policies, STEADY_POLICY) &&
    hasPolicy(policies, RECOVERY_POLICY)
  );
}

export async function enterV1RecoveryPolicy(adapter) {
  const before = normalizePolicies(await adapter.listPolicies());
  invariant(
    isExactPolicy(before, STEADY_POLICY) || isRecoveryState(before),
    'Recovery policy transition requires steady-state tag policy or bounded recovery state.',
  );
  if (isRecoveryState(before)) {
    return { status: 'recovery_policy_verified', before, after: before };
  }
  try {
    const createResult = await adapter.createPolicy(RECOVERY_POLICY);
    const after = normalizePolicies(await adapter.listPolicies());
    invariant(
      isRecoveryState(after),
      'Recovery policy transition did not produce bounded recovery state with both tag and main policies.',
    );
    return {
      status: 'recovery_policy_verified',
      before,
      after,
      create_status: createResult.status,
    };
  } catch (error) {
    await finalizeV1RecoveryPolicy(adapter);
    throw error;
  }
}

export async function finalizeV1RecoveryPolicy(adapter) {
  const before = normalizePolicies(await adapter.listPolicies());
  if (isExactPolicy(before, STEADY_POLICY)) {
    return { status: 'restored_and_verified', changed: false, before, after: before };
  }
  invariant(
    isRecoveryState(before),
    'Cleanup refuses to mutate unexpected deployment policies; expected bounded recovery state with tag and main policies.',
  );
  const mainPolicy = before.find(
    (policy) => policy.name === RECOVERY_POLICY.name && policy.type === RECOVERY_POLICY.type,
  );
  invariant(mainPolicy, 'Recovery state missing main policy to delete.');
  const deleteResult = await adapter.deletePolicy(mainPolicy.id);
  const after = normalizePolicies(await adapter.listPolicies());
  if (deleteResult.status === 403) {
    invariant(
      isRecoveryState(after),
      'After 403 on DELETE, policies changed to unexpected state; expected bounded recovery state to remain stable.',
    );
    return {
      status: 'delete_forbidden_recovery_state_stable',
      changed: false,
      before,
      after,
      delete_status: deleteResult.status,
      main_policy_id: mainPolicy.id,
    };
  }
  invariant(
    isExactPolicy(after, STEADY_POLICY),
    'Cleanup failed to restore steady-state tag policy.',
  );
  return {
    status: 'restored_and_verified',
    changed: true,
    before,
    after,
    delete_status: deleteResult.status,
  };
}

export async function runWithV1RecoveryPolicy(adapter, operation) {
  const preEnterFinalize = await finalizeV1RecoveryPolicy(adapter);
  if (
    preEnterFinalize.status !== 'restored_and_verified' &&
    preEnterFinalize.status !== 'delete_forbidden_recovery_state_stable'
  ) {
    throw new Error(
      `Pre-enter finalize returned unexpected status: ${preEnterFinalize.status}`,
    );
  }
  await enterV1RecoveryPolicy(adapter);
  let outcome;
  let operationError;
  try {
    outcome = await operation();
  } catch (error) {
    operationError = error;
  }
  let cleanup;
  try {
    cleanup = await finalizeV1RecoveryPolicy(adapter);
  } catch (cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError].filter((error) => error !== undefined),
      'Release operation cleanup failed; further attempts are blocked.',
    );
  }
  if (operationError !== undefined) throw operationError;
  return { outcome, cleanup };
}

export const V1_ADOPTED_ATTEMPTS = Object.freeze([
  Object.freeze({
    schema_version: 'breakdown.release-operation-attempt.v1',
    operation_id: V1_RELEASE_OPERATION.operation_id,
    immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
    immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
    sequence: 1,
    kind: 'live',
    controller: {
      sha: 'eab5fe4568d1f9ed53b134debe923f1d61e9b146',
      run_id: '32418990076',
      run_attempt: 1,
    },
    child: null,
    predecessor_run_id: null,
    public_state_preflight: 'absent',
    last_side_effect_boundary: 'preflight',
    conclusion: 'failure',
    retry_classification: 'retryable_before_side_effects',
    cleanup: { status: 'restored_and_verified' },
  }),
  Object.freeze({
    schema_version: 'breakdown.release-operation-attempt.v1',
    operation_id: V1_RELEASE_OPERATION.operation_id,
    immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
    immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
    sequence: 2,
    kind: 'live',
    controller: {
      sha: 'a5971e0ac499455ae29796a68b4bfdb4f57ffee7',
      run_id: '33427730934',
      run_attempt: 1,
    },
    child: {
      sha: 'a5971e0ac499455ae29796a68b4bfdb4f57ffee7',
      run_id: '33428076790',
      run_attempt: 1,
      status: 'completed',
      conclusion: 'failure',
    },
    predecessor_run_id: '32418990076',
    public_state_preflight: 'absent',
    last_side_effect_boundary: 'preflight',
    conclusion: 'failure',
    retry_classification: 'retryable_before_side_effects',
    cleanup: { status: 'restored_and_verified' },
    migration_evidence: {
      failed_step: 'Verify the candidate-bound keyless tag and strict protection ruleset',
      publication_steps_skipped: true,
      historical_deployment_untouched: '6008739973',
    },
  }),
]);

export const RELEASE_TOOL_INVENTORY = Object.freeze({
  rehearsal: Object.freeze({
    required: Object.freeze(['node']),
    provisioned: Object.freeze({ node: 'actions/setup-node 24.13.0' }),
  }),
  live: Object.freeze({
    required: Object.freeze([
      'bash',
      'cat',
      'chmod',
      'cp',
      'curl',
      'cut',
      'find',
      'gh',
      'git',
      'jq',
      'mkdir',
      'node',
      'npm',
      'pnpm',
      'sha256sum',
    ]),
    prohibited: Object.freeze(['rg']),
  }),
  signer: RELEASE_CEREMONY_POLICY.signer,
});

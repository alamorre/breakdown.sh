import {
  V1_ADOPTED_ATTEMPTS,
  V1_RELEASE_OPERATION,
  classifyPublicState,
  classifyRunResult,
  correlateDispatchedRun,
  planReleaseAttempt,
  runWithV1RecoveryPolicy,
  sanitizeReleaseDiagnostics,
  validateDispatchResponse,
} from './release-operation.mjs';
import { V1_RELEASE_RECOVERY_POLICY } from './release-recovery-policy.mjs';

const PUBLIC_SIDE_EFFECT_STEPS = Object.freeze([
  'Attest every exact publication asset',
  'Create the complete GitHub draft',
  'Publish the exact inspected npm tarballs with OIDC and provenance',
  'Create the three first npm package records with the one-time credential',
  'Attest the sanitized first-package bootstrap result',
  'Publish the ordinary immutable GitHub Release',
]);
const PREPUBLICATION_STEPS = Object.freeze([
  'Retain the complete pre-publication gate evidence',
  'Exercise shared pre-publication gates',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function exactSha1(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
}

function positiveId(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value);
}

export function inferSideEffectBoundary(jobs) {
  if (!Array.isArray(jobs) || jobs.length === 0) return 'unknown';
  const steps = jobs.flatMap((job) => (Array.isArray(job?.steps) ? job.steps : []));
  if (
    steps.some(
      (step) =>
        PUBLIC_SIDE_EFFECT_STEPS.includes(step?.name) &&
        step?.status !== 'queued' &&
        step?.conclusion !== 'skipped',
    )
  ) {
    return 'any_public_side_effect';
  }
  if (
    steps.some(
      (step) => PREPUBLICATION_STEPS.includes(step?.name) && step?.conclusion === 'success',
    )
  ) {
    return 'live_prepublication';
  }
  if (steps.some((step) => step?.status === 'completed')) return 'preflight';
  return 'unknown';
}

export async function v1StableChildRequest({ workflowSha, adapter, publicState, attempts }) {
  invariant(exactSha1(workflowSha), 'Stable child workflow SHA is invalid.');
  
  const baseInputs = {
    ...V1_RELEASE_RECOVERY_POLICY.stablePublication.dispatch.inputs,
    recovery_workflow_sha: workflowSha,
  };
  
  // Check if all packages are present but Release is absent (mixed state)
  const allPackagesPresent = 
    publicState?.npm_packages?.['@breakdown-sh/core']?.status === 'present' &&
    publicState?.npm_packages?.['@breakdown-sh/cli']?.status === 'present' &&
    publicState?.npm_packages?.['@breakdown-sh/mcp']?.status === 'present';
  
  const releaseAbsent = publicState?.github_release?.status === 'absent';
  
  // When all packages are present and Release is absent, ONLY allow finalize-bootstrap
  // if sha256s + artifact can be proven. Otherwise fail-closed. NEVER fall back to first-package-bootstrap.
  if (allPackagesPresent && releaseAbsent) {
    if (!adapter || !attempts) {
      // Cannot verify - fail closed
      return null;
    }
    
    // Expected sha256s for the three packages
    const EXPECTED_PACKAGE_SHA256S = {
      '@breakdown-sh/core': '1500fd5a9b37636df23f2e3a13c64f0422b4e56b8e7b43707f43c42a10c73994',
      '@breakdown-sh/cli': '2fd471040e3b206e77dc875767444005ec6ec8e9300dab14177dfc6981cf6b49',
      '@breakdown-sh/mcp': '3897628206dfd10a486efb1dc20723885fca66523ccb2cbc1cef51f052715107',
    };
    
    // Verify sha256s match if available in public state
    let sha256sVerified = false;
    const npmPackages = publicState.npm_packages;
    if (npmPackages['@breakdown-sh/core']?.sha256 && 
        npmPackages['@breakdown-sh/cli']?.sha256 && 
        npmPackages['@breakdown-sh/mcp']?.sha256) {
      sha256sVerified = 
        npmPackages['@breakdown-sh/core'].sha256 === EXPECTED_PACKAGE_SHA256S['@breakdown-sh/core'] &&
        npmPackages['@breakdown-sh/cli'].sha256 === EXPECTED_PACKAGE_SHA256S['@breakdown-sh/cli'] &&
        npmPackages['@breakdown-sh/mcp'].sha256 === EXPECTED_PACKAGE_SHA256S['@breakdown-sh/mcp'];
    } else {
      // Fetch and verify sha256s from registry
      const verification = await adapter.verifyPackageSha256s(
        ['@breakdown-sh/core', '@breakdown-sh/cli', '@breakdown-sh/mcp'],
        '1.0.0'
      );
      sha256sVerified = 
        verification['@breakdown-sh/core']?.sha256 === EXPECTED_PACKAGE_SHA256S['@breakdown-sh/core'] &&
        verification['@breakdown-sh/cli']?.sha256 === EXPECTED_PACKAGE_SHA256S['@breakdown-sh/cli'] &&
        verification['@breakdown-sh/mcp']?.sha256 === EXPECTED_PACKAGE_SHA256S['@breakdown-sh/mcp'];
    }
    
    if (!sha256sVerified) {
      // SHA256s don't match or couldn't be verified - fail closed
      return null;
    }
    
    // Find the bootstrap artifact from a successful predecessor
    const successfulAttempts = attempts.filter(
      (attempt) => 
        attempt.child?.status === 'completed' && 
        attempt.child?.conclusion === 'success' &&
        attempt.last_side_effect_boundary === 'any_public_side_effect'
    );
    
    // Live artifact names carry a run-id suffix
    // (e.g. breakdown-npm-first-package-bootstrap-33699179727-1), so match the
    // stable prefix rather than the exact name. Expired artifacts never qualify.
    const BOOTSTRAP_ARTIFACT_PREFIX = 'breakdown-npm-first-package-bootstrap';
    const isLiveBootstrapArtifact = (artifact) =>
      typeof artifact?.name === 'string' &&
      (artifact.name === BOOTSTRAP_ARTIFACT_PREFIX ||
        artifact.name.startsWith(`${BOOTSTRAP_ARTIFACT_PREFIX}-`)) &&
      artifact.expired === false;

    let bootstrapArtifactId = null;
    for (const attempt of successfulAttempts.reverse()) {
      try {
        const artifacts = await adapter.listRunArtifacts(attempt.child.run_id);
        const bootstrapArtifact = artifacts.find(isLiveBootstrapArtifact);
        if (bootstrapArtifact) {
          bootstrapArtifactId = String(bootstrapArtifact.id);
          break;
        }
      } catch {
        // Continue to next attempt
      }
    }
    
    if (!bootstrapArtifactId) {
      // Bootstrap artifact not found - fail closed
      return null;
    }
    
    // All conditions met: dispatch with finalize-bootstrap mode
    return {
      workflow_id: V1_RELEASE_RECOVERY_POLICY.stablePublication.workflowId,
      body: {
        ref: V1_RELEASE_RECOVERY_POLICY.stablePublication.dispatch.ref,
        inputs: {
          ...baseInputs,
          npm_publication_mode: 'finalize-bootstrap',
          npm_bootstrap_artifact_id: bootstrapArtifactId,
        },
      },
      github_release_finalization_permitted: true,
    };
  }
  
  // NOT in the mixed state - default to first-package-bootstrap
  return {
    workflow_id: V1_RELEASE_RECOVERY_POLICY.stablePublication.workflowId,
    body: {
      ref: V1_RELEASE_RECOVERY_POLICY.stablePublication.dispatch.ref,
      inputs: baseInputs,
    },
  };
}

export function v1StableChildMetadata(runId, workflowSha) {
  invariant(positiveId(runId), 'Stable child run ID is invalid.');
  invariant(exactSha1(workflowSha), 'Stable child workflow SHA is invalid.');
  const stable = V1_RELEASE_RECOVERY_POLICY.stablePublication;
  return {
    run_id: runId,
    display_title: `${stable.directTitlePrefix}${workflowSha}`,
    event: 'workflow_dispatch',
    head_branch: stable.workflowBranch,
    head_sha: workflowSha,
    path: stable.workflowPath,
    actor: 'github-actions[bot]',
    triggering_actor: 'github-actions[bot]',
  };
}

export async function waitForDurableRunMetadata({
  adapter,
  expected,
  maximumPolls = 24,
  pollIntervalMs = 5_000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  allowRecoveryHandoffTitle = false,
}) {
  invariant(maximumPolls > 0, 'Correlation poll limit must be positive.');
  let lastMissing = [];
  let lastUnavailable = null;
  for (let poll = 1; poll <= maximumPolls; poll += 1) {
    let run;
    try {
      run = await adapter.getRun(expected.run_id);
      lastUnavailable = null;
    } catch (error) {
      lastUnavailable = error instanceof Error ? error.message : String(error);
      if (poll < maximumPolls) await sleep(pollIntervalMs);
      continue;
    }
    const correlation = correlateDispatchedRun(run, expected, { allowRecoveryHandoffTitle });
    if (correlation.status === 'correlated') return { run, polls: poll };
    lastMissing = correlation.missing;
    if (poll < maximumPolls) await sleep(pollIntervalMs);
  }
  return {
    run: null,
    polls: maximumPolls,
    result: 'needs_review',
    reason: 'correlation_timeout',
    missing_metadata: lastMissing,
    last_unavailable_error: lastUnavailable,
    run_id: expected.run_id,
  };
}

export async function monitorExactRun({
  adapter,
  expected,
  maximumPolls = 240,
  pollIntervalMs = 5_000,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  allowRecoveryHandoffTitle = false,
}) {
  invariant(maximumPolls > 0, 'Monitor poll limit must be positive.');
  let lastUnavailable = null;
  let lastMissing = [];
  for (let poll = 1; poll <= maximumPolls; poll += 1) {
    let run;
    try {
      run = await adapter.getRun(expected.run_id);
      lastUnavailable = null;
    } catch (error) {
      lastUnavailable = error instanceof Error ? error.message : String(error);
      if (poll < maximumPolls) await sleep(pollIntervalMs);
      continue;
    }
    const correlation = correlateDispatchedRun(run, expected, { allowRecoveryHandoffTitle });
    lastMissing = correlation.missing;
    if (correlation.status === 'correlated' && run.status === 'completed') {
      return { run, polls: poll };
    }
    if (poll < maximumPolls) await sleep(pollIntervalMs);
  }
  return {
    run: null,
    polls: maximumPolls,
    result: 'needs_review',
    reason: 'monitor_timeout',
    last_unavailable_error: lastUnavailable,
    missing_metadata: lastMissing,
    run_id: expected.run_id,
  };
}

function createAttempt({
  kind = 'live',
  sequence,
  controller,
  child,
  predecessorRunId,
  publicStatePreflight,
  lastBoundary,
  conclusion,
  result,
  cleanup,
  diagnostics,
}) {
  const attempt = {
    schema_version: 'breakdown.release-operation-attempt.v1',
    operation_id: V1_RELEASE_OPERATION.operation_id,
    immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
    immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
    sequence,
    kind,
    controller,
    child,
    predecessor_run_id: predecessorRunId,
    public_state_preflight: publicStatePreflight,
    last_side_effect_boundary: lastBoundary,
    conclusion,
    retry_classification: result,
    cleanup,
    diagnostics,
  };
  return sanitizeReleaseDiagnostics(attempt);
}

async function discoverStableAttempts(adapter, adopted, publicState) {
  const stable = V1_RELEASE_RECOVERY_POLICY.stablePublication;
  const runs = await adapter.listWorkflowRuns(stable.workflowId);
  invariant(Array.isArray(runs), 'Stable-publication workflow run history is malformed.');
  const known = new Set(adopted.map((attempt) => attempt.child?.run_id).filter(Boolean));
  const discoveredRuns = runs
    .filter((run) => {
      if (
        known.has(String(run?.id)) ||
        run?.path !== stable.workflowPath ||
        run?.event !== 'workflow_dispatch'
      ) {
        return false;
      }
      const active = run?.status !== 'completed';
      return (
        run?.display_title?.startsWith(stable.directTitlePrefix) ||
        run?.head_branch === stable.workflowBranch ||
        (active &&
          (!run?.display_title || !run?.head_branch || !run?.head_sha || !run?.actor?.login))
      );
    })
    .sort((left, right) => Number(left.id) - Number(right.id));
  const discovered = [];
  const publicStateClassification = classifyPublicState(publicState);
  let predecessor = adopted.at(-1)?.child?.run_id ?? adopted.at(-1)?.controller.run_id ?? null;
  for (const run of discoveredRuns) {
    const titleSha = run.display_title?.startsWith(stable.directTitlePrefix)
      ? run.display_title.slice(stable.directTitlePrefix.length)
      : null;
    const workflowSha = titleSha ?? run.head_sha;
    invariant(exactSha1(workflowSha), 'Discovered stable-publication title has an invalid SHA.');
    const correlation = correlateDispatchedRun(
      run,
      v1StableChildMetadata(String(run.id), workflowSha),
      { allowRecoveryHandoffTitle: true },
    );
    const completed = run.status === 'completed';
    invariant(
      !completed || correlation.status === 'correlated',
      'Completed stable-publication run is missing durable correlation metadata.',
    );
    const jobs = completed ? await adapter.getJobs(String(run.id)) : [];
    const boundary = completed ? inferSideEffectBoundary(jobs) : 'preflight';
    const cleanup = { status: 'restored_and_verified' };
    const result = completed
      ? classifyRunResult({ kind: 'live', run, publicState, lastBoundary: boundary, cleanup })
      : 'retryable_before_side_effects';
    const attempt = createAttempt({
      sequence: adopted.length + discovered.length + 1,
      controller: {
        sha: workflowSha,
        run_id: String(run.id),
        run_attempt: run.run_attempt,
      },
      child: {
        sha: workflowSha,
        run_id: String(run.id),
        run_attempt: run.run_attempt,
        status: run.status,
        conclusion: run.conclusion,
      },
      predecessorRunId: predecessor,
      publicStatePreflight: publicStateClassification,
      lastBoundary: boundary,
      conclusion: run.conclusion,
      result,
      cleanup,
      diagnostics: { discovered_from_durable_run_id: String(run.id) },
    });
    discovered.push(attempt);
    predecessor = String(run.id);
  }
  return [...adopted, ...discovered];
}

async function completeStableAttempt({ adapter, existing, controller, plan, run, dispatched }) {
  const runId = String(run.id);
  const jobs = await adapter.getJobs(runId);
  const lastBoundary = inferSideEffectBoundary(jobs);
  const finalPublicState = await adapter.readPublicState();
  const result = classifyRunResult({
    kind: 'live',
    run,
    publicState: finalPublicState,
    lastBoundary,
    // The outer operator records the real finalizer outcome after this hosted controller exits.
    cleanup: { status: 'restored_and_verified' },
  });
  const diagnostics =
    run.conclusion === 'success'
      ? { failed_steps: [], retained_artifacts: [] }
      : await adapter.downloadFailureEvidence(runId, jobs);
  const attempt = createAttempt({
    sequence: existing?.sequence ?? plan.sequence,
    controller: existing?.controller ?? controller,
    child: {
      sha: existing?.child?.sha ?? controller.sha,
      run_id: runId,
      run_attempt: run.run_attempt,
      status: run.status,
      conclusion: run.conclusion,
    },
    predecessorRunId: existing?.predecessor_run_id ?? plan.predecessor_run_id,
    publicStatePreflight: existing?.public_state_preflight ?? 'absent',
    lastBoundary,
    conclusion: run.conclusion,
    result,
    cleanup: { status: 'pending' },
    diagnostics,
  });
  return {
    schema_version: 'breakdown.release-operation-result.v1',
    operation_id: V1_RELEASE_OPERATION.operation_id,
    action: 'complete_attempt',
    result,
    run: dispatched ?? {
      run_id: runId,
      run_url: run.html_url,
    },
    attempt,
  };
}

export async function runV1HostedController({
  adapter,
  controller,
  attempts = V1_ADOPTED_ATTEMPTS,
  correlationPolls,
  monitorPolls,
  pollIntervalMs,
  sleep,
}) {
  invariant(exactSha1(controller?.sha), 'Controller SHA is invalid.');
  invariant(positiveId(controller?.run_id), 'Controller run ID is invalid.');
  invariant(
    Number.isSafeInteger(controller?.run_attempt) && controller.run_attempt > 0,
    'Controller run attempt is invalid.',
  );
  const publicState = await adapter.readPublicState();
  const durableAttempts = await discoverStableAttempts(adapter, attempts, publicState);
  const plan = planReleaseAttempt({
    operation: V1_RELEASE_OPERATION,
    attempts: durableAttempts,
    controllerSha: controller.sha,
    publicState,
    kind: 'live',
  });
  if (plan.action === 'stop') {
    return {
      schema_version: 'breakdown.release-operation-result.v1',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      ...plan,
    };
  }
  if (plan.action === 'monitor') {
    const existing = durableAttempts.find((attempt) => attempt.child?.run_id === plan.run_id);
    invariant(existing !== undefined, 'Active child attempt is missing from durable lineage.');
    const expected = v1StableChildMetadata(existing.child.run_id, existing.child.sha);
    const monitored = await monitorExactRun({
      adapter,
      expected,
      maximumPolls: monitorPolls,
      pollIntervalMs,
      sleep,
      allowRecoveryHandoffTitle: true,
    });
    if (monitored.run === null) {
      return {
        schema_version: 'breakdown.release-operation-result.v1',
        operation_id: V1_RELEASE_OPERATION.operation_id,
        action: 'stop',
        ...monitored,
      };
    }
    return completeStableAttempt({
      adapter,
      existing,
      controller,
      plan,
      run: monitored.run,
    });
  }

  const { outcome, cleanup } = await runWithV1RecoveryPolicy(adapter, async () => {
    const request = await v1StableChildRequest({ 
      workflowSha: controller.sha, 
      adapter, 
      publicState, 
      attempts: durableAttempts 
    });
    
    if (request === null) {
      // Fail-closed: cannot verify packages or artifacts
      return {
        schema_version: 'breakdown.release-operation-result.v1',
        operation_id: V1_RELEASE_OPERATION.operation_id,
        action: 'stop',
        result: 'needs_review',
        reason: 'finalize_bootstrap_verification_failed',
        diagnostics: {
          message: 'All packages present but Release absent; cannot verify sha256s or find bootstrap artifact for finalize-bootstrap dispatch.',
        },
      };
    }
    
    const dispatchResponse = await adapter.dispatchWorkflow(request.workflow_id, request.body);
    const dispatched = validateDispatchResponse(dispatchResponse);
    const expected = v1StableChildMetadata(dispatched.run_id, controller.sha);
    const correlated = await waitForDurableRunMetadata({
      adapter,
      expected,
      maximumPolls: correlationPolls,
      pollIntervalMs,
      sleep,
      allowRecoveryHandoffTitle: true,
    });
    if (correlated.run === null) {
      return {
        schema_version: 'breakdown.release-operation-result.v1',
        operation_id: V1_RELEASE_OPERATION.operation_id,
        action: 'stop',
        ...correlated,
        dispatch: dispatched,
      };
    }
    const monitored = await monitorExactRun({
      adapter,
      expected,
      maximumPolls: monitorPolls,
      pollIntervalMs,
      sleep,
      allowRecoveryHandoffTitle: true,
    });
    if (monitored.run === null) {
      return {
        schema_version: 'breakdown.release-operation-result.v1',
        operation_id: V1_RELEASE_OPERATION.operation_id,
        action: 'stop',
        ...monitored,
        dispatch: dispatched,
      };
    }
    return completeStableAttempt({
      adapter,
      controller,
      plan,
      run: monitored.run,
      dispatched,
    });
  });

  if (outcome.schema_version === 'breakdown.release-operation-result.v1') {
    return { ...outcome, cleanup };
  }
  return outcome;
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

export async function inspectV1StableOutcome({
  adapter,
  workflowSha,
  controllerConclusion,
  cleanup,
}) {
  invariant(exactSha1(workflowSha), 'Inspected stable workflow SHA is invalid.');
  const publicState = await adapter.readPublicState();
  const publicClassification = classifyPublicState(publicState);
  if (publicClassification === 'indeterminate') {
    return { result: 'needs_review', reason: 'indeterminate_public_state' };
  }
  const stable = V1_RELEASE_RECOVERY_POLICY.stablePublication;
  const runs = await adapter.listWorkflowRuns(stable.workflowId);
  invariant(Array.isArray(runs), 'Stable-publication workflow run history is malformed.');
  const candidates = runs.filter(
    (run) =>
      run?.path === stable.workflowPath &&
      run?.event === 'workflow_dispatch' &&
      (run?.head_sha === workflowSha ||
        ((run?.head_sha === '' || run?.head_sha === null) && run?.status !== 'completed')),
  );
  if (candidates.length > 1) {
    return { result: 'needs_review', reason: 'duplicate_or_ambiguous_child' };
  }
  if (candidates.length === 0) {
    if (publicClassification === 'public_side_effect') {
      if (isV1ResumableMixedState(publicState)) {
        return {
          result: 'retryable_before_side_effects',
          reason: 'v1_resumable_mixed_state_core_present_cli_mcp_absent',
          last_side_effect_boundary: 'preflight',
        };
      }
      return { result: 'partial_publication_stop', reason: 'public_side_effect_observed' };
    }
    return ['failure', 'cancelled', 'timed_out'].includes(controllerConclusion)
      ? {
          result: 'retryable_before_side_effects',
          reason: 'controller_failed_before_child_dispatch',
          last_side_effect_boundary: 'preflight',
        }
      : { result: 'needs_review', reason: 'child_run_not_durable' };
  }
  const run = candidates[0];
  const expected = v1StableChildMetadata(String(run.id), workflowSha);
  const correlation = correlateDispatchedRun(run, expected, { allowRecoveryHandoffTitle: true });
  if (correlation.status !== 'correlated' || run.status !== 'completed') {
    return {
      result: 'needs_review',
      reason: correlation.status === 'correlated' ? 'active_child' : 'child_metadata_pending',
      run_id: String(run.id),
      missing_metadata: correlation.missing,
    };
  }
  const jobs = await adapter.getJobs(String(run.id));
  const lastBoundary = inferSideEffectBoundary(jobs);
  const result = classifyRunResult({
    kind: 'live',
    run,
    publicState,
    lastBoundary,
    cleanup,
  });
  return {
    result,
    reason: result === 'complete' ? 'exact_child_complete' : 'exact_child_classified',
    run_id: String(run.id),
    last_side_effect_boundary: lastBoundary,
    conclusion: run.conclusion,
  };
}

export function createRehearsalAttempt({
  controllerSha,
  controllerRunId,
  scenario,
  predecessor = null,
}) {
  invariant(exactSha1(controllerSha), 'Rehearsal SHA is invalid.');
  invariant(positiveId(controllerRunId), 'Rehearsal run ID is invalid.');
  invariant(['pass', 'intentional-failure'].includes(scenario), 'Rehearsal scenario is invalid.');
  const success = scenario === 'pass';
  return createAttempt({
    kind: 'rehearsal',
    sequence: predecessor === null ? 1 : predecessor.sequence + 1,
    controller: { sha: controllerSha, run_id: controllerRunId, run_attempt: 1 },
    child: {
      sha: controllerSha,
      run_id: controllerRunId,
      run_attempt: 1,
      status: 'completed',
      conclusion: success ? 'success' : 'failure',
    },
    predecessorRunId: predecessor?.child?.run_id ?? null,
    publicStatePreflight: 'absent',
    lastBoundary: success ? 'live_prepublication' : 'rehearsing',
    conclusion: success ? 'success' : 'failure',
    result: success ? 'complete' : 'rehearsal_failed',
    cleanup: { status: 'not_required' },
    diagnostics: success
      ? { failed_steps: [], retained_artifacts: ['breakdown-release-rehearsal-result.json'] }
      : {
          failed_steps: ['Intentional fixture failure before publication'],
          retained_artifacts: ['breakdown-release-rehearsal-result.json'],
        },
  });
}

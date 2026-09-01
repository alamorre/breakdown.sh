#!/usr/bin/env node

import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { GitHubReleaseAdapter } from './local-release/github-release-adapter.mjs';
import { RELEASE_CEREMONY_POLICY } from './local-release/release-ceremony.mjs';
import {
  V1_RELEASE_OPERATION,
  createSignedTagEvidence,
  finalizeV1RecoveryPolicy,
  runWithV1RecoveryPolicy,
  sanitizeReleaseDiagnostics,
  validateDispatchResponse,
} from './local-release/release-operation.mjs';
import {
  inspectV1StableOutcome,
  monitorExactRun,
  runV1HostedController,
  waitForDurableRunMetadata,
} from './local-release/release-controller.mjs';
import { runReleaseRehearsal } from './local-release/release-rehearsal.mjs';
import { sha256 } from './local-release/filesystem.mjs';
import { V1_RELEASE_RECOVERY_POLICY } from './local-release/release-recovery-policy.mjs';

const REPOSITORY = 'alamorre/breakdown.sh';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

async function writeJson(path, value) {
  await writeFile(resolve(path), `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'w',
    mode: 0o600,
  });
}

function tokenFromEnvironment() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  invariant(
    typeof token === 'string' && token.length > 0,
    'Set GH_TOKEN from the current GitHub CLI session; the controller never stores or prints it.',
  );
  return token;
}

function githubAdapter() {
  return new GitHubReleaseAdapter({
    token: tokenFromEnvironment(),
    repository: process.env.GITHUB_REPOSITORY || REPOSITORY,
  });
}

async function finalizePolicyResult(adapter) {
  try {
    return await finalizeV1RecoveryPolicy(adapter);
  } catch (error) {
    return sanitizeReleaseDiagnostics({
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function rehearse(argv) {
  const usage =
    'Usage: run-release-operation.mjs --rehearse --fixture PATH --scenario pass|intentional-failure --workflow-sha SHA --controller-run-id ID --output PATH';
  const fixture = await readJson(
    requiredArgumentValue(argv, '--fixture', usage),
    'Rehearsal fixture',
  );
  const workflowSha = requiredArgumentValue(argv, '--workflow-sha', usage);
  const controllerRunId = requiredArgumentValue(argv, '--controller-run-id', usage);
  const scenario = requiredArgumentValue(argv, '--scenario', usage);
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const workflows = {
    recovery: await readFile(
      resolve(repositoryRoot, '.github/workflows/local-v1-release-recovery.yml'),
      'utf8',
    ),
    stable_publication: await readFile(
      resolve(repositoryRoot, '.github/workflows/local-stable-publication.yml'),
      'utf8',
    ),
  };
  const result = runReleaseRehearsal({
    fixture,
    scenario,
    workflowSha,
    controllerRunId,
    workflows,
  });
  await writeJson(requiredArgumentValue(argv, '--output', usage), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.result !== 'complete') process.exitCode = 1;
}

async function verifyTag(argv) {
  const usage =
    'Usage: run-release-operation.mjs --verify-tag --tag-object PATH --authorization PATH --controls PATH --gitsign-log PATH --tag TAG --source-sha SHA --candidate-digest SHA256 --checksum-inventory-sha256 SHA256 --candidate-artifact-id ID --platform-index-artifact-id ID --ceremony-run-id ID --output PATH';
  const authorizationPath = resolve(requiredArgumentValue(argv, '--authorization', usage));
  const authorizationBytes = await readFile(authorizationPath);
  const authorization = JSON.parse(authorizationBytes.toString('utf8'));
  const gitsignLog = await readFile(resolve(requiredArgumentValue(argv, '--gitsign-log', usage)));
  const signer = {
    method: RELEASE_CEREMONY_POLICY.signer.method,
    tag_verifier: 'verify-tag',
    gitsign_version: RELEASE_CEREMONY_POLICY.signer.gitsignVersion,
    binary_sha256: RELEASE_CEREMONY_POLICY.signer.binarySha256,
    certificate_identity: RELEASE_CEREMONY_POLICY.signer.certificateIdentity,
    certificate_oidc_issuer: RELEASE_CEREMONY_POLICY.signer.oidcIssuer,
    transparency_log: RELEASE_CEREMONY_POLICY.signer.transparencyLog,
    signature_verified: true,
    certificate_claims_verified: true,
    transparency_log_verified: true,
    verification_log_sha256: sha256(gitsignLog),
  };
  const evidence = createSignedTagEvidence({
    tagObject: await readJson(requiredArgumentValue(argv, '--tag-object', usage), 'Tag object'),
    expected: {
      tag: requiredArgumentValue(argv, '--tag', usage),
      source_sha: requiredArgumentValue(argv, '--source-sha', usage),
      candidate_digest: requiredArgumentValue(argv, '--candidate-digest', usage),
      candidate_checksum_inventory_sha256: requiredArgumentValue(
        argv,
        '--checksum-inventory-sha256',
        usage,
      ),
      candidate_artifact_id: requiredArgumentValue(argv, '--candidate-artifact-id', usage),
      platform_index_artifact_id: requiredArgumentValue(
        argv,
        '--platform-index-artifact-id',
        usage,
      ),
      ceremony_run_id: requiredArgumentValue(argv, '--ceremony-run-id', usage),
      plan_sha256: authorization?.plan?.sha256,
      authorization_sha256: sha256(authorizationBytes),
    },
    signer,
    gitsignVerificationLog: gitsignLog,
    controls: await readJson(requiredArgumentValue(argv, '--controls', usage), 'GitHub controls'),
  });
  await writeJson(requiredArgumentValue(argv, '--output', usage), evidence);
  process.stdout.write(`${JSON.stringify(evidence.verification)}\n`);
}

async function hostedController(argv) {
  const usage =
    'Usage: run-release-operation.mjs --hosted-controller --workflow-sha SHA --controller-run-id ID --controller-run-attempt N --output PATH';
  const output = requiredArgumentValue(argv, '--output', usage);
  let result;
  try {
    result = sanitizeReleaseDiagnostics(
      await runV1HostedController({
        adapter: githubAdapter(),
        controller: {
          sha: requiredArgumentValue(argv, '--workflow-sha', usage),
          run_id: requiredArgumentValue(argv, '--controller-run-id', usage),
          run_attempt: Number(requiredArgumentValue(argv, '--controller-run-attempt', usage)),
        },
      }),
    );
  } catch (error) {
    result = sanitizeReleaseDiagnostics({
      schema_version: 'breakdown.release-operation-result.v1',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      action: 'stop',
      result: 'needs_review',
      reason: 'controller_error',
      diagnostics: {
        name: error instanceof Error ? error.name : 'Error',
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
  await writeJson(output, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.result !== 'complete') process.exitCode = 1;
}

function workflowMetadata({ runId, workflowSha, ref, actor, kind }) {
  if (kind === 'rehearsal') {
    return {
      run_id: runId,
      display_title: `Rehearse ${V1_RELEASE_OPERATION.operation_id} on ${workflowSha}`,
      event: 'workflow_dispatch',
      head_branch: ref,
      head_sha: workflowSha,
      path: '.github/workflows/local-release-rehearsal.yml',
      actor,
      triggering_actor: actor,
    };
  }
  return {
    run_id: runId,
    display_title: `Control ${V1_RELEASE_OPERATION.operation_id} on ${workflowSha}`,
    event: 'workflow_dispatch',
    head_branch: 'main',
    head_sha: workflowSha,
    path: '.github/workflows/local-v1-release-recovery.yml',
    actor,
    triggering_actor: actor,
  };
}

async function dispatchAndMonitor({ adapter, workflow, body, metadata }) {
  const response = validateDispatchResponse(await adapter.dispatchWorkflow(workflow, body));
  const expected = { ...metadata, run_id: response.run_id };
  const correlated = await waitForDurableRunMetadata({ adapter, expected });
  if (correlated.run === null) return { ...correlated, dispatch: response };
  const monitored = await monitorExactRun({ adapter, expected });
  if (monitored.run === null) return { ...monitored, dispatch: response };
  const jobs = await adapter.getJobs(response.run_id);
  const evidence =
    monitored.run.conclusion === 'success'
      ? { failed_steps: [], retained_artifacts: [] }
      : await adapter.downloadFailureEvidence(response.run_id, jobs);
  return {
    result: monitored.run.conclusion === 'success' ? 'complete' : 'rehearsal_failed',
    dispatch: response,
    run: sanitizeReleaseDiagnostics(monitored.run),
    evidence,
  };
}

async function discoverControllerRun({ adapter, workflow, metadata }) {
  const runs = await adapter.listWorkflowRuns(workflow);
  invariant(Array.isArray(runs), 'Controller workflow run history is malformed.');
  const operationPrefix =
    metadata.path === '.github/workflows/local-release-rehearsal.yml'
      ? `Rehearse ${V1_RELEASE_OPERATION.operation_id} on `
      : `Control ${V1_RELEASE_OPERATION.operation_id} on `;
  const operationRuns = runs.filter(
    (run) => run?.path === metadata.path && run?.display_title?.startsWith(operationPrefix),
  );
  const active = operationRuns.filter((run) => run.status !== 'completed');
  invariant(active.length <= 1, 'More than one active controller run exists for the operation.');
  const exact = operationRuns.filter(
    (run) => run.display_title === metadata.display_title && run.head_sha === metadata.head_sha,
  );
  invariant(exact.length <= 1, 'Duplicate controller runs exist for the exact workflow SHA.');
  if (active.length === 1 && exact[0]?.id !== active[0].id) {
    return { action: 'stop', result: 'needs_review', reason: 'concurrent_controller' };
  }
  if (exact.length === 0) return { action: 'dispatch' };
  if (exact[0].status === 'completed') {
    return { action: 'stop', result: 'needs_review', reason: 'stale_snapshot' };
  }
  return { action: 'monitor', run: exact[0] };
}

async function monitorExistingController({ adapter, metadata, run }) {
  const expected = { ...metadata, run_id: String(run.id) };
  const monitored = await monitorExactRun({ adapter, expected });
  if (monitored.run === null) return monitored;
  const jobs = await adapter.getJobs(expected.run_id);
  const evidence =
    monitored.run.conclusion === 'success'
      ? { failed_steps: [], retained_artifacts: [] }
      : await adapter.downloadFailureEvidence(expected.run_id, jobs);
  return {
    result: monitored.run.conclusion === 'success' ? 'complete' : 'rehearsal_failed',
    run: sanitizeReleaseDiagnostics(monitored.run),
    evidence,
  };
}

async function operate(argv) {
  const usage =
    'Usage: run-release-operation.mjs --operate rehearsal|live --workflow-sha SHA --ref REF --output PATH [--scenario pass] [--confirmation EXACT]';
  const kind = requiredArgumentValue(argv, '--operate', usage);
  invariant(kind === 'rehearsal' || kind === 'live', usage);
  const workflowSha = requiredArgumentValue(argv, '--workflow-sha', usage);
  const ref = requiredArgumentValue(argv, '--ref', usage);
  invariant(/^[0-9a-f]{40}$/.test(workflowSha), 'Operation workflow SHA is invalid.');
  const adapter = githubAdapter();
  invariant(
    (await adapter.branchHead(ref)) === workflowSha,
    'Operation ref does not resolve to the exact requested workflow SHA.',
  );
  const actor = await adapter.currentUser();
  invariant(typeof actor === 'string' && actor.length > 0, 'Could not resolve GitHub actor.');
  const metadata = workflowMetadata({ runId: '1', workflowSha, ref, actor, kind });
  const workflow =
    kind === 'rehearsal' ? 'local-release-rehearsal.yml' : 'local-v1-release-recovery.yml';
  if (kind === 'live') {
    invariant(ref === 'main', 'Live recovery may run only from exact main.');
    invariant(
      requiredArgumentValue(argv, '--confirmation', usage) ===
        V1_RELEASE_RECOVERY_POLICY.confirmation,
      'Live recovery confirmation is not exact.',
    );
  }
  const prior = await discoverControllerRun({ adapter, workflow, metadata });
  let result;
  if (prior.action === 'stop') {
    result = prior;
    if (kind === 'live') result = { ...result, cleanup: await finalizePolicyResult(adapter) };
  } else if (kind === 'rehearsal') {
    const scenario = argv.includes('--scenario')
      ? requiredArgumentValue(argv, '--scenario', usage)
      : 'pass';
    result =
      prior.action === 'monitor'
        ? await monitorExistingController({ adapter, metadata, run: prior.run })
        : await dispatchAndMonitor({
            adapter,
            workflow,
            body: {
              ref,
              inputs: {
                head_sha: workflowSha,
                operation_id: V1_RELEASE_OPERATION.operation_id,
                scenario,
              },
            },
            metadata,
          });
  } else {
    let cleanup = { status: 'pending' };
    try {
      if (prior.action === 'monitor') {
        const controlled = await runWithV1RecoveryPolicy(adapter, () =>
          monitorExistingController({ adapter, metadata, run: prior.run }),
        );
        result = controlled.outcome;
        cleanup = controlled.cleanup;
      } else {
        const controlled = await runWithV1RecoveryPolicy(adapter, () =>
          dispatchAndMonitor({
            adapter,
            workflow,
            body: {
              ref: 'main',
              inputs: {
                confirmation: V1_RELEASE_RECOVERY_POLICY.confirmation,
                operation_id: V1_RELEASE_OPERATION.operation_id,
              },
            },
            metadata,
          }),
        );
        result = controlled.outcome;
        cleanup = controlled.cleanup;
      }
    } catch (error) {
      cleanup = await finalizePolicyResult(adapter);
      result = sanitizeReleaseDiagnostics({
        result: 'needs_review',
        reason: 'controller_error',
        diagnostics: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
    let stableOutcome;
    try {
      stableOutcome = await inspectV1StableOutcome({
        adapter,
        workflowSha,
        controllerConclusion: result.run?.conclusion ?? null,
        cleanup,
      });
    } catch (error) {
      stableOutcome = sanitizeReleaseDiagnostics({
        result: 'needs_review',
        reason: 'stable_outcome_inspection_failed',
        diagnostics: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
    result = { ...result, ...stableOutcome, cleanup };
    if (cleanup.status !== 'restored_and_verified') {
      result = { ...result, result: 'needs_review', reason: 'cleanup_not_verified' };
    }
  }
  const report = {
    schema_version: 'breakdown.agent-release-controller-result.v1',
    operation_id: V1_RELEASE_OPERATION.operation_id,
    kind,
    workflow_sha: workflowSha,
    ...sanitizeReleaseDiagnostics(result),
  };
  await writeJson(requiredArgumentValue(argv, '--output', usage), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.result !== 'complete') process.exitCode = 1;
}

async function finalizePolicy(argv) {
  const usage = 'Usage: run-release-operation.mjs --finalize-policy --output PATH';
  const result = await finalizePolicyResult(githubAdapter());
  await writeJson(requiredArgumentValue(argv, '--output', usage), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== 'restored_and_verified') process.exitCode = 1;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--rehearse')) return rehearse(argv);
  if (argv.includes('--verify-tag')) return verifyTag(argv);
  if (argv.includes('--hosted-controller')) return hostedController(argv);
  if (argv.includes('--operate')) return operate(argv);
  if (argv.includes('--finalize-policy')) return finalizePolicy(argv);
  throw new Error(
    'Choose --rehearse, --verify-tag, --hosted-controller, --operate, or --finalize-policy.',
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

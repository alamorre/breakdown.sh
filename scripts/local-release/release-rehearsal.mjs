import {
  RELEASE_TOOL_INVENTORY,
  V1_ADOPTED_ATTEMPTS,
  V1_RELEASE_OPERATION,
  classifyPublicState,
  correlateDispatchedRun,
  createSignedTagEvidence,
  githubReleaseObservation,
  npmPackageObservation,
  planReleaseAttempt,
  sanitizeReleaseDiagnostics,
  validateDispatchResponse,
} from './release-operation.mjs';
import {
  createRehearsalAttempt,
  inferSideEffectBoundary,
  v1StableChildMetadata,
} from './release-controller.mjs';

const AUDITED_EXECUTABLES = Object.freeze([
  'awk',
  'base64',
  'bash',
  'cat',
  'chmod',
  'cp',
  'curl',
  'cut',
  'find',
  'gh',
  'git',
  'grep',
  'jq',
  'mkdir',
  'mv',
  'node',
  'npm',
  'openssl',
  'pnpm',
  'python',
  'rg',
  'rm',
  'sed',
  'seq',
  'sha256sum',
  'sleep',
  'tar',
  'tee',
  'tr',
  'unzip',
  'xargs',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function auditWorkflowToolInventory(workflow, inventory = RELEASE_TOOL_INVENTORY.live) {
  invariant(typeof workflow === 'string', 'Workflow source is required for the tool audit.');
  const declared = new Set(inventory.required);
  const used = AUDITED_EXECUTABLES.filter((executable) => {
    const pattern = new RegExp(
      `(?:^|[\\s;&|($\\x60])${executable.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s;&|)]|$)`,
      'm',
    );
    return pattern.test(workflow);
  });
  const undeclared = used.filter((executable) => !declared.has(executable));
  invariant(
    undeclared.length === 0,
    `Workflow uses undeclared external tools: ${undeclared.join(', ')}.`,
  );
  const prohibited = (inventory.prohibited ?? []).filter((executable) => used.includes(executable));
  invariant(
    prohibited.length === 0,
    `Workflow uses prohibited external tools: ${prohibited.join(', ')}.`,
  );
  return { declared: [...declared].sort(), used: used.sort(), undeclared: [] };
}

function validateArtifactFixtures(artifacts) {
  const expected = V1_RELEASE_OPERATION.immutable_inputs.artifact_ids;
  invariant(
    artifacts !== null &&
      typeof artifacts === 'object' &&
      Object.entries(expected).every(
        ([name, id]) =>
          String(artifacts[name]?.id) === id &&
          artifacts[name]?.expired === false &&
          /^sha256:[0-9a-f]{64}$/.test(artifacts[name]?.digest),
      ),
    'Rehearsal artifact fixtures do not match the immutable operation.',
  );
}

function hydrateWorkflowSha(value, workflowSha) {
  return JSON.parse(JSON.stringify(value).replaceAll('{{WORKFLOW_SHA}}', workflowSha));
}

export function runReleaseRehearsal({
  fixture,
  scenario,
  workflowSha,
  controllerRunId,
  workflows,
}) {
  invariant(
    fixture?.schema_version === 'breakdown.release-rehearsal-fixture.v1',
    'Release rehearsal fixture schema is invalid.',
  );
  invariant(/^[0-9a-f]{40}$/.test(workflowSha), 'Rehearsal workflow SHA is invalid.');
  invariant(/^[1-9]\d*$/.test(controllerRunId), 'Rehearsal controller run ID is invalid.');
  validateArtifactFixtures(fixture.artifacts);
  const publicState = {
    github_release: githubReleaseObservation(fixture.github.release),
    npm_packages: Object.fromEntries(
      Object.entries(fixture.npm.packages).map(([name, response]) => [
        name,
        npmPackageObservation(response),
      ]),
    ),
  };
  invariant(classifyPublicState(publicState) === 'absent', 'Rehearsal public state is not absent.');
  const plan = planReleaseAttempt({
    operation: V1_RELEASE_OPERATION,
    attempts: V1_ADOPTED_ATTEMPTS,
    controllerSha: workflowSha,
    publicState,
    kind: 'live',
  });
  invariant(plan.action === 'dispatch', 'Rehearsal did not plan one safe successor attempt.');
  const dispatch = validateDispatchResponse(fixture.github.dispatch_response);
  const expected = v1StableChildMetadata(dispatch.run_id, workflowSha);
  const correlations = fixture.github.correlation_snapshots.map((snapshot) =>
    correlateDispatchedRun(hydrateWorkflowSha(snapshot, workflowSha), expected),
  );
  invariant(
    correlations.length >= 2 &&
      correlations.slice(0, -1).every((entry) => entry.status === 'pending_metadata') &&
      correlations.at(-1).status === 'correlated',
    'Rehearsal did not prove bounded eventual-consistency correlation by dispatch run ID.',
  );
  const signedTag = createSignedTagEvidence({
    tagObject: fixture.github.tag_object,
    expected: fixture.github.tag_expectation,
    signer: fixture.github.signer,
    gitsignVerificationLog: fixture.github.gitsign_log,
    controls: fixture.github.controls,
  });
  invariant(
    inferSideEffectBoundary(fixture.github.jobs) === 'live_prepublication',
    'Rehearsal did not reach the final pre-publication boundary.',
  );
  const toolAudits = Object.fromEntries(
    Object.entries(workflows).map(([name, workflow]) => [
      name,
      auditWorkflowToolInventory(workflow),
    ]),
  );
  const attempt = createRehearsalAttempt({
    controllerSha: workflowSha,
    controllerRunId,
    scenario,
    predecessor: V1_ADOPTED_ATTEMPTS.at(-1),
  });
  const result = {
    schema_version: 'breakdown.release-rehearsal-result.v1',
    operation_id: V1_RELEASE_OPERATION.operation_id,
    workflow_sha: workflowSha,
    scenario,
    result: attempt.retry_classification,
    immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
    adopted_predecessor_run: '33428076790',
    planned_successor: plan,
    dispatch,
    correlation: {
      snapshots: correlations.map((entry) => entry.status),
      durable_run_id: dispatch.run_id,
    },
    gates: {
      artifacts: true,
      github_release_absent: true,
      npm_packages_absent: true,
      signed_tag: signedTag.verification.verified,
      ruleset: true,
      final_prepublication_boundary: true,
      minimal_path_tool_inventory: toolAudits,
      publication_commands_executed: false,
    },
    attempt,
  };
  return sanitizeReleaseDiagnostics(result);
}

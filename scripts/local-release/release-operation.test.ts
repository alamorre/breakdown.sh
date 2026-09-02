import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  RELEASE_OPERATION_RESULTS,
  V1_ADOPTED_ATTEMPTS,
  V1_RELEASE_OPERATION,
  classifyPublicState,
  classifyRunResult,
  correlateDispatchedRun,
  createReleaseOperation,
  createSignedTagEvidence,
  enterV1RecoveryPolicy,
  finalizeV1RecoveryPolicy,
  githubReleaseObservation,
  npmPackageObservation,
  planReleaseAttempt,
  runWithV1RecoveryPolicy,
  sanitizeReleaseDiagnostics,
  validateDispatchResponse,
} from './release-operation.mjs';
import {
  inferSideEffectBoundary,
  inspectV1StableOutcome,
  monitorExactRun,
  runV1HostedController,
  v1StableChildMetadata,
  waitForDurableRunMetadata,
} from './release-controller.mjs';
import { auditWorkflowToolInventory, runReleaseRehearsal } from './release-rehearsal.mjs';
import { V1_RELEASE_RECOVERY_POLICY } from './release-recovery-policy.mjs';

const repositoryRoot = join(import.meta.dirname, '../..');
const workflowSha = 'b'.repeat(40);

function absentPublicState() {
  return {
    github_release: { status: 'absent', http_status: 404 },
    npm_packages: {
      '@breakdown-sh/core': { status: 'absent', http_status: 404 },
      '@breakdown-sh/cli': { status: 'absent', http_status: 404 },
      '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
    },
  };
}

function completePublicState() {
  return {
    github_release: { status: 'present', http_status: 200 },
    npm_packages: {
      '@breakdown-sh/core': { status: 'present', http_status: 200 },
      '@breakdown-sh/cli': { status: 'present', http_status: 200 },
      '@breakdown-sh/mcp': { status: 'present', http_status: 200 },
    },
  };
}

function indeterminatePublicState() {
  return {
    github_release: { status: 'indeterminate' },
    npm_packages: {
      '@breakdown-sh/core': { status: 'absent', http_status: 404 },
      '@breakdown-sh/cli': { status: 'absent', http_status: 404 },
      '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
    },
  };
}

function stableRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 9900208,
    workflow_id: 323419480,
    display_title: `Breakdown Local v1.0.0 recovery handoff for workflow ${workflowSha}`,
    event: 'workflow_dispatch',
    status: 'queued',
    conclusion: null,
    head_branch: 'main',
    head_sha: workflowSha,
    path: '.github/workflows/local-stable-publication.yml',
    actor: { login: 'github-actions[bot]' },
    triggering_actor: { login: 'github-actions[bot]' },
    run_attempt: 1,
    html_url: 'https://github.com/alamorre/breakdown.sh/actions/runs/9900208',
    ...overrides,
  };
}

describe('durable release operation identity and migration', () => {
  it('derives one operation ID from every immutable publication input', () => {
    expect(V1_RELEASE_OPERATION).toMatchObject({
      schema_version: 'breakdown.release-operation.v1',
      operation_id:
        'breakdown-release-f36df7cb0ec89bdd73bac9c2751d21ee3c1792118fc47a19ff6fdf1bb09e254d',
      immutable_inputs: {
        tag: 'breakdown-local-v1.0.0',
        tag_object_sha: '222766090da2ad070e8b45619d8f0f844829144f',
        ceremony_run_id: '32391936576',
        publication_mode: 'first-package-bootstrap',
      },
    });
    const changed = createReleaseOperation({
      ...V1_RELEASE_OPERATION.immutable_inputs,
      destructive_confirmation: 'a different destructive confirmation',
    });
    expect(changed.operation_id).not.toBe(V1_RELEASE_OPERATION.operation_id);
  });

  it('adopts both failed recoveries and the completed failed child without touching deployment evidence', () => {
    expect(V1_ADOPTED_ATTEMPTS).toHaveLength(2);
    expect(V1_ADOPTED_ATTEMPTS[0]).toMatchObject({
      controller: { run_id: '32418990076' },
      child: null,
      retry_classification: 'retryable_before_side_effects',
    });
    expect(V1_ADOPTED_ATTEMPTS[1]).toMatchObject({
      controller: { run_id: '33427730934' },
      child: { run_id: '33428076790', status: 'completed', conclusion: 'failure' },
      last_side_effect_boundary: 'preflight',
      migration_evidence: {
        publication_steps_skipped: true,
        historical_deployment_untouched: '6008739973',
      },
    });
  });
});

describe('public-state and side-effect classification', () => {
  it('distinguishes GitHub Release 404, present, and ambiguous failures', () => {
    expect(githubReleaseObservation({ status: 404, body: { message: 'Not Found' } })).toEqual({
      status: 'absent',
      http_status: 404,
    });
    expect(githubReleaseObservation({ status: 200, body: { tag_name: 'v1' } }).status).toBe(
      'present',
    );
    expect(githubReleaseObservation({ status: 403, body: { message: 'Forbidden' } }).status).toBe(
      'indeterminate',
    );
    expect(npmPackageObservation({ status: 503, body: null }).status).toBe('indeterminate');
  });

  it('stops on any public or indeterminate state', () => {
    const partial = absentPublicState();
    partial.npm_packages['@breakdown-sh/core'] = { status: 'present', http_status: 200 };
    expect(classifyPublicState(partial)).toBe('public_side_effect');
    const unknown = absentPublicState();
    unknown.github_release = { status: 'indeterminate', http_status: 500 };
    expect(classifyPublicState(unknown)).toBe('indeterminate');
  });

  it.each(['failure', 'cancelled', 'timed_out'])(
    'classifies a conclusive %s before side effects as retryable',
    (conclusion) => {
      expect(
        classifyRunResult({
          kind: 'live',
          run: { status: 'completed', conclusion },
          publicState: absentPublicState(),
          lastBoundary: 'live_prepublication',
          cleanup: { status: 'restored_and_verified' },
        }),
      ).toBe('retryable_before_side_effects');
    },
  );

  it('stops after partial publication or when the boundary cannot be proved', () => {
    expect(
      classifyRunResult({
        kind: 'live',
        run: { status: 'completed', conclusion: 'failure' },
        publicState: absentPublicState(),
        lastBoundary: 'any_public_side_effect',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).toBe('retryable_before_side_effects');
    expect(
      classifyRunResult({
        kind: 'live',
        run: { status: 'completed', conclusion: 'failure' },
        publicState: absentPublicState(),
        lastBoundary: 'unknown',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).toBe('needs_review');
  });

  it('allows retry when first-package PUT fails with absent public state (issue #227)', () => {
    expect(
      classifyRunResult({
        kind: 'live',
        run: { status: 'completed', conclusion: 'failure' },
        publicState: absentPublicState(),
        lastBoundary: 'any_public_side_effect',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).toBe('retryable_before_side_effects');

    const partialPublicState = absentPublicState();
    partialPublicState.npm_packages['@breakdown-sh/core'] = { status: 'present', http_status: 200 };
    expect(
      classifyRunResult({
        kind: 'live',
        run: { status: 'completed', conclusion: 'failure' },
        publicState: partialPublicState,
        lastBoundary: 'any_public_side_effect',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).toBe('partial_publication_stop');

    expect(
      classifyRunResult({
        kind: 'live',
        run: { status: 'completed', conclusion: 'failure' },
        publicState: indeterminatePublicState(),
        lastBoundary: 'any_public_side_effect',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).toBe('needs_review');
  });

  it('requires both a successful live child and observed public completion', () => {
    expect(
      classifyRunResult({
        kind: 'live',
        run: { status: 'completed', conclusion: 'success' },
        publicState: completePublicState(),
        lastBoundary: 'any_public_side_effect',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).toBe('complete');
    expect(
      classifyRunResult({
        kind: 'live',
        run: { status: 'completed', conclusion: 'success' },
        publicState: absentPublicState(),
        lastBoundary: 'any_public_side_effect',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).toBe('partial_publication_stop');
    const partial = absentPublicState();
    partial.npm_packages['@breakdown-sh/core'] = { status: 'present', http_status: 200 };
    expect(
      classifyRunResult({
        kind: 'live',
        run: { status: 'completed', conclusion: 'success' },
        publicState: partial,
        lastBoundary: 'any_public_side_effect',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).toBe('partial_publication_stop');
  });
});

describe('attempt planning and exact dispatch correlation', () => {
  it('plans one newer reviewed successor after the adopted failed predecessor', () => {
    expect(
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: V1_ADOPTED_ATTEMPTS,
        controllerSha: workflowSha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toMatchObject({
      action: 'dispatch',
      sequence: 3,
      predecessor_run_id: '33428076790',
    });
  });

  it('allows a successor after a conclusive pre-side-effect needs_review predecessor', () => {
    const preSideEffectNeedsReview = {
      ...V1_ADOPTED_ATTEMPTS[1],
      sequence: 3,
      predecessor_run_id: '33428076790',
      controller: { sha: 'c'.repeat(40), run_id: '33572211657', run_attempt: 1 },
      child: {
        sha: 'c'.repeat(40),
        run_id: '33573326601',
        run_attempt: 1,
        status: 'completed' as const,
        conclusion: 'failure' as const,
      },
      last_side_effect_boundary: 'preflight' as const,
      retry_classification: 'needs_review' as const,
      cleanup: { status: 'restored_and_verified' as const },
    };
    expect(
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [...V1_ADOPTED_ATTEMPTS, preSideEffectNeedsReview],
        controllerSha: workflowSha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toMatchObject({
      action: 'dispatch',
      sequence: 4,
      predecessor_run_id: '33573326601',
    });
  });

  it('allows a successor after a never-started child with unknown boundary and absent public state', () => {
    const neverStartedChild = {
      ...V1_ADOPTED_ATTEMPTS[1],
      sequence: 3,
      predecessor_run_id: '33428076790',
      controller: { sha: 'c'.repeat(40), run_id: '33572211657', run_attempt: 1 },
      child: {
        sha: 'c'.repeat(40),
        run_id: '33573326601',
        run_attempt: 1,
        status: 'completed' as const,
        conclusion: 'failure' as const,
      },
      last_side_effect_boundary: 'unknown' as const,
      retry_classification: 'needs_review' as const,
      cleanup: { status: 'restored_and_verified' as const },
    };
    expect(
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [...V1_ADOPTED_ATTEMPTS, neverStartedChild],
        controllerSha: workflowSha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toMatchObject({
      action: 'dispatch',
      sequence: 4,
      predecessor_run_id: '33573326601',
    });
  });

  it('allows retry after first-package PUT fails with absent public state (issue #227)', () => {
    const firstPackagePutFailure = {
      ...V1_ADOPTED_ATTEMPTS[1],
      sequence: 3,
      predecessor_run_id: '33428076790',
      controller: { sha: 'c'.repeat(40), run_id: '33587397236', run_attempt: 1 },
      child: {
        sha: 'c'.repeat(40),
        run_id: '33587397237',
        run_attempt: 1,
        status: 'completed' as const,
        conclusion: 'failure' as const,
      },
      last_side_effect_boundary: 'any_public_side_effect' as const,
      retry_classification: 'retryable_before_side_effects' as const,
      cleanup: { status: 'restored_and_verified' as const },
    };
    expect(
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [...V1_ADOPTED_ATTEMPTS, firstPackagePutFailure],
        controllerSha: workflowSha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toMatchObject({
      action: 'dispatch',
      sequence: 4,
      predecessor_run_id: '33587397237',
    });
  });

  it('stops on needs_review when not conclusively before public effects', () => {
    const unknownBoundaryWithPublicSideEffect = {
      ...V1_ADOPTED_ATTEMPTS[1],
      sequence: 3,
      predecessor_run_id: '33428076790',
      controller: { sha: 'c'.repeat(40), run_id: '99001', run_attempt: 1 },
      child: {
        sha: 'c'.repeat(40),
        run_id: '99002',
        run_attempt: 1,
        status: 'completed' as const,
        conclusion: 'failure' as const,
      },
      last_side_effect_boundary: 'unknown' as const,
      retry_classification: 'needs_review' as const,
      cleanup: { status: 'restored_and_verified' as const },
    };
    expect(
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [...V1_ADOPTED_ATTEMPTS, unknownBoundaryWithPublicSideEffect],
        controllerSha: workflowSha,
        publicState: completePublicState(),
        kind: 'live',
      }),
    ).toMatchObject({
      action: 'stop',
      result: 'needs_review',
      reason: 'ambiguous_predecessor',
    });

    const afterPublicSideEffect = {
      ...V1_ADOPTED_ATTEMPTS[1],
      sequence: 3,
      predecessor_run_id: '33428076790',
      controller: { sha: 'c'.repeat(40), run_id: '99003', run_attempt: 1 },
      child: {
        sha: 'c'.repeat(40),
        run_id: '99004',
        run_attempt: 1,
        status: 'completed' as const,
        conclusion: 'failure' as const,
      },
      last_side_effect_boundary: 'any_public_side_effect' as const,
      retry_classification: 'needs_review' as const,
      cleanup: { status: 'restored_and_verified' as const },
    };
    expect(
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [...V1_ADOPTED_ATTEMPTS, afterPublicSideEffect],
        controllerSha: workflowSha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toMatchObject({
      action: 'stop',
      result: 'needs_review',
      reason: 'ambiguous_predecessor',
    });
  });

  it('stops on indeterminate public state before checking unknown boundary', () => {
    const unknownBoundaryWithIndeterminateState = {
      ...V1_ADOPTED_ATTEMPTS[1],
      sequence: 3,
      predecessor_run_id: '33428076790',
      controller: { sha: 'c'.repeat(40), run_id: '99005', run_attempt: 1 },
      child: {
        sha: 'c'.repeat(40),
        run_id: '99006',
        run_attempt: 1,
        status: 'completed' as const,
        conclusion: 'failure' as const,
      },
      last_side_effect_boundary: 'unknown' as const,
      retry_classification: 'needs_review' as const,
      cleanup: { status: 'restored_and_verified' as const },
    };
    expect(
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [...V1_ADOPTED_ATTEMPTS, unknownBoundaryWithIndeterminateState],
        controllerSha: workflowSha,
        publicState: indeterminatePublicState(),
        kind: 'live',
      }),
    ).toMatchObject({
      action: 'stop',
      result: 'needs_review',
      reason: 'indeterminate_public_state',
    });
  });

  it('refuses a stale snapshot, active child, cleanup failure, mismatch, and duplicate lineage', () => {
    expect(
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: V1_ADOPTED_ATTEMPTS,
        controllerSha: V1_ADOPTED_ATTEMPTS[1].controller.sha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toMatchObject({ action: 'stop', reason: 'stale_snapshot' });

    const active = structuredClone(V1_ADOPTED_ATTEMPTS[1]);
    if (active.child === null) throw new Error('Expected adopted child fixture.');
    const activeChild = active.child as { status: string; conclusion: string | null };
    activeChild.status = 'in_progress';
    activeChild.conclusion = null;
    expect(
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [V1_ADOPTED_ATTEMPTS[0], active],
        controllerSha: workflowSha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toMatchObject({ action: 'monitor', run_id: '33428076790' });

    const dirty = { ...V1_ADOPTED_ATTEMPTS[1], cleanup: { status: 'failed' } };
    expect(
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [V1_ADOPTED_ATTEMPTS[0], dirty],
        controllerSha: workflowSha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toMatchObject({ action: 'stop', reason: 'cleanup_not_verified' });

    const mismatched = {
      ...V1_ADOPTED_ATTEMPTS[1],
      immutable_inputs_sha256: '0'.repeat(64),
    };
    expect(() =>
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [V1_ADOPTED_ATTEMPTS[0], mismatched],
        controllerSha: workflowSha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toThrow('exact immutable operation');

    expect(() =>
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [...V1_ADOPTED_ATTEMPTS, V1_ADOPTED_ATTEMPTS[1]],
        controllerSha: workflowSha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toThrow('missing or duplicate sequence');

    expect(() =>
      planReleaseAttempt({
        operation: V1_RELEASE_OPERATION,
        attempts: [V1_ADOPTED_ATTEMPTS[0], { ...V1_ADOPTED_ATTEMPTS[1], predecessor_run_id: '1' }],
        controllerSha: workflowSha,
        publicState: absentPublicState(),
        kind: 'live',
      }),
    ).toThrow('predecessor lineage');
  });

  it('uses the dispatch response run ID while name, actor, and input-derived title become visible', async () => {
    const expected = v1StableChildMetadata('9900208', workflowSha);
    const runs = [stableRun({ actor: null, triggering_actor: null }), stableRun()];
    const adapter = {
      getRun: vi
        .fn()
        .mockRejectedValueOnce(new Error('GitHub API returned HTTP 404.'))
        .mockImplementation(async () => runs.shift()),
    };
    await expect(
      waitForDurableRunMetadata({
        adapter,
        expected,
        maximumPolls: 3,
        pollIntervalMs: 0,
        sleep: async () => undefined,
      }),
    ).resolves.toMatchObject({ polls: 3, run: { id: 9900208 } });
    expect(adapter.getRun).toHaveBeenCalledTimes(3);
  });

  it('does not dispatch again when correlation metadata remains temporarily unavailable', async () => {
    const expected = v1StableChildMetadata('9900208', workflowSha);
    const adapter = {
      getRun: vi.fn(async () =>
        stableRun({
          display_title: '',
          head_branch: '',
          head_sha: '',
          actor: null,
          triggering_actor: null,
        }),
      ),
    };
    await expect(
      waitForDurableRunMetadata({
        adapter,
        expected,
        maximumPolls: 2,
        pollIntervalMs: 0,
        sleep: async () => undefined,
      }),
    ).resolves.toMatchObject({ result: 'needs_review', reason: 'correlation_timeout' });
    expect(adapter.getRun).toHaveBeenCalledTimes(2);
  });

  it('does not accept a completed run until its exact metadata is durable', async () => {
    const expected = v1StableChildMetadata('9900208', workflowSha);
    const runs = [
      stableRun({
        status: 'completed',
        conclusion: 'failure',
        actor: null,
        triggering_actor: null,
      }),
      stableRun({ status: 'completed', conclusion: 'failure' }),
    ];
    const adapter = { getRun: vi.fn(async () => runs.shift()) };
    await expect(
      monitorExactRun({
        adapter,
        expected,
        maximumPolls: 2,
        pollIntervalMs: 0,
        sleep: async () => undefined,
      }),
    ).resolves.toMatchObject({ polls: 2, run: { status: 'completed' } });
  });

  it('rejects mismatched metadata and malformed dispatch responses', () => {
    expect(() =>
      correlateDispatchedRun(
        stableRun({ head_sha: '0'.repeat(40) }),
        v1StableChildMetadata('9900208', workflowSha),
      ),
    ).toThrow('mismatched head_sha');
    expect(() => validateDispatchResponse({ workflow_run_id: 9900208 })).toThrow(
      'mismatched run URLs',
    );
  });

  it('allows recovery handoff title correlation with different workflow SHAs', () => {
    const altWorkflowSha = 'a'.repeat(40);
    const runWithAltSha = stableRun({
      display_title: `Breakdown Local v1.0.0 recovery handoff for workflow ${altWorkflowSha}`,
    });
    const expected = v1StableChildMetadata('9900208', workflowSha);
    expect(correlateDispatchedRun(runWithAltSha, expected)).toMatchObject({
      status: 'pending_metadata',
      missing: ['display_title'],
    });
    expect(
      correlateDispatchedRun(runWithAltSha, expected, { allowRecoveryHandoffTitle: true }),
    ).toMatchObject({ status: 'correlated', missing: [] });
  });

  it('allows recovery handoff title when actual child uses legacy title', () => {
    const runWithLegacyTitle = stableRun({
      display_title: V1_RELEASE_RECOVERY_POLICY.stablePublication.legacyTitle,
    });
    const expected = v1StableChildMetadata('9900208', workflowSha);
    expect(correlateDispatchedRun(runWithLegacyTitle, expected)).toMatchObject({
      status: 'pending_metadata',
      missing: ['display_title'],
    });
    expect(
      correlateDispatchedRun(runWithLegacyTitle, expected, { allowRecoveryHandoffTitle: true }),
    ).toMatchObject({ status: 'correlated', missing: [] });
  });

  it('allows recovery handoff title when expected is legacy but actual is recovery handoff', () => {
    const runWithRecoveryTitle = stableRun({
      display_title: `Breakdown Local v1.0.0 recovery handoff for workflow ${workflowSha}`,
    });
    const expectedWithLegacy = {
      ...v1StableChildMetadata('9900208', workflowSha),
      display_title: V1_RELEASE_RECOVERY_POLICY.stablePublication.legacyTitle,
    };
    expect(correlateDispatchedRun(runWithRecoveryTitle, expectedWithLegacy)).toMatchObject({
      status: 'pending_metadata',
      missing: ['display_title'],
    });
    expect(
      correlateDispatchedRun(runWithRecoveryTitle, expectedWithLegacy, {
        allowRecoveryHandoffTitle: true,
      }),
    ).toMatchObject({ status: 'correlated', missing: [] });
  });

  it('treats mismatched display_title as pending metadata rather than immediately throwing', () => {
    const runWithWrongTitle = stableRun({
      display_title: 'Some other title',
    });
    const expected = v1StableChildMetadata('9900208', workflowSha);
    expect(correlateDispatchedRun(runWithWrongTitle, expected)).toMatchObject({
      status: 'pending_metadata',
      missing: ['display_title'],
    });
  });

  it('treats mismatched display_title as pending even with allowRecoveryHandoffTitle', () => {
    const runWithWrongTitle = stableRun({
      display_title: 'Completely different title',
    });
    const expected = v1StableChildMetadata('9900208', workflowSha);
    expect(
      correlateDispatchedRun(runWithWrongTitle, expected, { allowRecoveryHandoffTitle: true }),
    ).toMatchObject({
      status: 'pending_metadata',
      missing: ['display_title'],
    });
  });

  it('waits and retries when display_title is pending at create time', async () => {
    let polls = 0;
    const getRun = vi.fn(() => {
      polls += 1;
      if (polls === 1) {
        return stableRun({ display_title: 'Temporary title not yet updated' });
      }
      return stableRun();
    });
    await expect(
      waitForDurableRunMetadata({
        adapter: { getRun },
        expected: v1StableChildMetadata('9900208', workflowSha),
        maximumPolls: 5,
        pollIntervalMs: 0,
        sleep: async () => undefined,
        allowRecoveryHandoffTitle: true,
      }),
    ).resolves.toMatchObject({ polls: 2 });
    expect(getRun).toHaveBeenCalledTimes(2);
  });
});

describe('controller and environment lifecycle', () => {
  class PolicyAdapter {
    policies: Array<{ id: number; name: string; type: string }>;
    nextId = 10;
    actions: string[] = [];

    constructor(policies: Array<{ id: number; name: string; type: string }>) {
      this.policies = structuredClone(policies);
    }

    async listPolicies() {
      return structuredClone(this.policies);
    }

    async deletePolicy(id: number) {
      this.actions.push(`delete:${id}`);
      this.policies = this.policies.filter((policy) => policy.id !== id);
      return { status: 204 };
    }

    async createPolicy(policy: { name: string; type: string }) {
      this.actions.push(`create:${policy.type}:${policy.name}`);
      const existing = this.policies.find((p) => p.name === policy.name && p.type === policy.type);
      if (existing) {
        return { status: 303, body: existing };
      }
      this.policies.push({ id: this.nextId, ...policy });
      this.nextId += 1;
      return { status: 200, body: this.policies[this.policies.length - 1] };
    }
  }

  it('enters bounded recovery state by adding main policy and restores by removing only main', async () => {
    const adapter = new PolicyAdapter([{ id: 1, name: 'breakdown-local-v*', type: 'tag' }]);
    await expect(enterV1RecoveryPolicy(adapter)).resolves.toMatchObject({
      status: 'recovery_policy_verified',
      after: [
        { name: 'breakdown-local-v*', type: 'tag' },
        { name: 'main', type: 'branch' },
      ],
      create_status: 200,
    });
    expect(adapter.actions).toEqual(['create:branch:main']);
    await expect(finalizeV1RecoveryPolicy(adapter)).resolves.toMatchObject({
      status: 'restored_and_verified',
      after: [{ name: 'breakdown-local-v*', type: 'tag' }],
      delete_status: 204,
    });
    expect(adapter.actions.slice(1)).toEqual(['delete:10']);
  });

  it('is idempotent for steady state and accepts operator-applied recovery state', async () => {
    const steady = new PolicyAdapter([{ id: 1, name: 'breakdown-local-v*', type: 'tag' }]);
    await expect(finalizeV1RecoveryPolicy(steady)).resolves.toMatchObject({ changed: false });
    await expect(enterV1RecoveryPolicy(steady)).resolves.toMatchObject({
      status: 'recovery_policy_verified',
      create_status: 200,
    });
    const operatorApplied = new PolicyAdapter([
      { id: 1, name: 'breakdown-local-v*', type: 'tag' },
      { id: 2, name: 'main', type: 'branch' },
    ]);
    await expect(enterV1RecoveryPolicy(operatorApplied)).resolves.toMatchObject({
      status: 'recovery_policy_verified',
      after: [
        { name: 'breakdown-local-v*', type: 'tag' },
        { name: 'main', type: 'branch' },
      ],
    });
    expect(operatorApplied.actions).toEqual([]);
    await expect(finalizeV1RecoveryPolicy(operatorApplied)).resolves.toMatchObject({
      status: 'restored_and_verified',
      after: [{ name: 'breakdown-local-v*', type: 'tag' }],
    });
    const unexpected = new PolicyAdapter([{ id: 1, name: 'main', type: 'branch' }]);
    await expect(finalizeV1RecoveryPolicy(unexpected)).rejects.toThrow(
      'refuses to mutate unexpected deployment policies',
    );
  });

  it('handles 403 on DELETE by verifying bounded recovery state remains stable', async () => {
    class Policy403Adapter extends PolicyAdapter {
      async deletePolicy(id: number) {
        this.actions.push(`delete:${id}`);
        return { status: 403 };
      }
    }
    const adapter = new Policy403Adapter([
      { id: 1, name: 'breakdown-local-v*', type: 'tag' },
      { id: 2, name: 'main', type: 'branch' },
    ]);
    await expect(finalizeV1RecoveryPolicy(adapter)).resolves.toMatchObject({
      status: 'delete_forbidden_recovery_state_stable',
      changed: false,
      delete_status: 403,
      main_policy_id: 2,
      after: [
        { name: 'breakdown-local-v*', type: 'tag' },
        { name: 'main', type: 'branch' },
      ],
    });
    expect(adapter.actions).toEqual(['delete:2']);
  });

  it('allows dispatch when pre-enter finalize gets 403 but recovery state is stable', async () => {
    class Policy403Adapter extends PolicyAdapter {
      deleteAttempts = 0;
      async deletePolicy(id: number) {
        this.deleteAttempts += 1;
        this.actions.push(`delete:${id}`);
        return { status: 403 };
      }
    }
    const adapter = new Policy403Adapter([
      { id: 1, name: 'breakdown-local-v*', type: 'tag' },
      { id: 2, name: 'main', type: 'branch' },
    ]);
    await expect(runWithV1RecoveryPolicy(adapter, async () => 'dispatched')).resolves.toMatchObject(
      {
        outcome: 'dispatched',
        cleanup: { status: 'delete_forbidden_recovery_state_stable' },
      },
    );
    expect(adapter.deleteAttempts).toBe(2);
    expect(await adapter.listPolicies()).toEqual([
      { id: 1, name: 'breakdown-local-v*', type: 'tag' },
      { id: 2, name: 'main', type: 'branch' },
    ]);
  });

  it.each(['success', 'failure', 'cancellation', 'timeout', 'lost correlation'])(
    'restores and verifies policy after %s',
    async (outcome) => {
      const adapter = new PolicyAdapter([{ id: 1, name: 'breakdown-local-v*', type: 'tag' }]);
      if (outcome === 'success') {
        await expect(runWithV1RecoveryPolicy(adapter, async () => outcome)).resolves.toMatchObject({
          outcome,
          cleanup: { status: 'restored_and_verified' },
        });
      } else {
        await expect(
          runWithV1RecoveryPolicy(adapter, async () => {
            throw new Error(outcome);
          }),
        ).rejects.toThrow(outcome);
      }
      expect(await adapter.listPolicies()).toEqual([
        { id: 1, name: 'breakdown-local-v*', type: 'tag' },
      ]);
    },
  );

  it('dispatches exactly once, correlates by returned ID, and classifies the failed child', async () => {
    const runQueue = [
      stableRun({ display_title: '', actor: null, triggering_actor: null }),
      stableRun(),
      stableRun({ status: 'completed', conclusion: 'failure' }),
    ];
    const policyAdapter = new PolicyAdapter([{ id: 1, name: 'breakdown-local-v*', type: 'tag' }]);
    const adapter = {
      readPublicState: vi.fn(async () => absentPublicState()),
      listWorkflowRuns: vi.fn(async () => []),
      dispatchWorkflow: vi.fn(async () => ({
        workflow_run_id: 9900208,
        run_url: 'https://api.github.com/repos/alamorre/breakdown.sh/actions/runs/9900208',
        html_url: 'https://github.com/alamorre/breakdown.sh/actions/runs/9900208',
      })),
      getRun: vi.fn(async () => runQueue.shift()),
      getJobs: vi.fn(async () => [
        {
          steps: [
            { name: 'Retain the complete pre-publication gate evidence', conclusion: 'success' },
            {
              name: 'Create the complete GitHub draft',
              conclusion: 'skipped',
              status: 'completed',
            },
          ],
        },
      ]),
      downloadFailureEvidence: vi.fn(async () => ({
        failed_steps: ['fixture failure'],
        retained_artifacts: ['diagnostics'],
      })),
      listPolicies: vi.fn(async () => policyAdapter.listPolicies()),
      deletePolicy: vi.fn(async (id: number) => policyAdapter.deletePolicy(id)),
      createPolicy: vi.fn(async (policy: { name: string; type: string }) =>
        policyAdapter.createPolicy(policy),
      ),
    };
    await expect(
      runV1HostedController({
        adapter,
        controller: { sha: workflowSha, run_id: '9900207', run_attempt: 1 },
        correlationPolls: 2,
        monitorPolls: 1,
        pollIntervalMs: 0,
        sleep: async () => undefined,
      }),
    ).resolves.toMatchObject({
      action: 'complete_attempt',
      result: 'retryable_before_side_effects',
      attempt: {
        sequence: 3,
        child: { run_id: '9900208' },
        last_side_effect_boundary: 'live_prepublication',
      },
      cleanup: { status: 'restored_and_verified' },
    });
    expect(adapter.dispatchWorkflow).toHaveBeenCalledTimes(1);
    expect(policyAdapter.actions).toEqual(['create:branch:main', 'delete:10']);
  });

  it('discovers and monitors the returned child while its input-derived title is still missing', async () => {
    const pending = stableRun({
      display_title: '',
      actor: null,
      triggering_actor: null,
      status: 'in_progress',
    });
    const policyAdapter = new PolicyAdapter([{ id: 1, name: 'breakdown-local-v*', type: 'tag' }]);
    const adapter = {
      readPublicState: vi.fn(async () => absentPublicState()),
      listWorkflowRuns: vi.fn(async () => [pending]),
      dispatchWorkflow: vi.fn(),
      getRun: vi.fn(async () => stableRun({ status: 'completed', conclusion: 'failure' })),
      getJobs: vi.fn(async () => [
        {
          steps: [
            { name: 'Retain the complete pre-publication gate evidence', conclusion: 'success' },
          ],
        },
      ]),
      downloadFailureEvidence: vi.fn(async () => ({
        failed_steps: ['fixture failure'],
        retained_artifacts: [],
      })),
      listPolicies: vi.fn(async () => policyAdapter.listPolicies()),
      deletePolicy: vi.fn(async (id: number) => policyAdapter.deletePolicy(id)),
      createPolicy: vi.fn(async (policy: { name: string; type: string }) =>
        policyAdapter.createPolicy(policy),
      ),
    };
    await expect(
      runV1HostedController({
        adapter,
        controller: { sha: workflowSha, run_id: '9900209', run_attempt: 1 },
        correlationPolls: undefined,
        monitorPolls: 1,
        pollIntervalMs: 0,
        sleep: async () => undefined,
      }),
    ).resolves.toMatchObject({
      action: 'complete_attempt',
      result: 'retryable_before_side_effects',
      run: { run_id: '9900208' },
    });
    expect(adapter.dispatchWorkflow).not.toHaveBeenCalled();
  });

  it('reclassifies the outer controller from the exact durable child and public state', async () => {
    const child = stableRun({ status: 'completed', conclusion: 'failure' });
    const adapter = {
      readPublicState: vi.fn(async () => absentPublicState()),
      listWorkflowRuns: vi.fn(async () => [child]),
      getJobs: vi.fn(async () => [
        {
          steps: [
            { name: 'Retain the complete pre-publication gate evidence', conclusion: 'success' },
            {
              name: 'Create the complete GitHub draft',
              status: 'completed',
              conclusion: 'skipped',
            },
          ],
        },
      ]),
    };
    await expect(
      inspectV1StableOutcome({
        adapter,
        workflowSha,
        controllerConclusion: 'failure',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).resolves.toMatchObject({
      result: 'retryable_before_side_effects',
      run_id: '9900208',
      last_side_effect_boundary: 'live_prepublication',
    });

    adapter.readPublicState.mockResolvedValueOnce(completePublicState());
    await expect(
      inspectV1StableOutcome({
        adapter,
        workflowSha,
        controllerConclusion: 'failure',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).resolves.toMatchObject({ result: 'partial_publication_stop' });
  });

  it('never calls a missing or active exact child retryable', async () => {
    const adapter = {
      readPublicState: vi.fn(async () => absentPublicState()),
      listWorkflowRuns: vi.fn(async () => [stableRun({ status: 'in_progress' })]),
    };
    await expect(
      inspectV1StableOutcome({
        adapter,
        workflowSha,
        controllerConclusion: 'failure',
        cleanup: { status: 'restored_and_verified' },
      }),
    ).resolves.toMatchObject({ result: 'needs_review', reason: 'active_child' });

    adapter.listWorkflowRuns.mockResolvedValueOnce([]);
    await expect(
      inspectV1StableOutcome({
        adapter,
        workflowSha,
        controllerConclusion: null,
        cleanup: { status: 'restored_and_verified' },
      }),
    ).resolves.toMatchObject({ result: 'needs_review', reason: 'child_run_not_durable' });
  });
});

describe('shared hermetic rehearsal and redaction', () => {
  it('replaces the stable rg gate with the same signed-tag verifier used by rehearsal', async () => {
    const fixture = JSON.parse(
      await readFile(join(import.meta.dirname, 'fixtures/rehearsal-v1.json'), 'utf8'),
    );
    expect(
      createSignedTagEvidence({
        tagObject: fixture.github.tag_object,
        expected: fixture.github.tag_expectation,
        signer: fixture.github.signer,
        gitsignVerificationLog: fixture.github.gitsign_log,
        controls: fixture.github.controls,
      }),
    ).toMatchObject({
      verification: { verified: true },
      protection: { ruleset_id: 20015652 },
    });
    expect(() =>
      createSignedTagEvidence({
        tagObject: {
          ...fixture.github.tag_object,
          message: fixture.github.tag_object.message.replace(
            'candidate-artifact-id: 9413780200',
            'candidate-artifact-id: 1',
          ),
        },
        expected: fixture.github.tag_expectation,
        signer: fixture.github.signer,
        gitsignVerificationLog: fixture.github.gitsign_log,
        controls: fixture.github.controls,
      }),
    ).toThrow('candidate-artifact-id');
  });

  it('detects rg and every audited undeclared workflow tool', () => {
    expect(() => auditWorkflowToolInventory('run: rg needle file')).toThrow('undeclared');
    expect(() => auditWorkflowToolInventory('run: python unsafe.py')).toThrow('undeclared');
  });

  it('runs the complete fixture gate and never executes publication commands', async () => {
    const fixture = JSON.parse(
      await readFile(join(import.meta.dirname, 'fixtures/rehearsal-v1.json'), 'utf8'),
    );
    const workflows = {
      recovery: await readFile(
        join(repositoryRoot, '.github/workflows/local-v1-release-recovery.yml'),
        'utf8',
      ),
      stable: await readFile(
        join(repositoryRoot, '.github/workflows/local-stable-publication.yml'),
        'utf8',
      ),
    };
    expect(
      runReleaseRehearsal({
        fixture,
        scenario: 'pass',
        workflowSha,
        controllerRunId: '9900207',
        workflows,
      }),
    ).toMatchObject({
      result: 'complete',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      adopted_predecessor_run: '33428076790',
      correlation: { snapshots: ['pending_metadata', 'pending_metadata', 'correlated'] },
      gates: {
        final_prepublication_boundary: true,
        publication_commands_executed: false,
      },
      attempt: { sequence: 3, kind: 'rehearsal' },
    });
  });

  it('redacts credentials from retained logs and evidence', () => {
    const sanitized = sanitizeReleaseDiagnostics({
      message: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456',
      npm_token: 'npm_abcdefghijklmnopqrstuvwxyz123456',
      nested: { password: 'do-not-retain' },
    });
    expect(JSON.stringify(sanitized)).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(sanitized).toMatchObject({
      redacted_field_1: '[REDACTED]',
      nested: { redacted_field_0: '[REDACTED]' },
    });
  });

  it('keeps every controller result in the documented machine-readable vocabulary', () => {
    expect(RELEASE_OPERATION_RESULTS).toEqual([
      'rehearsal_failed',
      'retryable_before_side_effects',
      'needs_review',
      'partial_publication_stop',
      'complete',
    ]);
  });

  it('recognizes publication steps as terminal even when a command fails mid-step', () => {
    expect(
      inferSideEffectBoundary([
        {
          steps: [
            {
              name: 'Create the three first npm package records with the one-time credential',
              status: 'completed',
              conclusion: 'failure',
            },
          ],
        },
      ]),
    ).toBe('any_public_side_effect');
  });

  it('classifies v1 resumable mixed state (core present, cli/mcp absent) as partial_publication_stop', () => {
    const mixedState = {
      github_release: { status: 'absent', http_status: 404 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'present', http_status: 200 },
        '@breakdown-sh/cli': { status: 'absent', http_status: 404 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    };

    // Classification remains partial_publication_stop, but planner allows continuation
    const result = classifyRunResult({
      kind: 'live',
      run: { status: 'completed', conclusion: 'failure' },
      publicState: mixedState,
      lastBoundary: 'any_public_side_effect',
      cleanup: { status: 'restored_and_verified' },
    });

    expect(result).toBe('partial_publication_stop');
  });

  it('planner allows continuation when resumable mixed state is detected', () => {
    const mixedState = {
      github_release: { status: 'absent', http_status: 404 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'present', http_status: 200 },
        '@breakdown-sh/cli': { status: 'absent', http_status: 404 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    };

    const attemptWithPartialStop = {
      schema_version: 'breakdown.release-operation-attempt.v1',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
      immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
      sequence: 1,
      kind: 'live',
      controller: { sha: workflowSha, run_id: '33661304845', run_attempt: 1 },
      child: { sha: workflowSha, run_id: '33661304845', run_attempt: 1, status: 'completed', conclusion: 'failure' },
      predecessor_run_id: null,
      public_state_preflight: 'absent',
      last_side_effect_boundary: 'any_public_side_effect',
      conclusion: 'failure',
      retry_classification: 'partial_publication_stop',
      cleanup: { status: 'restored_and_verified' },
      diagnostics: {},
    };

    const plan = planReleaseAttempt({
      operation: V1_RELEASE_OPERATION,
      attempts: [attemptWithPartialStop],
      controllerSha: 'c'.repeat(40),
      publicState: mixedState,
      kind: 'live',
    });

    // Should allow dispatch rather than stopping
    expect(plan.action).toBe('dispatch');
    expect(plan.sequence).toBe(2);
  });

  it('planner stops when partial_publication_stop and state is not resumable', () => {
    const nonResumableState = {
      github_release: { status: 'absent', http_status: 404 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'present', http_status: 200 },
        '@breakdown-sh/cli': { status: 'present', http_status: 200 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    };

    const attemptWithPartialStop = {
      schema_version: 'breakdown.release-operation-attempt.v1',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
      immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
      sequence: 1,
      kind: 'live',
      controller: { sha: workflowSha, run_id: '33661304845', run_attempt: 1 },
      child: { sha: workflowSha, run_id: '33661304845', run_attempt: 1, status: 'completed', conclusion: 'failure' },
      predecessor_run_id: null,
      public_state_preflight: 'absent',
      last_side_effect_boundary: 'any_public_side_effect',
      conclusion: 'failure',
      retry_classification: 'partial_publication_stop',
      cleanup: { status: 'restored_and_verified' },
      diagnostics: {},
    };

    const plan = planReleaseAttempt({
      operation: V1_RELEASE_OPERATION,
      attempts: [attemptWithPartialStop],
      controllerSha: 'c'.repeat(40),
      publicState: nonResumableState,
      kind: 'live',
    });

    expect(plan.action).toBe('stop');
    expect(plan.result).toBe('partial_publication_stop');
    expect(plan.reason).toBe('terminal_predecessor');
  });

  it('inspectV1StableOutcome returns retryable for resumable mixed state', async () => {
    const mixedState = {
      github_release: { status: 'absent', http_status: 404 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'present', http_status: 200 },
        '@breakdown-sh/cli': { status: 'absent', http_status: 404 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    };

    const adapter = {
      async readPublicState() {
        return mixedState;
      },
      async listWorkflowRuns() {
        return [];
      },
    };

    const outcome = await inspectV1StableOutcome({
      adapter,
      workflowSha,
      controllerConclusion: 'failure',
      cleanup: { status: 'restored_and_verified' },
    });

    expect(outcome).toMatchObject({
      result: 'retryable_before_side_effects',
      reason: 'v1_resumable_mixed_state_core_present_cli_mcp_absent',
      last_side_effect_boundary: 'preflight',
    });
  });

  it('planner allows continuation past needs_review predecessor when resumable mixed state is detected', () => {
    const mixedState = {
      github_release: { status: 'absent', http_status: 404 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'present', http_status: 200 },
        '@breakdown-sh/cli': { status: 'absent', http_status: 404 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    };

    const attemptWithNeedsReview = {
      schema_version: 'breakdown.release-operation-attempt.v1',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
      immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
      sequence: 1,
      kind: 'live',
      controller: { sha: workflowSha, run_id: '33684406601', run_attempt: 1 },
      child: null,
      predecessor_run_id: null,
      public_state_preflight: 'absent',
      last_side_effect_boundary: 'any_public_side_effect',
      conclusion: 'failure',
      retry_classification: 'needs_review',
      cleanup: { status: 'restored_and_verified' },
      diagnostics: {},
    };

    const plan = planReleaseAttempt({
      operation: V1_RELEASE_OPERATION,
      attempts: [attemptWithNeedsReview],
      controllerSha: 'c'.repeat(40),
      publicState: mixedState,
      kind: 'live',
    });

    // Should allow dispatch rather than stopping with ambiguous_predecessor
    expect(plan.action).toBe('dispatch');
    expect(plan.sequence).toBe(2);
  });

  it('planner stops on needs_review predecessor when state is not resumable', () => {
    const nonResumableState = {
      github_release: { status: 'absent', http_status: 404 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'present', http_status: 200 },
        '@breakdown-sh/cli': { status: 'present', http_status: 200 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    };

    const attemptWithNeedsReview = {
      schema_version: 'breakdown.release-operation-attempt.v1',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
      immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
      sequence: 1,
      kind: 'live',
      controller: { sha: workflowSha, run_id: '33684406601', run_attempt: 1 },
      child: null,
      predecessor_run_id: null,
      public_state_preflight: 'absent',
      last_side_effect_boundary: 'any_public_side_effect',
      conclusion: 'failure',
      retry_classification: 'needs_review',
      cleanup: { status: 'restored_and_verified' },
      diagnostics: {},
    };

    const plan = planReleaseAttempt({
      operation: V1_RELEASE_OPERATION,
      attempts: [attemptWithNeedsReview],
      controllerSha: 'c'.repeat(40),
      publicState: nonResumableState,
      kind: 'live',
    });

    expect(plan.action).toBe('stop');
    expect(plan.result).toBe('needs_review');
    expect(plan.reason).toBe('ambiguous_predecessor');
  });

  it('planner stops on needs_review predecessor when public state is indeterminate', () => {
    const indeterminateState = {
      github_release: { status: 'indeterminate', http_status: 500 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'present', http_status: 200 },
        '@breakdown-sh/cli': { status: 'absent', http_status: 404 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    };

    const attemptWithNeedsReview = {
      schema_version: 'breakdown.release-operation-attempt.v1',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
      immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
      sequence: 1,
      kind: 'live',
      controller: { sha: workflowSha, run_id: '33684406601', run_attempt: 1 },
      child: null,
      predecessor_run_id: null,
      public_state_preflight: 'absent',
      last_side_effect_boundary: 'any_public_side_effect',
      conclusion: 'failure',
      retry_classification: 'needs_review',
      cleanup: { status: 'restored_and_verified' },
      diagnostics: {},
    };

    const plan = planReleaseAttempt({
      operation: V1_RELEASE_OPERATION,
      attempts: [attemptWithNeedsReview],
      controllerSha: 'c'.repeat(40),
      publicState: indeterminateState,
      kind: 'live',
    });

    // Should stop because indeterminate state is detected first
    expect(plan.action).toBe('stop');
    expect(plan.result).toBe('needs_review');
    expect(plan.reason).toBe('indeterminate_public_state');
  });

  it('planner allows continuation on needs_review with unknown boundary when public is v1 resumable mixed (issue #241)', () => {
    const mixedState = {
      github_release: { status: 'absent', http_status: 404 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'present', http_status: 200 },
        '@breakdown-sh/cli': { status: 'absent', http_status: 404 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    };

    const attemptWithUnknownBoundary = {
      schema_version: 'breakdown.release-operation-attempt.v1',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
      immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
      sequence: 1,
      kind: 'live',
      controller: { sha: workflowSha, run_id: '33684406601', run_attempt: 1 },
      child: null,
      predecessor_run_id: null,
      public_state_preflight: 'absent',
      last_side_effect_boundary: 'unknown',
      conclusion: 'failure',
      retry_classification: 'needs_review',
      cleanup: { status: 'restored_and_verified' },
      diagnostics: {},
    };

    const plan = planReleaseAttempt({
      operation: V1_RELEASE_OPERATION,
      attempts: [attemptWithUnknownBoundary],
      controllerSha: 'c'.repeat(40),
      publicState: mixedState,
      kind: 'live',
    });

    // Issue #241: Should allow dispatch because unknown boundary + v1 resumable mixed state is safe
    expect(plan.action).toBe('dispatch');
    expect(plan.sequence).toBe(2);
  });

  it('planner still stops on needs_review with unknown boundary when public is not the exact v1 resumable mixed pattern', () => {
    const nonResumableMixedState = {
      github_release: { status: 'absent', http_status: 404 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'present', http_status: 200 },
        '@breakdown-sh/cli': { status: 'present', http_status: 200 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    };

    const attemptWithUnknownBoundary = {
      schema_version: 'breakdown.release-operation-attempt.v1',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
      immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
      sequence: 1,
      kind: 'live',
      controller: { sha: workflowSha, run_id: '33684406602', run_attempt: 1 },
      child: null,
      predecessor_run_id: null,
      public_state_preflight: 'absent',
      last_side_effect_boundary: 'unknown',
      conclusion: 'failure',
      retry_classification: 'needs_review',
      cleanup: { status: 'restored_and_verified' },
      diagnostics: {},
    };

    const plan = planReleaseAttempt({
      operation: V1_RELEASE_OPERATION,
      attempts: [attemptWithUnknownBoundary],
      controllerSha: 'c'.repeat(40),
      publicState: nonResumableMixedState,
      kind: 'live',
    });

    // Should still stop because the public state doesn't match the exact v1 resumable pattern
    expect(plan.action).toBe('stop');
    expect(plan.result).toBe('needs_review');
    expect(plan.reason).toBe('ambiguous_predecessor');
  });

  it('planner allows continuation when partial_publication_stop at preflight with public_side_effect stamped but current state is v1 resumable mixed (issue #251)', () => {
    const mixedState = {
      github_release: { status: 'absent', http_status: 404 },
      npm_packages: {
        '@breakdown-sh/core': { status: 'present', http_status: 200 },
        '@breakdown-sh/cli': { status: 'absent', http_status: 404 },
        '@breakdown-sh/mcp': { status: 'absent', http_status: 404 },
      },
    };

    const attemptWithPartialStopPreflight = {
      schema_version: 'breakdown.release-operation-attempt.v1',
      operation_id: V1_RELEASE_OPERATION.operation_id,
      immutable_inputs_sha256: V1_RELEASE_OPERATION.immutable_inputs_sha256,
      immutable_inputs: V1_RELEASE_OPERATION.immutable_inputs,
      sequence: 1,
      kind: 'live',
      controller: { sha: workflowSha, run_id: '33688130173', run_attempt: 1 },
      child: {
        sha: workflowSha,
        run_id: '33688130173',
        run_attempt: 1,
        status: 'completed',
        conclusion: 'failure',
      },
      predecessor_run_id: null,
      public_state_preflight: 'public_side_effect',
      last_side_effect_boundary: 'preflight',
      conclusion: 'failure',
      retry_classification: 'partial_publication_stop',
      cleanup: { status: 'restored_and_verified' },
      diagnostics: {},
    };

    const plan = planReleaseAttempt({
      operation: V1_RELEASE_OPERATION,
      attempts: [attemptWithPartialStopPreflight],
      controllerSha: 'c'.repeat(40),
      publicState: mixedState,
      kind: 'live',
    });

    expect(plan.action).toBe('dispatch');
    expect(plan.sequence).toBe(2);
  });
});

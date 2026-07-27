import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  operate,
  type NonSuccessfulCandidateOutcome,
  type SuccessfulCandidateOutcome,
  type WorkPacket,
} from './index.js';

const projects: string[] = [];

async function createProject(workflow: string) {
  const project = await mkdtemp(join(tmpdir(), 'breakdown-submit-'));
  projects.push(project);
  await writeFile(join(project, 'breakdown.yaml'), workflow, 'utf8');
  const created = await operate(
    { operation: 'create_run' },
    {
      projectRoot: project,
      testControls: {
        now: () => new Date('2026-07-27T18:00:00.000Z'),
        randomBytes: () => Buffer.alloc(8),
      },
    },
  );
  if (!created.ok) throw new Error(created.failure.code);
  return { project, runId: created.value.run_id };
}

async function prepare(project: string, runId: string) {
  const prepared = await operate(
    { operation: 'prepare_work', run_id: runId, limit: 1 },
    {
      projectRoot: project,
      testControls: { now: () => new Date('2026-07-27T18:01:00.000Z') },
    },
  );
  if (!prepared.ok) throw new Error(prepared.failure.code);
  const packet = prepared.value.packets[0];
  if (packet === undefined) throw new Error('No Work Packet was prepared.');
  return packet;
}

function successfulCandidate(
  packet: WorkPacket,
  markdown = 'Candidate Result',
): SuccessfulCandidateOutcome {
  return {
    schema_version: 'breakdown.candidate.v1',
    submission: packet.submission,
    status: 'succeeded',
    executor: {
      kind: 'program',
      name: 'test-executor',
    },
    markdown,
  };
}

function nonSuccessfulCandidate(
  packet: WorkPacket,
  status: NonSuccessfulCandidateOutcome['status'],
): NonSuccessfulCandidateOutcome {
  return {
    schema_version: 'breakdown.candidate.v1',
    submission: packet.submission,
    status,
    executor: {
      kind: 'program',
      name: 'test-executor',
    },
    markdown: `${status} diagnostic`,
    problem: {
      code: `executor_${status}`,
      message: `The Executor reported ${status}.`,
    },
  };
}

afterEach(async () => {
  await Promise.all(
    projects.splice(0).map((project) => rm(project, { recursive: true, force: true })),
  );
});

describe('submit_candidate', () => {
  it('publishes the strict settled Candidate Outcome contract', async () => {
    const schema = JSON.parse(
      await readFile(
        new URL(
          '../../../local/contracts/schemas/breakdown.candidate.v1.schema.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      additionalProperties: boolean;
      allOf: unknown[];
      required: string[];
      oneOf: [
        {
          properties: { status: { const: string } };
          not: { required: string[] };
        },
        {
          required: string[];
          properties: { status: { enum: string[] } };
          not: { required: string[] };
        },
      ];
      properties: {
        json: Record<string, never>;
        problem: { $ref: string };
        status: { enum: string[] };
        submission: {
          additionalProperties: boolean;
          required: string[];
          properties: {
            refresh_base: { $ref: string };
          };
        };
      };
    };

    expect(schema).toMatchObject({
      additionalProperties: false,
      allOf: expect.any(Array),
      required: ['schema_version', 'submission', 'status', 'executor', 'markdown'],
      oneOf: [
        {
          properties: { status: { const: 'succeeded' } },
          not: { required: ['problem'] },
        },
        {
          required: ['problem'],
          properties: { status: { enum: ['failed', 'blocked', 'cancelled'] } },
          not: { required: ['json'] },
        },
      ],
      properties: {
        json: {},
        problem: { $ref: '#/$defs/problem' },
        status: { enum: ['succeeded', 'failed', 'blocked', 'cancelled'] },
        submission: {
          additionalProperties: false,
          required: [
            'run_id',
            'node_id',
            'intent',
            'prepared_at',
            'expected_attempt',
            'context_sha256',
          ],
          properties: {
            refresh_base: { $ref: '#/$defs/selectedResult' },
          },
        },
      },
    });
  });

  it('publishes an authoritative successful Markdown Result and advances the Run', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: submit-markdown
name: Submit Markdown
nodes:
  - id: produce
    name: Produce
    prompt: Produce Markdown.
  - id: consume
    name: Consume
    prompt: Consume the Result.
    inputs:
      source:
        node: produce
`);
    const packet = await prepare(project, runId);

    const submitted = await operate(
      {
        operation: 'submit_candidate',
        packet,
        candidate: {
          schema_version: 'breakdown.candidate.v1',
          submission: packet.submission,
          status: 'succeeded',
          executor: {
            kind: 'agent',
            name: 'Codex',
            version: '1.2.3',
            model: 'example-model',
          },
          markdown: '# Result\n\nExact candidate bytes.\n',
        },
      },
      {
        projectRoot: project,
        testControls: {
          now: () => new Date('2026-07-27T18:02:00.000Z'),
          randomBytes: () => Buffer.alloc(8, 1),
        },
      },
    );

    expect(submitted).toMatchObject({
      ok: true,
      value: {
        run_id: runId,
        node_id: 'produce',
        attempt: 1,
        status: 'succeeded',
        started_at: '2026-07-27T18:01:00.000Z',
        settled_at: '2026-07-27T18:02:00.000Z',
        context_sha256: packet.context_sha256,
        result: {
          markdown: {
            path: `outputs/${runId}/steps/20260727T180200.000Z--produce--a1.md`,
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
          json: null,
        },
      },
    });
    if (!submitted.ok) throw new Error(submitted.failure.code);
    expect((await stat(join(project, submitted.value.result.markdown.path))).mode & 0o777).toBe(
      0o600,
    );

    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        status: 'incomplete',
        nodes: [
          { node_id: 'produce', state: 'complete', next_attempt: 2 },
          { node_id: 'consume', state: 'runnable', next_attempt: 1 },
        ],
      },
    });

    const consumePacket = await prepare(project, runId);
    expect(consumePacket.node.id).toBe('consume');
    expect(consumePacket.inputs.source?.result).toMatchObject({
      node_id: 'produce',
      attempt: 1,
      markdown: submitted.value.result.markdown,
    });
    const committedMarkdown = await readFile(
      join(project, submitted.value.result.markdown.path),
      'utf8',
    );
    expect(committedMarkdown).toContain(`"context_sha256": "${packet.context_sha256}"`);
    expect(committedMarkdown).toContain(
      '"executor": {\n    "kind": "agent",\n    "name": "Codex",\n    "version": "1.2.3",\n    "model": "example-model"\n  }',
    );
    expect(committedMarkdown).toMatch(/---\n# Result\n\nExact candidate bytes\.\n$/);
  });

  it('should refresh identical Markdown and recompute consuming descendants from new provenance', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: refresh-provenance
name: Refresh Provenance
nodes:
  - id: gather
    name: Gather
    prompt: Gather evidence.
  - id: synthesize
    name: Synthesize
    prompt: Synthesize the evidence.
    inputs:
      evidence:
        node: gather
  - id: publish
    name: Publish
    prompt: Publish the synthesis.
    inputs:
      synthesis:
        node: synthesize
`);
    const prepareAt = async (
      preparedAt: string,
      options: { intent?: 'resume' | 'refresh'; node_id?: string } = {},
    ) => {
      const prepared = await operate(
        {
          operation: 'prepare_work',
          run_id: runId,
          limit: 1,
          ...options,
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date(preparedAt) },
        },
      );
      if (!prepared.ok) throw new Error(prepared.failure.code);
      const packet = prepared.value.packets[0];
      if (packet === undefined) throw new Error('No Work Packet was prepared.');
      return packet;
    };
    const submitAt = async (packet: WorkPacket, markdown: string, settledAt: string) =>
      operate(
        {
          operation: 'submit_candidate',
          packet,
          candidate: successfulCandidate(packet, markdown),
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date(settledAt) },
        },
      );

    const gatherOne = await prepareAt('2026-07-27T18:01:00.000Z');
    expect(
      await submitAt(gatherOne, 'unchanged evidence', '2026-07-27T18:02:00.000Z'),
    ).toMatchObject({ ok: true, value: { node_id: 'gather', attempt: 1 } });
    const synthesizeOne = await prepareAt('2026-07-27T18:03:00.000Z');
    expect(synthesizeOne.inputs.evidence?.result?.attempt).toBe(1);
    expect(
      await submitAt(synthesizeOne, 'unchanged synthesis', '2026-07-27T18:04:00.000Z'),
    ).toMatchObject({ ok: true, value: { node_id: 'synthesize', attempt: 1 } });
    const publishOne = await prepareAt('2026-07-27T18:05:00.000Z');
    expect(publishOne.inputs.synthesis?.result?.attempt).toBe(1);
    expect(
      await submitAt(publishOne, 'unchanged publication', '2026-07-27T18:06:00.000Z'),
    ).toMatchObject({ ok: true, value: { node_id: 'publish', attempt: 1 } });

    const refresh = await prepareAt('2026-07-27T18:07:00.000Z', {
      intent: 'refresh',
      node_id: 'gather',
    });
    expect(refresh.refresh_base).toMatchObject({ node_id: 'gather', attempt: 1 });
    expect(await submitAt(refresh, 'unchanged evidence', '2026-07-27T18:08:00.000Z')).toMatchObject(
      { ok: true, value: { node_id: 'gather', attempt: 2 } },
    );

    const afterRefresh = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(afterRefresh).toMatchObject({
      ok: true,
      value: {
        status: 'incomplete',
        nodes: [
          { node_id: 'gather', state: 'complete', selected_result: { attempt: 2 } },
          { node_id: 'synthesize', state: 'runnable', stale: true, next_attempt: 2 },
          { node_id: 'publish', state: 'blocked', next_attempt: 2 },
        ],
        terminal_results: [],
      },
    });

    const synthesizeTwo = await prepareAt('2026-07-27T18:09:00.000Z');
    expect(synthesizeTwo.node.id).toBe('synthesize');
    expect(synthesizeTwo.inputs.evidence?.result?.attempt).toBe(2);
    expect(
      await submitAt(synthesizeTwo, 'unchanged synthesis', '2026-07-27T18:10:00.000Z'),
    ).toMatchObject({ ok: true, value: { node_id: 'synthesize', attempt: 2 } });

    const publishTwo = await prepareAt('2026-07-27T18:11:00.000Z');
    expect(publishTwo.node.id).toBe('publish');
    expect(publishTwo.inputs.synthesis?.result?.attempt).toBe(2);
    expect(
      await submitAt(publishTwo, 'unchanged publication', '2026-07-27T18:12:00.000Z'),
    ).toMatchObject({ ok: true, value: { node_id: 'publish', attempt: 2 } });

    const complete = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(complete).toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        nodes: [
          { node_id: 'gather', selected_result: { attempt: 2 } },
          { node_id: 'synthesize', selected_result: { attempt: 2 } },
          { node_id: 'publish', selected_result: { attempt: 2 } },
        ],
        terminal_results: [{ node_id: 'publish', attempt: 2 }],
      },
    });
  });

  it('should refresh a contracted Markdown-plus-JSON Result as one selected provenance', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: refresh-contracted
name: Refresh Contracted
nodes:
  - id: measure
    name: Measure
    prompt: Produce a measurement.
    data_contract:
      type: object
      required: [value]
      properties:
        value:
          type: integer
      additionalProperties: false
`);
    const initialPacket = await prepare(project, runId);
    const initial = await operate(
      {
        operation: 'submit_candidate',
        packet: initialPacket,
        candidate: { ...successfulCandidate(initialPacket, 'measurement'), json: { value: 1 } },
      },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
      },
    );
    expect(initial).toMatchObject({
      ok: true,
      value: { attempt: 1, result: { json: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } } },
    });

    const prepared = await operate(
      {
        operation: 'prepare_work',
        run_id: runId,
        intent: 'refresh',
        node_id: 'measure',
        limit: 1,
      },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:03:00.000Z') },
      },
    );
    if (!prepared.ok) throw new Error(prepared.failure.code);
    const refreshPacket = prepared.value.packets[0];
    if (refreshPacket === undefined) throw new Error('No refresh packet was prepared.');
    expect(refreshPacket.refresh_base).toMatchObject({
      node_id: 'measure',
      attempt: 1,
      json: {
        path: expect.stringMatching(/--measure--a1\.json$/),
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });

    const refreshed = await operate(
      {
        operation: 'submit_candidate',
        packet: refreshPacket,
        candidate: {
          ...successfulCandidate(refreshPacket, 'measurement'),
          json: { value: 2 },
        },
      },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:04:00.000Z') },
      },
    );
    expect(refreshed).toMatchObject({
      ok: true,
      value: {
        node_id: 'measure',
        attempt: 2,
        result: {
          json: {
            path: expect.stringMatching(/--measure--a2\.json$/),
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        },
      },
    });
    if (!refreshed.ok || refreshed.value.result.json === null) {
      throw new Error(refreshed.ok ? 'Expected refreshed JSON.' : refreshed.failure.code);
    }
    expect(await readFile(join(project, refreshed.value.result.json.path), 'utf8')).toBe(
      '{"value":2}',
    );

    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        nodes: [
          {
            node_id: 'measure',
            selected_result: {
              attempt: 2,
              markdown: refreshed.value.result.markdown,
              json: refreshed.value.result.json,
            },
          },
        ],
        terminal_results: [{ node_id: 'measure', attempt: 2 }],
      },
    });
  });

  it.each(['failed', 'blocked', 'cancelled'] as const)(
    'should preserve the prior Result and descendants after a %s refresh',
    async (status) => {
      const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: unsuccessful-refresh-${status}
name: Unsuccessful Refresh ${status}
nodes:
  - id: gather
    name: Gather
    prompt: Gather evidence.
  - id: consume
    name: Consume
    prompt: Consume evidence.
    inputs:
      evidence:
        node: gather
`);
      const gatherPacket = await prepare(project, runId);
      const gathered = await operate(
        {
          operation: 'submit_candidate',
          packet: gatherPacket,
          candidate: successfulCandidate(gatherPacket, 'retained evidence'),
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
        },
      );
      expect(gathered).toMatchObject({ ok: true });

      const consumePrepared = await operate(
        { operation: 'prepare_work', run_id: runId, limit: 1 },
        {
          projectRoot: project,
          testControls: { now: () => new Date('2026-07-27T18:03:00.000Z') },
        },
      );
      if (!consumePrepared.ok) throw new Error(consumePrepared.failure.code);
      const consumePacket = consumePrepared.value.packets[0];
      if (consumePacket === undefined) throw new Error('No consumer packet was prepared.');
      const consumed = await operate(
        {
          operation: 'submit_candidate',
          packet: consumePacket,
          candidate: successfulCandidate(consumePacket, 'retained consumption'),
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date('2026-07-27T18:04:00.000Z') },
        },
      );
      expect(consumed).toMatchObject({ ok: true });

      const refreshPrepared = await operate(
        {
          operation: 'prepare_work',
          run_id: runId,
          intent: 'refresh',
          node_id: 'gather',
          limit: 1,
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date('2026-07-27T18:05:00.000Z') },
        },
      );
      if (!refreshPrepared.ok) throw new Error(refreshPrepared.failure.code);
      const refreshPacket = refreshPrepared.value.packets[0];
      if (refreshPacket === undefined) throw new Error('No refresh packet was prepared.');

      const unsuccessful = await operate(
        {
          operation: 'submit_candidate',
          packet: refreshPacket,
          candidate: nonSuccessfulCandidate(refreshPacket, status),
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date('2026-07-27T18:06:00.000Z') },
        },
      );
      expect(unsuccessful).toMatchObject({
        ok: true,
        value: { node_id: 'gather', attempt: 2, status, result: null },
      });

      const inspected = await operate(
        { operation: 'inspect_run', run_id: runId },
        { projectRoot: project },
      );
      expect(inspected).toMatchObject({
        ok: true,
        value: {
          status: 'complete',
          nodes: [
            {
              node_id: 'gather',
              state: 'complete',
              stale: false,
              next_attempt: 3,
              selected_result: { attempt: 1 },
            },
            {
              node_id: 'consume',
              state: 'complete',
              stale: false,
              next_attempt: 2,
              selected_result: { attempt: 1 },
            },
          ],
          attempts: [
            { node_id: 'gather', attempt: 1, status: 'succeeded', selected: true },
            { node_id: 'gather', attempt: 2, status, selected: false },
            { node_id: 'consume', attempt: 1, status: 'succeeded', selected: true },
          ],
          terminal_results: [{ node_id: 'consume', attempt: 1 }],
        },
      });
    },
  );

  it('should reject an incomplete refresh target or mismatched refresh base without an artifact', async () => {
    const incomplete = await createProject(`
schema_version: breakdown.workflow.v1
id: incomplete-refresh
name: Incomplete Refresh
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const resumePacket = await prepare(incomplete.project, incomplete.runId);
    const forgedRefresh = structuredClone(resumePacket);
    const forgedBase = {
      node_id: 'execute',
      attempt: 1,
      markdown: {
        path: `outputs/${incomplete.runId}/steps/forged.md`,
        sha256: '0'.repeat(64),
      },
    };
    forgedRefresh.intent = 'refresh';
    forgedRefresh.refresh_base = forgedBase;
    forgedRefresh.submission = {
      ...forgedRefresh.submission,
      intent: 'refresh',
      refresh_base: forgedBase,
    };
    const incompleteResult = await operate(
      {
        operation: 'submit_candidate',
        packet: forgedRefresh,
        candidate: successfulCandidate(forgedRefresh),
      },
      { projectRoot: incomplete.project },
    );
    expect(incompleteResult).toMatchObject({
      ok: false,
      failure: { kind: 'conflict', code: 'refresh_target_not_complete' },
    });
    expect(
      await operate(
        { operation: 'inspect_run', run_id: incomplete.runId },
        { projectRoot: incomplete.project },
      ),
    ).toMatchObject({ ok: true, value: { attempts: [] } });

    const complete = await createProject(`
schema_version: breakdown.workflow.v1
id: mismatched-refresh-base
name: Mismatched Refresh Base
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const initialPacket = await prepare(complete.project, complete.runId);
    expect(
      await operate(
        {
          operation: 'submit_candidate',
          packet: initialPacket,
          candidate: successfulCandidate(initialPacket),
        },
        {
          projectRoot: complete.project,
          testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
        },
      ),
    ).toMatchObject({ ok: true });
    const refreshPrepared = await operate(
      {
        operation: 'prepare_work',
        run_id: complete.runId,
        intent: 'refresh',
        node_id: 'execute',
      },
      {
        projectRoot: complete.project,
        testControls: { now: () => new Date('2026-07-27T18:03:00.000Z') },
      },
    );
    if (!refreshPrepared.ok) throw new Error(refreshPrepared.failure.code);
    const wrongBasePacket = structuredClone(refreshPrepared.value.packets[0]!);
    const wrongBase = { ...wrongBasePacket.refresh_base!, attempt: 999 };
    wrongBasePacket.refresh_base = wrongBase;
    wrongBasePacket.submission = {
      ...wrongBasePacket.submission,
      refresh_base: wrongBase,
    };

    const mismatchedResult = await operate(
      {
        operation: 'submit_candidate',
        packet: wrongBasePacket,
        candidate: successfulCandidate(wrongBasePacket),
      },
      { projectRoot: complete.project },
    );
    expect(mismatchedResult).toMatchObject({
      ok: false,
      failure: { kind: 'conflict', code: 'refresh_target_not_complete' },
    });
    expect(
      await operate(
        { operation: 'inspect_run', run_id: complete.runId },
        { projectRoot: complete.project },
      ),
    ).toMatchObject({ ok: true, value: { attempts: [{ attempt: 1 }] } });
  });

  it('should reject a refresh whose context or expected attempt advanced without another artifact', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: stale-refresh
name: Stale Refresh
nodes:
  - id: gather
    name: Gather
    prompt: Gather.
  - id: consume
    name: Consume
    prompt: Consume.
    inputs:
      evidence:
        node: gather
`);
    const gatherOne = await prepare(project, runId);
    expect(
      await operate(
        {
          operation: 'submit_candidate',
          packet: gatherOne,
          candidate: successfulCandidate(gatherOne, 'first evidence'),
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
        },
      ),
    ).toMatchObject({ ok: true });
    const consumeOnePrepared = await operate(
      { operation: 'prepare_work', run_id: runId, limit: 1 },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:03:00.000Z') },
      },
    );
    if (!consumeOnePrepared.ok) throw new Error(consumeOnePrepared.failure.code);
    const consumeOne = consumeOnePrepared.value.packets[0]!;
    expect(
      await operate(
        {
          operation: 'submit_candidate',
          packet: consumeOne,
          candidate: successfulCandidate(consumeOne, 'first consumption'),
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date('2026-07-27T18:04:00.000Z') },
        },
      ),
    ).toMatchObject({ ok: true });

    const oldConsumeRefreshPrepared = await operate(
      {
        operation: 'prepare_work',
        run_id: runId,
        intent: 'refresh',
        node_id: 'consume',
      },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:05:00.000Z') },
      },
    );
    if (!oldConsumeRefreshPrepared.ok) throw new Error(oldConsumeRefreshPrepared.failure.code);
    const oldConsumeRefresh = oldConsumeRefreshPrepared.value.packets[0]!;

    const gatherRefreshPrepared = await operate(
      {
        operation: 'prepare_work',
        run_id: runId,
        intent: 'refresh',
        node_id: 'gather',
      },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:06:00.000Z') },
      },
    );
    if (!gatherRefreshPrepared.ok) throw new Error(gatherRefreshPrepared.failure.code);
    const gatherRefresh = gatherRefreshPrepared.value.packets[0]!;
    expect(
      await operate(
        {
          operation: 'submit_candidate',
          packet: gatherRefresh,
          candidate: successfulCandidate(gatherRefresh, 'second evidence'),
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date('2026-07-27T18:07:00.000Z') },
        },
      ),
    ).toMatchObject({ ok: true, value: { attempt: 2 } });

    const staleContext = await operate(
      {
        operation: 'submit_candidate',
        packet: oldConsumeRefresh,
        candidate: successfulCandidate(oldConsumeRefresh, 'stale refresh'),
      },
      { projectRoot: project },
    );
    expect(staleContext).toMatchObject({
      ok: false,
      failure: { kind: 'conflict', code: 'stale_context' },
    });

    const gatherRefreshReplay = await operate(
      {
        operation: 'submit_candidate',
        packet: gatherRefresh,
        candidate: successfulCandidate(gatherRefresh, 'duplicate refresh'),
      },
      { projectRoot: project },
    );
    expect(gatherRefreshReplay).toMatchObject({
      ok: false,
      failure: { kind: 'conflict', code: 'attempt_advanced' },
    });
    expect(
      await operate({ operation: 'inspect_run', run_id: runId }, { projectRoot: project }),
    ).toMatchObject({
      ok: true,
      value: {
        attempts: [
          { node_id: 'gather', attempt: 1 },
          { node_id: 'gather', attempt: 2 },
          { node_id: 'consume', attempt: 1 },
        ],
      },
    });
  });

  it('publishes a failed attempt without a Result while independent prepared work progresses', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: independent-failure
name: Independent Failure
nodes:
  - id: fail
    name: Fail
    prompt: Report an honest failure.
  - id: blocked-child
    name: Blocked Child
    prompt: Wait for a successful Result.
    inputs:
      source:
        node: fail
  - id: independent
    name: Independent
    prompt: Produce independent work.
`);
    const prepared = await operate(
      { operation: 'prepare_work', run_id: runId, limit: 3 },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:01:00.000Z') },
      },
    );
    if (!prepared.ok) throw new Error(prepared.failure.code);
    expect(prepared.value.packets.map((packet) => packet.node.id)).toEqual(['fail', 'independent']);
    const failedPacket = prepared.value.packets[0]!;
    const independentPacket = prepared.value.packets[1]!;
    const failedCandidate: NonSuccessfulCandidateOutcome = {
      schema_version: 'breakdown.candidate.v1',
      submission: failedPacket.submission,
      status: 'failed',
      executor: {
        kind: 'agent',
        name: 'Codex',
      },
      markdown: 'The required source was unavailable.',
      problem: {
        code: 'source_unavailable',
        message: 'The required source was unavailable.',
      },
    };

    const failed = await operate(
      {
        operation: 'submit_candidate',
        packet: failedPacket,
        candidate: failedCandidate,
      },
      {
        projectRoot: project,
        testControls: {
          now: () => new Date('2026-07-27T18:02:00.000Z'),
          randomBytes: () => Buffer.alloc(8, 2),
        },
      },
    );

    expect(failed).toMatchObject({
      ok: true,
      value: {
        run_id: runId,
        node_id: 'fail',
        attempt: 1,
        status: 'failed',
        problem: {
          code: 'source_unavailable',
          message: 'The required source was unavailable.',
        },
        result: null,
      },
    });

    const independent = await operate(
      {
        operation: 'submit_candidate',
        packet: independentPacket,
        candidate: successfulCandidate(independentPacket, 'Independent Result'),
      },
      {
        projectRoot: project,
        testControls: {
          now: () => new Date('2026-07-27T18:03:00.000Z'),
          randomBytes: () => Buffer.alloc(8, 3),
        },
      },
    );
    expect(independent).toMatchObject({
      ok: true,
      value: { node_id: 'independent', attempt: 1, status: 'succeeded' },
    });

    const replay = await operate(
      {
        operation: 'submit_candidate',
        packet: failedPacket,
        candidate: failedCandidate,
      },
      { projectRoot: project },
    );
    expect(replay).toMatchObject({
      ok: false,
      failure: { kind: 'conflict', code: 'attempt_advanced' },
    });

    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        status: 'incomplete',
        nodes: [
          { node_id: 'fail', state: 'runnable', next_attempt: 2 },
          { node_id: 'independent', state: 'complete', next_attempt: 2 },
          { node_id: 'blocked-child', state: 'blocked', next_attempt: 1 },
        ],
        attempts: [
          { node_id: 'fail', attempt: 1, status: 'failed', selected: false },
          { node_id: 'independent', attempt: 1, status: 'succeeded', selected: true },
        ],
      },
    });
    if (!inspected.ok) throw new Error(inspected.failure.code);
    const failedAttempt = inspected.value.attempts.find((attempt) => attempt.node_id === 'fail');
    if (failedAttempt === undefined) throw new Error('Failed attempt was not published.');
    const artifact = await readFile(join(project, failedAttempt.file), 'utf8');
    expect(artifact).toContain('"status": "failed"');
    expect(artifact).toContain(
      '"problem": {\n    "code": "source_unavailable",\n    "message": "The required source was unavailable."\n  }',
    );
    expect(artifact).toMatch(/---\nThe required source was unavailable\.$/);
    expect(
      (await readdir(join(project, `outputs/${runId}/steps`))).filter((name) =>
        name.endsWith('.json'),
      ),
    ).toEqual([]);

    const nextOpportunity = await operate(
      { operation: 'prepare_work', run_id: runId, limit: 3 },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:04:00.000Z') },
      },
    );
    expect(nextOpportunity).toMatchObject({
      ok: true,
      value: {
        packets: [
          {
            node: { id: 'fail' },
            expected_attempt: 2,
          },
        ],
      },
    });
  });

  it.each(['failed', 'blocked', 'cancelled'] as const)(
    'publishes an explicit %s Candidate Outcome as result-free history',
    async (status) => {
      const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: non-success-${status}
name: Non-success ${status}
nodes:
  - id: execute
    name: Execute
    prompt: Report the settled outcome.
    data_contract:
      type: object
`);
      const packet = await prepare(project, runId);
      const submitted = await operate(
        {
          operation: 'submit_candidate',
          packet,
          candidate: nonSuccessfulCandidate(packet, status),
        },
        {
          projectRoot: project,
          testControls: {
            now: () => new Date('2026-07-27T18:02:00.000Z'),
            randomBytes: () => Buffer.alloc(8, 4),
          },
        },
      );

      expect(submitted).toMatchObject({
        ok: true,
        value: {
          run_id: runId,
          node_id: 'execute',
          attempt: 1,
          status,
          problem: {
            code: `executor_${status}`,
            message: `The Executor reported ${status}.`,
          },
          result: null,
        },
      });

      const inspected = await operate(
        { operation: 'inspect_run', run_id: runId },
        { projectRoot: project },
      );
      expect(inspected).toMatchObject({
        ok: true,
        value: {
          status: 'incomplete',
          nodes: [
            {
              node_id: 'execute',
              state: 'runnable',
              stale: false,
              next_attempt: 2,
            },
          ],
          attempts: [{ node_id: 'execute', attempt: 1, status, selected: false }],
          terminal_results: [],
        },
      });
      if (!inspected.ok) throw new Error(inspected.failure.code);
      const [attempt] = inspected.value.attempts;
      if (attempt === undefined) throw new Error('Non-success attempt was not published.');
      expect((await stat(join(project, attempt.file))).mode & 0o777).toBe(0o600);
      expect(await readFile(join(project, attempt.file), 'utf8')).toContain(
        `"status": "${status}"`,
      );
      expect(
        (await readdir(join(project, `outputs/${runId}/steps`))).filter((name) =>
          name.endsWith('.json'),
        ),
      ).toEqual([]);
    },
  );

  it('rejects invalid status-specific Candidate Outcome fields without publishing history', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: invalid-non-success
name: Invalid Non-success
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const packet = await prepare(project, runId);
    const invalidCandidates = [
      {
        ...successfulCandidate(packet),
        problem: {
          code: 'unexpected_problem',
          message: 'Success must not carry a problem.',
        },
      },
      {
        schema_version: 'breakdown.candidate.v1',
        submission: packet.submission,
        status: 'failed',
        executor: { kind: 'program', name: 'test-executor' },
        markdown: 'Missing problem.',
      },
      {
        ...nonSuccessfulCandidate(packet, 'blocked'),
        json: { unexpected: true },
      },
      {
        ...nonSuccessfulCandidate(packet, 'cancelled'),
        problem: {
          code: 'INVALID-CODE',
          message: '',
          detail: 'Unknown problem field.',
        },
      },
    ];
    const expectedDiagnosticPaths = [
      ['/problem'],
      ['/problem'],
      ['/json'],
      ['/problem/detail', '/problem/code', '/problem/message'],
    ];

    for (const [index, candidate] of invalidCandidates.entries()) {
      const rejected = await operate(
        {
          operation: 'submit_candidate',
          packet,
          candidate: candidate as never,
        },
        { projectRoot: project },
      );
      expect(rejected).toMatchObject({
        ok: false,
        failure: {
          kind: 'invalid',
          code: 'invalid_candidate',
          diagnostics: expectedDiagnosticPaths[index]!.map((path) => ({ path })),
        },
      });
    }

    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        nodes: [{ node_id: 'execute', state: 'runnable', next_attempt: 1 }],
        attempts: [],
      },
    });
  });

  it('should publish and pass downstream one complete contracted Result', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: submit-contracted
name: Submit Contracted
nodes:
  - id: produce
    name: Produce
    prompt: Produce a contracted Result.
    data_contract:
      type: object
      required: [answer, numbers, z]
      properties:
        answer:
          const: yes
        numbers:
          type: array
          items:
            type: number
        z:
          type: boolean
      additionalProperties: false
  - id: consume
    name: Consume
    prompt: Consume the complete Result.
    inputs:
      source:
        node: produce
`);
    const packet = await prepare(project, runId);
    const candidate = {
      ...successfulCandidate(packet, ''),
      json: {
        z: true,
        numbers: [333333333.3333333, 1e30, 4.5, 0.002, 1e-27],
        answer: 'yes',
      },
    };

    const submitted = await operate(
      { operation: 'submit_candidate', packet, candidate },
      {
        projectRoot: project,
        testControls: {
          now: () => new Date('2026-07-27T18:02:00.000Z'),
          randomBytes: () => Buffer.alloc(8, 5),
        },
      },
    );

    const expectedJson =
      '{"answer":"yes","numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"z":true}';
    expect(submitted).toMatchObject({
      ok: true,
      value: {
        result: {
          markdown: {
            path: `outputs/${runId}/steps/20260727T180200.000Z--produce--a1.md`,
          },
          json: {
            path: `outputs/${runId}/steps/20260727T180200.000Z--produce--a1.json`,
            sha256: 'fd7028103e991aa8b55226ce154c9509f2ad50b49b3570e509e4f192f817416a',
          },
        },
      },
    });
    if (!submitted.ok) throw new Error(submitted.failure.code);
    expect(await readFile(join(project, submitted.value.result.json!.path), 'utf8')).toBe(
      expectedJson,
    );
    expect((await stat(join(project, submitted.value.result.json!.path))).mode & 0o777).toBe(0o600);

    const committedMarkdown = await readFile(
      join(project, submitted.value.result.markdown.path),
      'utf8',
    );
    expect(committedMarkdown).toMatch(/---\n$/);
    expect(committedMarkdown).not.toContain(expectedJson);

    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        nodes: [
          {
            node_id: 'produce',
            state: 'complete',
            selected_result: {
              markdown: submitted.value.result.markdown,
              json: submitted.value.result.json,
            },
          },
          { node_id: 'consume', state: 'runnable' },
        ],
      },
    });

    const consumerPrepared = await operate(
      { operation: 'prepare_work', run_id: runId, limit: 1 },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:03:00.000Z') },
      },
    );
    if (!consumerPrepared.ok) throw new Error(consumerPrepared.failure.code);
    const consumerPacket = consumerPrepared.value.packets[0];
    if (consumerPacket === undefined) throw new Error('No consumer packet was prepared.');
    expect(consumerPacket.inputs.source?.result).toMatchObject({
      node_id: 'produce',
      attempt: 1,
      markdown: submitted.value.result.markdown,
      json: submitted.value.result.json,
    });
    const read = await operate(
      { operation: 'read_work_input', packet: consumerPacket, binding: 'source' },
      { projectRoot: project },
    );
    expect(read).toMatchObject({ ok: true, value: { kind: 'result' } });
    if (!read.ok || read.value.kind !== 'result') {
      throw new Error(read.ok ? 'Expected a Result Input.' : read.failure.code);
    }
    expect(Buffer.from(read.value.json_bytes_base64!, 'base64').toString('utf8')).toBe(
      expectedJson,
    );
    expect(Buffer.from(read.value.markdown_bytes_base64, 'base64').toString('utf8')).not.toContain(
      expectedJson,
    );

    const consumed = await operate(
      {
        operation: 'submit_candidate',
        packet: consumerPacket,
        candidate: successfulCandidate(consumerPacket, 'Consumed whole Result.'),
      },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:04:00.000Z') },
      },
    );
    expect(consumed).toMatchObject({ ok: true });
    if (!consumed.ok) throw new Error(consumed.failure.code);
    const consumerArtifact = await readFile(
      join(project, consumed.value.result.markdown.path),
      'utf8',
    );
    const consumerFrontmatter = JSON.parse(consumerArtifact.split('---\n')[1]!) as {
      inputs: Record<string, unknown>;
    };
    expect(consumerFrontmatter.inputs.source).toEqual({
      result: {
        node_id: 'produce',
        attempt: 1,
        markdown: submitted.value.result.markdown,
        json: submitted.value.result.json,
      },
    });
  });

  it('should reject contracted JSON that does not satisfy its Data Contract', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: reject-contract
name: Reject Contract
nodes:
  - id: produce
    name: Produce
    prompt: Produce a valid score.
    data_contract:
      type: object
      required: [score]
      properties:
        score:
          type: integer
          minimum: 1
      additionalProperties: false
`);
    const packet = await prepare(project, runId);
    const candidate = {
      ...successfulCandidate(packet),
      json: { score: 0.5, extra: true },
    };

    const submitted = await operate(
      { operation: 'submit_candidate', packet, candidate },
      { projectRoot: project },
    );

    expect(submitted).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_candidate',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'data_contract',
            file: 'candidate',
            path: '/json/score',
          }),
          expect.objectContaining({
            code: 'data_contract',
            file: 'candidate',
            path: '/json/extra',
          }),
        ]),
      },
    });
    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(inspected).toMatchObject({
      ok: true,
      value: { attempts: [], nodes: [{ state: 'runnable', next_attempt: 1 }] },
    });
    expect(await readdir(join(project, 'outputs', runId, 'steps'))).toEqual([]);
  });

  it('should reject values outside the strict JSON data model', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: strict-json
name: Strict JSON
nodes:
  - id: produce
    name: Produce
    prompt: Produce strict JSON.
    data_contract: {}
`);
    const packet = await prepare(project, runId);
    const sparse = Array.from({ length: 2 }, (_, index) => (index === 0 ? true : undefined));
    delete sparse[1];
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const accessorArray: unknown[] = [];
    Object.defineProperty(accessorArray, '0', {
      enumerable: true,
      get: () => true,
    });
    const namedArray: unknown[] = [];
    Object.defineProperty(namedArray, '4294967295', {
      enumerable: true,
      value: true,
    });
    const invalidValues: unknown[] = [
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1n,
      '\uD800',
      [undefined],
      { value: undefined },
      sparse,
      accessorArray,
      namedArray,
      new Date('2026-07-27T18:00:00.000Z'),
      circular,
    ];

    for (const json of invalidValues) {
      const candidate = { ...successfulCandidate(packet), json };
      const submitted = await operate(
        { operation: 'submit_candidate', packet, candidate },
        { projectRoot: project },
      );
      expect(submitted, String(json)).toMatchObject({
        ok: false,
        failure: { kind: 'invalid', code: 'invalid_candidate' },
      });
    }

    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(inspected).toMatchObject({ ok: true, value: { attempts: [] } });
  });

  it.each([
    ['object', { answer: true }, '{"answer":true}'],
    ['array', [1, 'two'], '[1,"two"]'],
    ['string', 'root', '"root"'],
    ['number', 1.5, '1.5'],
    ['integer', 1, '1'],
    ['boolean', false, 'false'],
    ['null', null, 'null'],
  ] as const)('should accept a permitted %s root JSON value', async (type, json, expectedBytes) => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: root-${type}
name: Root ${type}
nodes:
  - id: produce
    name: Produce
    prompt: Produce a root ${type}.
    data_contract:
      type: ${type === 'null' ? '"null"' : type}
`);
    const packet = await prepare(project, runId);
    const candidate = { ...successfulCandidate(packet), json };

    const submitted = await operate(
      { operation: 'submit_candidate', packet, candidate },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
      },
    );

    expect(submitted).toMatchObject({
      ok: true,
      value: { result: { json: { path: expect.any(String) } } },
    });
    if (!submitted.ok || submitted.value.result.json === null) {
      throw new Error(submitted.ok ? 'Expected a JSON Result.' : submitted.failure.code);
    }
    expect(await readFile(join(project, submitted.value.result.json.path), 'utf8')).toBe(
      expectedBytes,
    );
  });

  it('should record raw JSON bytes independently from semantic JSON equality', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: raw-json
name: Raw JSON
nodes:
  - id: produce
    name: Produce
    prompt: Produce JSON.
    data_contract:
      type: object
  - id: consume
    name: Consume
    prompt: Consume JSON.
    inputs:
      source:
        node: produce
`);
    const packet = await prepare(project, runId);
    const candidate = { ...successfulCandidate(packet), json: { b: 2, a: 1 } };
    const submitted = await operate(
      { operation: 'submit_candidate', packet, candidate },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
      },
    );
    if (!submitted.ok || submitted.value.result.json === null) {
      throw new Error(submitted.ok ? 'Expected a JSON Result.' : submitted.failure.code);
    }
    expect(submitted.value.result.json.sha256).toBe(
      '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777',
    );
    const canonicalPacket = await prepare(project, runId);

    await writeFile(
      join(project, submitted.value.result.json.path),
      '{ "b": 2, "a": 1 }\n',
      'utf8',
    );

    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(inspected.ok && inspected.value.nodes[0]?.selected_result?.json?.sha256).toBe(
      'b9257cb792a3036e75f0c65d7dd3a7f38e5f6982652077a1c597e8957002d5b8',
    );
    const rawPacket = await prepare(project, runId);
    expect(rawPacket.context_sha256).not.toBe(canonicalPacket.context_sha256);
    expect(rawPacket.inputs.source?.result?.json).toMatchObject({
      path: submitted.value.result.json.path,
      sha256: 'b9257cb792a3036e75f0c65d7dd3a7f38e5f6982652077a1c597e8957002d5b8',
    });
  });

  it('should accept the exact JSON byte limit and reject larger or deeper JSON', async () => {
    const exact = await createProject(`
schema_version: breakdown.workflow.v1
id: exact-json-limit
name: Exact JSON Limit
nodes:
  - id: produce
    name: Produce
    prompt: Produce maximum JSON.
    data_contract:
      type: string
`);
    const exactPacket = await prepare(exact.project, exact.runId);
    const exactCandidate = {
      ...successfulCandidate(exactPacket),
      json: 'x'.repeat(524_286),
    };
    const accepted = await operate(
      { operation: 'submit_candidate', packet: exactPacket, candidate: exactCandidate },
      {
        projectRoot: exact.project,
        testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
      },
    );
    expect(accepted).toMatchObject({ ok: true });
    if (!accepted.ok || accepted.value.result.json === null) {
      throw new Error(accepted.ok ? 'Expected a JSON Result.' : accepted.failure.code);
    }
    expect((await stat(join(exact.project, accepted.value.result.json.path))).size).toBe(524_288);

    const oversized = await createProject(`
schema_version: breakdown.workflow.v1
id: large-json
name: Large JSON
nodes:
  - id: produce
    name: Produce
    prompt: Produce oversized JSON.
    data_contract:
      type: string
`);
    const oversizedPacket = await prepare(oversized.project, oversized.runId);
    const oversizedCandidate = {
      ...successfulCandidate(oversizedPacket),
      json: 'x'.repeat(524_287),
    };
    await expect(
      operate(
        {
          operation: 'submit_candidate',
          packet: oversizedPacket,
          candidate: oversizedCandidate,
        },
        { projectRoot: oversized.project },
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'resource_limit', code: 'limit_exceeded' },
    });

    const tooDeep = await createProject(`
schema_version: breakdown.workflow.v1
id: deep-json
name: Deep JSON
nodes:
  - id: produce
    name: Produce
    prompt: Produce deep JSON.
    data_contract: {}
`);
    const tooDeepPacket = await prepare(tooDeep.project, tooDeep.runId);
    let deepValue: unknown = true;
    for (let depth = 0; depth < 65; depth += 1) deepValue = [deepValue];
    const deepCandidate = { ...successfulCandidate(tooDeepPacket), json: deepValue };
    await expect(
      operate(
        { operation: 'submit_candidate', packet: tooDeepPacket, candidate: deepCandidate },
        { projectRoot: tooDeep.project },
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'resource_limit', code: 'limit_exceeded' },
    });
  });

  it('serializes concurrent submission with one observable per-Run writer lock', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: submission-lock
name: Submission Lock
nodes:
  - id: execute
    name: Execute
    prompt: Execute once.
`);
    const packet = await prepare(project, runId);
    let announceLock!: () => void;
    const lockAcquired = new Promise<void>((resolve) => {
      announceLock = resolve;
    });
    let releaseLock!: () => void;
    const keepLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const firstSubmission = operate(
      {
        operation: 'submit_candidate',
        packet,
        candidate: successfulCandidate(packet, 'first'),
      },
      {
        projectRoot: project,
        testControls: {
          now: () => new Date('2026-07-27T18:02:00.000Z'),
          randomBytes: () => Buffer.alloc(8, 2),
          onStepPublicationBoundary: async (boundary) => {
            if (boundary !== 'after_lock_acquired') return;
            announceLock();
            await keepLock;
          },
        },
      },
    );
    await lockAcquired;

    const observed = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(observed).toMatchObject({
      ok: true,
      value: { lock: { lock_id: '0202020202020202' }, attempts: [] },
    });

    const contender = await operate(
      {
        operation: 'submit_candidate',
        packet,
        candidate: successfulCandidate(packet, 'duplicate'),
      },
      {
        projectRoot: project,
        testControls: {
          now: () => new Date('2026-07-27T18:02:00.000Z'),
          randomBytes: () => Buffer.alloc(8, 3),
        },
      },
    );
    expect(contender).toMatchObject({
      ok: false,
      failure: { kind: 'conflict', code: 'run_locked' },
    });

    releaseLock();
    await expect(firstSubmission).resolves.toMatchObject({ ok: true });
    const settled = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(settled).toMatchObject({
      ok: true,
      value: { lock: null, attempts: [{ node_id: 'execute', attempt: 1 }] },
    });
  });

  it('rejects malformed Markdown without normalization and accepts a zero-byte Result', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: markdown-bytes
name: Markdown Bytes
nodes:
  - id: write
    name: Write
    prompt: Write exact Markdown.
`);
    const packet = await prepare(project, runId);
    const invalidCandidates: Array<{
      candidate: SuccessfulCandidateOutcome;
      failureCode: string;
    }> = [
      {
        candidate: successfulCandidate(packet, '\uFEFFstarts with a BOM'),
        failureCode: 'invalid_candidate',
      },
      {
        candidate: successfulCandidate(packet, 'uses\r\nCRLF'),
        failureCode: 'invalid_candidate',
      },
      {
        candidate: successfulCandidate(packet, '\uD800'),
        failureCode: 'invalid_candidate',
      },
      {
        candidate: successfulCandidate(packet, 'x'.repeat(524_289)),
        failureCode: 'limit_exceeded',
      },
      {
        candidate: {
          ...successfulCandidate(packet),
          json: { unexpected: true },
        } as SuccessfulCandidateOutcome,
        failureCode: 'invalid_candidate',
      },
    ];

    for (const invalid of invalidCandidates) {
      const result = await operate(
        { operation: 'submit_candidate', packet, candidate: invalid.candidate },
        { projectRoot: project },
      );
      expect(result).toMatchObject({
        ok: false,
        failure: { code: invalid.failureCode },
      });
    }

    const stillRunnable = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(stillRunnable).toMatchObject({
      ok: true,
      value: {
        nodes: [{ node_id: 'write', state: 'runnable', next_attempt: 1 }],
        attempts: [],
      },
    });

    const empty = await operate(
      {
        operation: 'submit_candidate',
        packet,
        candidate: successfulCandidate(packet, ''),
      },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
      },
    );
    expect(empty).toMatchObject({ ok: true, value: { attempt: 1 } });
    if (!empty.ok) throw new Error(empty.failure.code);
    const committed = await readFile(join(project, empty.value.result.markdown.path), 'utf8');
    expect(committed).toMatch(/---\n$/);
  });

  it('accepts the exact Markdown byte limit and rejects success for a contracted node', async () => {
    const exact = await createProject(`
schema_version: breakdown.workflow.v1
id: exact-markdown-limit
name: Exact Markdown Limit
nodes:
  - id: write
    name: Write
    prompt: Write the largest accepted Markdown Result.
  - id: consume
    name: Consume
    prompt: Consume the largest accepted Markdown Result.
    inputs:
      source:
        node: write
`);
    const exactPacket = await prepare(exact.project, exact.runId);
    const accepted = await operate(
      {
        operation: 'submit_candidate',
        packet: exactPacket,
        candidate: successfulCandidate(exactPacket, 'x'.repeat(524_288)),
      },
      {
        projectRoot: exact.project,
        testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
      },
    );
    expect(accepted).toMatchObject({ ok: true, value: { attempt: 1 } });

    const consumerPacket = await prepare(exact.project, exact.runId);
    expect(consumerPacket.node.id).toBe('consume');
    const read = await operate(
      { operation: 'read_work_input', packet: consumerPacket, binding: 'source' },
      { projectRoot: exact.project },
    );
    expect(read).toMatchObject({
      ok: true,
      value: { kind: 'result', json_bytes_base64: null },
    });
    if (!read.ok || read.value.kind !== 'result') throw new Error('Result Input was not read.');
    expect(Buffer.from(read.value.markdown_bytes_base64, 'base64').subarray(-524_288)).toEqual(
      Buffer.from('x'.repeat(524_288)),
    );

    const contracted = await createProject(`
schema_version: breakdown.workflow.v1
id: contracted-result
name: Contracted Result
nodes:
  - id: write
    name: Write
    prompt: Write a contracted Result.
    data_contract:
      type: object
`);
    const contractedPacket = await prepare(contracted.project, contracted.runId);
    const rejected = await operate(
      {
        operation: 'submit_candidate',
        packet: contractedPacket,
        candidate: successfulCandidate(contractedPacket),
      },
      { projectRoot: contracted.project },
    );
    expect(rejected).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_candidate',
        diagnostics: [{ path: '/json' }],
      },
    });
    const inspected = await operate(
      { operation: 'inspect_run', run_id: contracted.runId },
      { projectRoot: contracted.project },
    );
    expect(inspected).toMatchObject({ ok: true, value: { attempts: [] } });
  });

  it('settles stale, ineligible, and duplicate submissions as conflicts without another artifact', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: submission-conflicts
name: Submission Conflicts
nodes:
  - id: execute
    name: Execute
    prompt: Execute once.
`);
    const packet = await prepare(project, runId);
    const impossiblePacket = structuredClone(packet);
    impossiblePacket.prepared_at = '2026-07-27T17:59:59.999Z';
    impossiblePacket.submission = {
      ...impossiblePacket.submission,
      prepared_at: '2026-07-27T17:59:59.999Z',
    };
    const impossibleStart = successfulCandidate(impossiblePacket);
    await expect(
      operate(
        {
          operation: 'submit_candidate',
          packet: impossiblePacket,
          candidate: impossibleStart,
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid', code: 'invalid_candidate' },
    });

    const mismatchedEcho = successfulCandidate(packet);
    mismatchedEcho.submission = {
      ...mismatchedEcho.submission,
      prepared_at: '2026-07-27T18:01:01.000Z',
    };
    await expect(
      operate(
        {
          operation: 'submit_candidate',
          packet,
          candidate: mismatchedEcho,
        },
        {
          projectRoot: project,
          testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'invalid', code: 'invalid_candidate' },
    });

    const stalePacket = structuredClone(packet);
    stalePacket.context_sha256 = '0'.repeat(64);
    stalePacket.submission = {
      ...stalePacket.submission,
      context_sha256: '0'.repeat(64),
    };
    const stale = successfulCandidate(stalePacket);
    await expect(
      operate(
        { operation: 'submit_candidate', packet: stalePacket, candidate: stale },
        { projectRoot: project },
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'conflict', code: 'stale_context' },
    });

    const ineligiblePacket = structuredClone(packet);
    ineligiblePacket.node = {
      ...ineligiblePacket.node,
      id: 'not-in-run',
    };
    ineligiblePacket.submission = {
      ...ineligiblePacket.submission,
      node_id: 'not-in-run',
    };
    const ineligible = successfulCandidate(ineligiblePacket);
    await expect(
      operate(
        {
          operation: 'submit_candidate',
          packet: ineligiblePacket,
          candidate: ineligible,
        },
        { projectRoot: project },
      ),
    ).resolves.toMatchObject({
      ok: false,
      failure: { kind: 'conflict', code: 'no_longer_runnable' },
    });

    const candidate = successfulCandidate(packet);
    const accepted = await operate(
      { operation: 'submit_candidate', packet, candidate },
      {
        projectRoot: project,
        testControls: { now: () => new Date('2026-07-27T18:02:00.000Z') },
      },
    );
    expect(accepted).toMatchObject({ ok: true, value: { attempt: 1 } });

    const replay = await operate(
      { operation: 'submit_candidate', packet, candidate },
      { projectRoot: project },
    );
    expect(replay).toMatchObject({
      ok: false,
      failure: { kind: 'conflict', code: 'attempt_advanced' },
    });
    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        lock: null,
        nodes: [{ state: 'complete', next_attempt: 2 }],
        attempts: [{ attempt: 1, status: 'succeeded' }],
      },
    });
  });

  it('never exposes staging as an attempt or overwrites a destination that wins publication', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: atomic-submission
name: Atomic Submission
nodes:
  - id: execute
    name: Execute
    prompt: Publish atomically.
`);
    const packet = await prepare(project, runId);
    const destination = join(
      project,
      'outputs',
      runId,
      'steps',
      '20260727T180200.000Z--execute--a1.md',
    );
    let inspectedWhileStaged = false;
    const submitted = await operate(
      {
        operation: 'submit_candidate',
        packet,
        candidate: successfulCandidate(packet, 'must not replace'),
      },
      {
        projectRoot: project,
        testControls: {
          now: () => new Date('2026-07-27T18:02:00.000Z'),
          randomBytes: () => Buffer.alloc(8, 4),
          onStepPublicationBoundary: async (boundary) => {
            if (boundary === 'after_staging_written') {
              const inspected = await operate(
                { operation: 'inspect_run', run_id: runId },
                { projectRoot: project },
              );
              expect(inspected).toMatchObject({
                ok: true,
                value: { attempts: [], nodes: [{ state: 'runnable', next_attempt: 1 }] },
              });
              inspectedWhileStaged = true;
            }
            if (boundary === 'before_commit') {
              await writeFile(destination, 'destination-won', { mode: 0o600 });
            }
          },
        },
      },
    );

    expect(inspectedWhileStaged).toBe(true);
    expect(submitted).toMatchObject({
      ok: false,
      failure: { kind: 'conflict', code: 'attempt_advanced' },
    });
    expect(await readFile(destination, 'utf8')).toBe('destination-won');
    expect(await readdir(join(project, 'outputs', runId, 'steps'))).toEqual([
      '20260727T180200.000Z--execute--a1.md',
    ]);
    expect(await readdir(join(project, '.breakdown', 'locks', 'runs'))).toEqual([]);

    const mode = (await stat(destination)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('should commit JSON before Markdown and ignore an orphan after a pre-commit crash', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: contracted-crash
name: Contracted Crash
nodes:
  - id: execute
    name: Execute
    prompt: Publish atomically.
    data_contract:
      type: object
`);
    const packet = await prepare(project, runId);
    const markdownDestination = join(
      project,
      'outputs',
      runId,
      'steps',
      '20260727T180200.000Z--execute--a1.md',
    );
    const jsonDestination = markdownDestination.replace(/\.md$/, '.json');
    let observedJsonBeforeMarkdown = false;

    const submitted = await operate(
      {
        operation: 'submit_candidate',
        packet,
        candidate: { ...successfulCandidate(packet), json: { committed: true } },
      },
      {
        projectRoot: project,
        testControls: {
          now: () => new Date('2026-07-27T18:02:00.000Z'),
          randomBytes: () => Buffer.alloc(8, 6),
          onStepPublicationBoundary: async (boundary) => {
            if (boundary !== 'before_commit') return;
            expect(await readFile(jsonDestination, 'utf8')).toBe('{"committed":true}');
            await expect(stat(markdownDestination)).rejects.toMatchObject({ code: 'ENOENT' });
            observedJsonBeforeMarkdown = true;
            throw new Error('simulated crash before the logical commit');
          },
        },
      },
    );

    expect(observedJsonBeforeMarkdown).toBe(true);
    expect(submitted).toMatchObject({
      ok: false,
      failure: { kind: 'io', code: 'io_error' },
    });
    expect(await readdir(join(project, 'outputs', runId, 'steps'))).toEqual([
      '20260727T180200.000Z--execute--a1.json',
    ]);
    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    expect(inspected).toMatchObject({
      ok: true,
      value: {
        attempts: [],
        nodes: [{ node_id: 'execute', state: 'runnable', next_attempt: 1 }],
      },
    });
    expect(await readdir(join(project, '.breakdown', 'locks', 'runs'))).toEqual([]);
  });

  it('should keep the logical commit valid during no-replace publication', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: commit-visibility
name: Commit Visibility
nodes:
  - id: execute
    name: Execute
    prompt: Publish one complete Result.
    data_contract:
      type: object
`);
    const packet = await prepare(project, runId);
    const markdownDestination = join(
      project,
      'outputs',
      runId,
      'steps',
      '20260727T180200.000Z--execute--a1.md',
    );
    let observedValidCommit = false;

    const submitted = await operate(
      {
        operation: 'submit_candidate',
        packet,
        candidate: { ...successfulCandidate(packet), json: { complete: true } },
      },
      {
        projectRoot: project,
        testControls: {
          now: () => new Date('2026-07-27T18:02:00.000Z'),
          randomBytes: () => Buffer.alloc(8, 7),
          onStepPublicationBoundary: async (boundary) => {
            if (boundary !== 'after_commit_visible') return;
            expect((await stat(markdownDestination)).nlink).toBe(2);
            const inspected = await operate(
              { operation: 'inspect_run', run_id: runId },
              { projectRoot: project },
            );
            expect(inspected).toMatchObject({
              ok: true,
              value: {
                nodes: [
                  {
                    node_id: 'execute',
                    state: 'complete',
                    selected_result: {
                      markdown: {
                        path: `outputs/${runId}/steps/20260727T180200.000Z--execute--a1.md`,
                      },
                      json: {
                        path: `outputs/${runId}/steps/20260727T180200.000Z--execute--a1.json`,
                      },
                    },
                  },
                ],
              },
            });
            observedValidCommit = true;
          },
        },
      },
    );

    expect(submitted).toMatchObject({ ok: true });
    expect(observedValidCommit).toBe(true);
    expect((await stat(markdownDestination)).nlink).toBe(1);
    expect((await readdir(join(project, 'outputs', runId, 'steps'))).sort()).toEqual([
      '20260727T180200.000Z--execute--a1.json',
      '20260727T180200.000Z--execute--a1.md',
    ]);
  });

  it('reports success only after committed inspection selects the Result', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: committed-inspection
name: Committed Inspection
nodes:
  - id: execute
    name: Execute
    prompt: Verify committed selection.
`);
    const packet = await prepare(project, runId);
    const destination = join(
      project,
      'outputs',
      runId,
      'steps',
      '20260727T180200.000Z--execute--a1.md',
    );
    const submitted = await operate(
      {
        operation: 'submit_candidate',
        packet,
        candidate: successfulCandidate(packet),
      },
      {
        projectRoot: project,
        testControls: {
          now: () => new Date('2026-07-27T18:02:00.000Z'),
          onStepPublicationBoundary: async (boundary) => {
            if (boundary === 'after_commit') {
              await writeFile(destination, 'corrupted after commit', 'utf8');
            }
          },
        },
      },
    );

    expect(submitted).toMatchObject({
      ok: false,
      failure: { kind: 'invalid', code: 'invalid_run' },
    });
  });
});

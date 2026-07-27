import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { operate, type SuccessfulCandidateOutcome, type WorkPacket } from './index.js';

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

afterEach(async () => {
  await Promise.all(
    projects.splice(0).map((project) => rm(project, { recursive: true, force: true })),
  );
});

describe('submit_candidate', () => {
  it('publishes the strict successful Candidate Outcome contract', async () => {
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
      required: string[];
      properties: {
        submission: {
          additionalProperties: boolean;
          required: string[];
        };
      };
    };

    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ['schema_version', 'submission', 'status', 'executor', 'markdown'],
      properties: {
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

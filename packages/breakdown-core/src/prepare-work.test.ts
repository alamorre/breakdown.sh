import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { operate } from './index.js';

const projects: string[] = [];

afterEach(async () => {
  await Promise.all(
    projects.splice(0).map((project) => rm(project, { recursive: true, force: true })),
  );
});

async function createProject(workflow: string) {
  const project = await mkdtemp(join(tmpdir(), 'breakdown-prepare-'));
  projects.push(project);
  await writeFile(join(project, 'breakdown.yaml'), workflow);
  const created = await operate(
    { operation: 'create_run' },
    {
      projectRoot: project,
      testControls: {
        now: () => new Date('2026-07-26T12:00:00.000Z'),
        randomBytes: () => Buffer.alloc(8),
      },
    },
  );
  if (!created.ok) throw new Error(created.failure.code);
  return { project, runId: created.value.run_id };
}

describe('prepare_work', () => {
  it('prepares deterministic bounded packets without creating durable state', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: packet-order
name: Packet Order
nodes:
  - id: first
    name: First
    prompt: First task.
  - id: second
    name: Second
    prompt: Second task.
  - id: third
    name: Third
    prompt: Third task.
  - id: fourth
    name: Fourth
    prompt: Fourth task.
`);
    const before = await readdir(join(project, 'outputs', runId, 'steps'));

    const prepared = await operate(
      { operation: 'prepare_work', run_id: runId },
      { projectRoot: project, testControls: { now: () => new Date('2026-07-26T12:01:00.000Z') } },
    );

    expect(prepared).toMatchObject({
      ok: true,
      value: {
        schema_version: 'breakdown.work-packet-batch.v1',
        run_id: runId,
        intent: 'resume',
        prepared_at: '2026-07-26T12:01:00.000Z',
        packets: expect.arrayContaining([
          expect.objectContaining({
            schema_version: 'breakdown.work-packet.v1',
            run_id: runId,
            node: expect.objectContaining({ id: 'first', prompt: 'First task.' }),
            expected_attempt: 1,
            context_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            policy: expect.objectContaining({ core: expect.any(String) }),
            task: { instructions: 'First task.' },
            result: expect.objectContaining({ markdown: 'required' }),
            submission: expect.objectContaining({
              run_id: runId,
              node_id: 'first',
              expected_attempt: 1,
            }),
          }),
        ]),
      },
    });
    if (!prepared.ok) throw new Error(prepared.failure.code);
    expect(prepared.value.packets.map((packet) => packet.node.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(prepared.value.packets[0]).not.toHaveProperty('extensions');
    expect(prepared.value.packets[0]).not.toHaveProperty('allocated_attempt');
    expect(await readdir(join(project, 'outputs', runId, 'steps'))).toEqual(before);
    expect(await readFile(join(project, 'outputs', runId, 'run.md'), 'utf8')).toContain(runId);
  });

  it('caps and validates the preparation limit', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: packet-limit
name: Packet Limit
nodes:
  - id: one
    name: One
    prompt: One.
  - id: two
    name: Two
    prompt: Two.
  - id: three
    name: Three
    prompt: Three.
  - id: four
    name: Four
    prompt: Four.
`);

    const capped = await operate(
      { operation: 'prepare_work', run_id: runId, limit: 99 },
      { projectRoot: project },
    );
    expect(capped.ok && capped.value.packets).toHaveLength(3);

    const invalid = await operate(
      { operation: 'prepare_work', run_id: runId, limit: 0 },
      { projectRoot: project },
    );
    expect(invalid).toMatchObject({ ok: false, failure: { code: 'invalid_prepare_work' } });
  });

  it('prepares exactly one refresh packet for a complete node', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: packet-refresh
name: Packet Refresh
nodes:
  - id: one
    name: One
    prompt: One.
`);
    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    if (!inspected.ok) throw new Error(inspected.failure.code);
    const context = inspected.value.nodes[0]?.context_sha256;
    if (context === undefined) throw new Error('Missing context');
    const settled = '2026-07-26T12:00:02.000Z';
    const filename = '20260726T120002.000Z--one--a1.md';
    await writeFile(
      join(project, 'outputs', runId, 'steps', filename),
      `---\n${JSON.stringify({
        schema_version: 'breakdown.step-artifact.v1',
        run_id: runId,
        node_id: 'one',
        attempt: 1,
        status: 'succeeded',
        started_at: '2026-07-26T12:00:01.000Z',
        settled_at: settled,
        context_sha256: context,
        inputs: {},
        executor: { kind: 'program', name: 'fixture' },
      })}\n---\nresult`,
    );

    const refreshed = await operate(
      { operation: 'prepare_work', run_id: runId, intent: 'refresh', node_id: 'one' },
      { projectRoot: project, testControls: { now: () => new Date('2026-07-26T12:01:00.000Z') } },
    );
    expect(refreshed).toMatchObject({ ok: true });
    if (!refreshed.ok) throw new Error(refreshed.failure.code);
    expect(refreshed.value.packets).toHaveLength(1);
    expect(refreshed.value.packets[0]).toMatchObject({
      intent: 'refresh',
      expected_attempt: 2,
      submission: { node_id: 'one', expected_attempt: 2 },
    });
  });
});

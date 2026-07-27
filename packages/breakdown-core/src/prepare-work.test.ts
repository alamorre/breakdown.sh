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

interface ProjectOptions {
  setup?: (project: string) => Promise<void> | void;
}

async function createProject(workflow: string, options?: ProjectOptions) {
  const project = await mkdtemp(join(tmpdir(), 'breakdown-prepare-'));
  projects.push(project);
  await writeFile(join(project, 'breakdown.yaml'), workflow);
  await options?.setup?.(project);
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

function stepFilename(nodeId: string, attempt: number, settledAt: string) {
  const timestamp = settledAt.replace(/[-:]/g, '');
  return `${timestamp}--${nodeId}--a${attempt}.md`;
}

interface StepFixture {
  project: string;
  runId: string;
  nodeId: string;
  attempt: number;
  contextSha256: string;
  settledAt: string;
  startedAt: string;
  body: string;
  inputs?: Record<string, unknown>;
  json?: unknown;
}

async function writeStepFixture(opts: StepFixture) {
  const filename = stepFilename(opts.nodeId, opts.attempt, opts.settledAt);
  const file = join(opts.project, 'outputs', opts.runId, 'steps', filename);
  await writeFile(
    file,
    `---\n${JSON.stringify(
      {
        schema_version: 'breakdown.step-artifact.v1',
        run_id: opts.runId,
        node_id: opts.nodeId,
        attempt: opts.attempt,
        status: 'succeeded',
        started_at: opts.startedAt,
        settled_at: opts.settledAt,
        context_sha256: opts.contextSha256,
        inputs: opts.inputs ?? {},
        executor: { kind: 'program', name: 'fixture' },
      },
      null,
      2,
    )}\n---\n${opts.body}`,
  );

  if (opts.json !== undefined) {
    await writeFile(file.replace(/\.md$/, '.json'), JSON.stringify(opts.json), 'utf8');
  }
  return filename;
}

describe('prepare_work', () => {
  it('should publish refresh-base requirements in the strict Work Packet contract', async () => {
    const schema = JSON.parse(
      await readFile(
        new URL(
          '../../../local/contracts/schemas/breakdown.work-packet.v1.schema.json',
          import.meta.url,
        ),
        'utf8',
      ),
    ) as {
      allOf: unknown[];
      properties: {
        refresh_base: { $ref: string };
        submission: {
          properties: {
            refresh_base: { $ref: string };
          };
        };
      };
      $defs: {
        selectedResult: {
          additionalProperties: boolean;
          required: string[];
        };
      };
    };

    expect(schema).toMatchObject({
      allOf: expect.any(Array),
      properties: {
        refresh_base: { $ref: '#/$defs/selectedResult' },
        submission: {
          properties: {
            refresh_base: { $ref: '#/$defs/selectedResult' },
          },
        },
      },
      $defs: {
        selectedResult: {
          additionalProperties: false,
          required: ['node_id', 'attempt', 'markdown'],
        },
      },
    });
  });

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
      refresh_base: {
        node_id: 'one',
        attempt: 1,
        markdown: {
          path: `outputs/${runId}/steps/${filename}`,
          sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
      },
      submission: {
        node_id: 'one',
        expected_attempt: 2,
        refresh_base: {
          node_id: 'one',
          attempt: 1,
          markdown: {
            path: `outputs/${runId}/steps/${filename}`,
            sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        },
      },
    });
  });

  it('should settle refresh preparation for an incomplete target as a conflict', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: incomplete-refresh
name: Incomplete Refresh
nodes:
  - id: one
    name: One
    prompt: One.
`);

    const refreshed = await operate(
      { operation: 'prepare_work', run_id: runId, intent: 'refresh', node_id: 'one' },
      { projectRoot: project },
    );

    expect(refreshed).toMatchObject({
      ok: false,
      failure: {
        kind: 'conflict',
        code: 'refresh_target_not_complete',
      },
    });
    expect(await readdir(join(project, 'outputs', runId, 'steps'))).toEqual([]);
  });

  it('reads a Workflow Input packet binding and validates integrity', async () => {
    const sourceBody = 'workflow input text';
    const { project, runId } = await createProject(
      `
schema_version: breakdown.workflow.v1
id: read-work-input
name: Read Work Input
inputs:
  source:
    default: source.txt
nodes:
  - id: consume
    name: Consume
    prompt: Consume the source.
    inputs:
      source:
        workflow_input: source
`,
      {
        setup: async (projectPath) => {
          await writeFile(join(projectPath, 'source.txt'), sourceBody, 'utf8');
        },
      },
    );

    const prepared = await operate(
      { operation: 'prepare_work', run_id: runId },
      { projectRoot: project },
    );
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) throw new Error(prepared.failure.code);
    expect(prepared.value.packets[0]).toMatchObject({
      node: { id: 'consume' },
      inputs: {
        source: {
          workflow_input: {
            path: 'source.txt',
            identity: {
              device: expect.any(String),
              inode: expect.any(String),
              birthtime: expect.any(String),
            },
          },
        },
      },
    });

    const read = await operate(
      { operation: 'read_work_input', packet: prepared.value.packets[0], binding: 'source' },
      { projectRoot: project },
    );
    expect(read).toMatchObject({ ok: true, value: { kind: 'workflow_input' } });
    if (!read.ok || read.value.kind !== 'workflow_input') {
      throw new Error(read.ok ? 'Expected a Workflow Input.' : read.failure.code);
    }
    expect(Buffer.from(read.value.bytes_base64, 'base64').toString('utf8')).toBe(sourceBody);

    const forged = structuredClone(prepared.value.packets[0]);
    if (forged.inputs.source?.workflow_input === undefined) {
      throw new Error('Prepared packet is missing source input.');
    }
    forged.inputs.source.workflow_input.identity = {
      device: '1',
      inode: '2',
      birthtime: '3',
    };
    const mutated = await operate(
      { operation: 'read_work_input', packet: forged, binding: 'source' },
      { projectRoot: project },
    );
    expect(mutated).toMatchObject({
      ok: false,
      failure: { code: 'invalid_work_input', diagnostics: [{ code: 'integrity' }] },
    });
  });

  it('rejects forged Workflow Input descriptor paths during read_work_input', async () => {
    const { project, runId } = await createProject(
      `
schema_version: breakdown.workflow.v1
id: forge-work-input
name: Forge Work Input
inputs:
  source:
    default: source.txt
nodes:
  - id: consume
    name: Consume
    prompt: Consume the source.
    inputs:
      source:
        workflow_input: source
`,
      {
        setup: async (projectPath) => {
          await writeFile(join(projectPath, 'source.txt'), 'source text', 'utf8');
        },
      },
    );

    const prepared = await operate(
      { operation: 'prepare_work', run_id: runId },
      { projectRoot: project },
    );
    if (!prepared.ok) throw new Error(prepared.failure.code);

    const forged = structuredClone(prepared.value.packets[0]);
    if (forged.inputs.source?.workflow_input === undefined) {
      throw new Error('Prepared packet is missing source input.');
    }
    forged.inputs.source.workflow_input.path = '../../source.txt';
    const forgedResult = await operate(
      { operation: 'read_work_input', packet: forged, binding: 'source' },
      { projectRoot: project },
    );
    expect(forgedResult).toMatchObject({
      ok: false,
      failure: {
        code: 'invalid_work_input',
        diagnostics: [{ code: 'schema', path: '/inputs/source/workflow_input' }],
      },
    });
  });

  it('reads predecessor result markdown/json and preserves result identities', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: result-input
name: Result Input
nodes:
  - id: gather
    name: Gather
    prompt: Gather.
    data_contract:
      type: object
  - id: consume
    name: Consume
    prompt: Consume.
    inputs:
      predecessor:
        node: gather
`);
    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    if (!inspected.ok) throw new Error(inspected.failure.code);
    const gatherContext = inspected.value.nodes.find(
      (node) => node.node_id === 'gather',
    )?.context_sha256;
    if (gatherContext === undefined) throw new Error('Missing gather context');

    const resultFilename = await writeStepFixture({
      project,
      runId,
      nodeId: 'gather',
      attempt: 1,
      contextSha256: gatherContext,
      settledAt: '2026-07-26T12:01:00.000Z',
      startedAt: '2026-07-26T12:00:00.000Z',
      body: 'gathered result',
      json: { score: 42 },
    });

    const prepared = await operate(
      { operation: 'prepare_work', run_id: runId },
      { projectRoot: project },
    );
    expect(prepared).toMatchObject({ ok: true });
    if (!prepared.ok) throw new Error(prepared.failure.code);
    const consumePacket = prepared.value.packets.find((packet) => packet.node.id === 'consume');
    expect(consumePacket).toBeDefined();
    expect(consumePacket?.inputs.predecessor?.result).toMatchObject({
      markdown: {
        path: `outputs/${runId}/steps/${resultFilename}`,
        identity: expect.any(Object),
      },
      json: {
        path: `outputs/${runId}/steps/${resultFilename.replace(/\.md$/, '.json')}`,
        identity: expect.any(Object),
      },
    });

    const read = await operate(
      {
        operation: 'read_work_input',
        packet: consumePacket!,
        binding: 'predecessor',
      },
      { projectRoot: project },
    );
    expect(read).toMatchObject({ ok: true, value: { kind: 'result' } });
    if (!read.ok || read.value.kind !== 'result') {
      throw new Error(read.ok ? 'Expected a Result Input.' : read.failure.code);
    }
    expect(Buffer.from(read.value.markdown_bytes_base64, 'base64').toString('utf8')).toBe(`---
{
  "schema_version": "breakdown.step-artifact.v1",
  "run_id": "${runId}",
  "node_id": "gather",
  "attempt": 1,
  "status": "succeeded",
  "started_at": "2026-07-26T12:00:00.000Z",
  "settled_at": "2026-07-26T12:01:00.000Z",
  "context_sha256": "${gatherContext}",
  "inputs": {},
  "executor": {
    "kind": "program",
    "name": "fixture"
  }
}
---
gathered result`);
    expect(
      read.value.json_bytes_base64 === null
        ? ''
        : Buffer.from(read.value.json_bytes_base64, 'base64').toString('utf8'),
    ).toBe('{"score":42}');
  });

  it('invalidates preparation when a Workflow Input changes after run creation', async () => {
    const { project, runId } = await createProject(
      `
schema_version: breakdown.workflow.v1
id: stale-work-input
name: Stale Work Input
inputs:
  source:
    default: source.txt
nodes:
  - id: consume
    name: Consume
    prompt: Consume the source.
    inputs:
      source:
        workflow_input: source
`,
      {
        setup: async (projectPath) => {
          await writeFile(join(projectPath, 'source.txt'), 'original', 'utf8');
        },
      },
    );

    await writeFile(join(project, 'source.txt'), 'updated', 'utf8');
    const prepared = await operate(
      { operation: 'prepare_work', run_id: runId },
      { projectRoot: project },
    );
    expect(prepared).toMatchObject({ ok: false, failure: { code: 'invalid_run' } });
  });

  it('invalidates preparation when a selected predecessor Result changes after snapshot', async () => {
    const { project, runId } = await createProject(`
schema_version: breakdown.workflow.v1
id: stale-result
name: Stale Result
nodes:
  - id: gather
    name: Gather
    prompt: Gather.
  - id: consume
    name: Consume
    prompt: Consume.
    inputs:
      predecessor:
        node: gather
`);
    const inspected = await operate(
      { operation: 'inspect_run', run_id: runId },
      { projectRoot: project },
    );
    if (!inspected.ok) throw new Error(inspected.failure.code);
    const gatherContext = inspected.value.nodes.find(
      (node) => node.node_id === 'gather',
    )?.context_sha256;
    if (gatherContext === undefined) throw new Error('Missing gather context');

    const filename = await writeStepFixture({
      project,
      runId,
      nodeId: 'gather',
      attempt: 1,
      contextSha256: gatherContext,
      settledAt: '2026-07-26T12:01:00.000Z',
      startedAt: '2026-07-26T12:00:00.000Z',
      body: 'gathered result',
    });
    await writeFile(join(project, 'outputs', runId, 'steps', filename), 'mutated result', 'utf8');

    const prepared = await operate(
      { operation: 'prepare_work', run_id: runId },
      { projectRoot: project },
    );
    expect(prepared).toMatchObject({ ok: false, failure: { code: 'invalid_run' } });
  });
});

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
        json: Record<string, never>;
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
        json: {},
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

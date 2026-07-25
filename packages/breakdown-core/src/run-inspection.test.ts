import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { operate } from './index.js';

const temporaryProjects: string[] = [];
const inspectionConformanceRoot = new URL(
  '../../../local/contracts/conformance/run-inspection/',
  import.meta.url,
);
const inspectionMatrix = JSON.parse(
  await readFile(new URL('matrix.json', inspectionConformanceRoot), 'utf8'),
) as { rows: Array<{ id: string; requirement: string; oracle: string }> };
const inspectionScenarios = JSON.parse(
  await readFile(new URL('fixtures/scenarios.json', inspectionConformanceRoot), 'utf8'),
) as {
  schema_version: string;
  statuses: string[];
  corruptions: string[];
  ignored_entries: string[];
};
const stepArtifactSchema = JSON.parse(
  await readFile(
    new URL(
      '../../../local/contracts/schemas/breakdown.step-artifact.v1.schema.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  additionalProperties: boolean;
  required: string[];
  properties: Record<string, unknown>;
};

async function createRun(workflow: string, setup?: (projectRoot: string) => void | Promise<void>) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-inspection-'));
  temporaryProjects.push(projectRoot);
  await writeFile(join(projectRoot, 'breakdown.yaml'), workflow, 'utf8');
  await setup?.(projectRoot);
  const created = await operate(
    { operation: 'create_run' },
    {
      projectRoot,
      testControls: {
        now: () => new Date('2026-07-24T20:00:00.000Z'),
        randomBytes: () => Buffer.alloc(8),
      },
    },
  );
  if (!created.ok) throw new Error(`Could not create fixture Run: ${created.failure.code}`);
  return { projectRoot, created: created.value };
}

type SettledStatus = 'succeeded' | 'failed' | 'blocked' | 'cancelled';

async function inspect(projectRoot: string, runId: string) {
  return operate({ operation: 'inspect_run', run_id: runId }, { projectRoot });
}

async function currentContext(projectRoot: string, runId: string, nodeId: string) {
  const inspected = await inspect(projectRoot, runId);
  if (!inspected.ok) throw new Error(`Could not inspect fixture Run: ${inspected.failure.code}`);
  const context = inspected.value.nodes.find((node) => node.node_id === nodeId)?.context_sha256;
  if (context === undefined) throw new Error(`Node ${nodeId} has no current context.`);
  return context;
}

async function writeStep(
  projectRoot: string,
  runId: string,
  {
    nodeId,
    attempt,
    status,
    contextSha256,
    settledAt,
    inputs = {},
    body = '',
  }: {
    nodeId: string;
    attempt: number;
    status: SettledStatus;
    contextSha256: string;
    settledAt: string;
    inputs?: Record<string, unknown>;
    body?: string;
  },
) {
  const startedAt = new Date(new Date(settledAt).getTime() - 1_000).toISOString();
  const frontmatter = {
    schema_version: 'breakdown.step-artifact.v1',
    run_id: runId,
    node_id: nodeId,
    attempt,
    status,
    started_at: startedAt,
    settled_at: settledAt,
    context_sha256: contextSha256,
    inputs,
    executor: {
      kind: 'program',
      name: 'inspection-fixture',
    },
    ...(status === 'succeeded'
      ? {}
      : {
          problem: {
            code: `fixture_${status}`,
            message: `Fixture ${status}.`,
          },
        }),
  };
  const compactSettledAt = settledAt.replaceAll('-', '').replaceAll(':', '');
  const filename = `${compactSettledAt}--${nodeId}--a${attempt}.md`;
  const relativePath = `outputs/${runId}/steps/${filename}`;
  await writeFile(
    join(projectRoot, relativePath),
    `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n${body}`,
    'utf8',
  );
  return relativePath;
}

async function resultFileDescriptor(projectRoot: string, path: string) {
  return {
    path,
    sha256: createHash('sha256')
      .update(await readFile(join(projectRoot, path)))
      .digest('hex'),
  };
}

async function writeSidecar(projectRoot: string, markdownPath: string, value: unknown) {
  const path = markdownPath.replace(/\.md$/, '.json');
  await writeFile(join(projectRoot, path), JSON.stringify(value), 'utf8');
  return resultFileDescriptor(projectRoot, path);
}

afterEach(async () => {
  await Promise.all(
    temporaryProjects
      .splice(0)
      .map((projectRoot) => rm(projectRoot, { recursive: true, force: true })),
  );
});

describe('inspect_run', () => {
  it('should publish the StepArtifact contract and complete inspection fixture catalog', () => {
    expect(stepArtifactSchema).toMatchObject({
      additionalProperties: false,
      required: [
        'schema_version',
        'run_id',
        'node_id',
        'attempt',
        'status',
        'started_at',
        'settled_at',
        'context_sha256',
        'inputs',
        'executor',
      ],
    });
    expect(Object.keys(stepArtifactSchema.properties)).toEqual([
      'schema_version',
      'run_id',
      'node_id',
      'attempt',
      'status',
      'started_at',
      'settled_at',
      'context_sha256',
      'inputs',
      'executor',
      'problem',
      'extensions',
    ]);
    expect(inspectionMatrix.rows.map((row) => row.id)).toEqual(
      Array.from({ length: 12 }, (_, index) => `INS-${String(index + 1).padStart(3, '0')}`),
    );
    expect(inspectionScenarios).toMatchObject({
      schema_version: 'breakdown.run-inspection-fixtures.v1',
      statuses: ['succeeded', 'failed', 'blocked', 'cancelled'],
      corruptions: expect.arrayContaining([
        'run-manifest',
        'workflow-snapshot',
        'workflow-input',
        'step-frontmatter',
        'step-filename',
        'step-identity',
        'step-timestamp',
        'step-context',
        'step-input-membership',
        'result-reference',
        'result-markdown-hash',
        'result-json-hash',
        'data-contract',
        'missing-pair',
        'unexpected-pair',
        'attempt-gap',
        'duplicate-attempt',
        'unsupported-run-version',
        'unsupported-step-version',
      ]),
      ignored_entries: ['temporary-entry', 'orphan-json', 'unrelated-markdown', 'unrelated-entry'],
    });
  });

  it('should inspect one exact newly created Run and derive its initial runnable state', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: inspect
name: Inspect
nodes:
  - id: gather
    name: Gather
    prompt: Gather evidence.
`);

    const result = await operate(
      { operation: 'inspect_run', run_id: created.run_id },
      { projectRoot },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        run_id: created.run_id,
        path: created.path,
        status: 'incomplete',
        resumable: true,
        workflow: created.workflow,
        inputs: {},
        nodes: [
          {
            node_id: 'gather',
            state: 'runnable',
            stale: false,
            next_attempt: 1,
            context_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
          },
        ],
        attempts: [],
        terminal_results: [],
        lock: null,
      },
    });
  });

  it.each(['succeeded', 'failed', 'blocked', 'cancelled'] as const)(
    'should validate a committed %s StepArtifact and derive state from its settled status',
    async (status) => {
      const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: statuses
name: Statuses
nodes:
  - id: execute
    name: Execute
    prompt: Execute once.
`);
      const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
      await writeStep(projectRoot, created.run_id, {
        nodeId: 'execute',
        attempt: 1,
        status,
        contextSha256,
        settledAt: '2026-07-24T20:01:00.000Z',
        body: status === 'succeeded' ? 'Result' : 'Diagnostic',
      });

      const result = await inspect(projectRoot, created.run_id);

      expect(result).toMatchObject({
        ok: true,
        value: {
          status: status === 'succeeded' ? 'complete' : 'incomplete',
          nodes: [
            {
              node_id: 'execute',
              state: status === 'succeeded' ? 'complete' : 'runnable',
              next_attempt: 2,
            },
          ],
          attempts: [
            {
              node_id: 'execute',
              attempt: 1,
              status,
              selected: status === 'succeeded',
            },
          ],
        },
      });
    },
  );

  it('should select the greatest matching successful attempt independently of timestamps', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: attempt-order
name: Attempt Order
nodes:
  - id: execute
    name: Execute
    prompt: Execute repeatedly.
`);
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'succeeded',
      contextSha256,
      settledAt: '2026-07-24T20:03:00.000Z',
      body: 'Attempt one',
    });
    await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 2,
      status: 'succeeded',
      contextSha256,
      settledAt: '2026-07-24T20:02:00.000Z',
      body: 'Attempt two',
    });

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        nodes: [
          {
            node_id: 'execute',
            state: 'complete',
            next_attempt: 3,
            selected_result: {
              node_id: 'execute',
              attempt: 2,
            },
          },
        ],
        attempts: [
          { attempt: 1, selected: false },
          { attempt: 2, selected: true },
        ],
        terminal_results: [{ node_id: 'execute', attempt: 2 }],
      },
    });
  });

  it('should validate exact predecessor references and stale descendants after successful refresh', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: references
name: References
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
`);
    const gatherContext = await currentContext(projectRoot, created.run_id, 'gather');
    const gatherOnePath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'gather',
      attempt: 1,
      status: 'succeeded',
      contextSha256: gatherContext,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'First evidence',
    });
    const synthesizeContext = await currentContext(projectRoot, created.run_id, 'synthesize');
    await writeStep(projectRoot, created.run_id, {
      nodeId: 'synthesize',
      attempt: 1,
      status: 'succeeded',
      contextSha256: synthesizeContext,
      settledAt: '2026-07-24T20:02:00.000Z',
      inputs: {
        evidence: {
          result: {
            node_id: 'gather',
            attempt: 1,
            markdown: await resultFileDescriptor(projectRoot, gatherOnePath),
          },
        },
      },
      body: 'Synthesis',
    });

    const complete = await inspect(projectRoot, created.run_id);
    expect(complete).toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        nodes: [
          { node_id: 'gather', state: 'complete' },
          { node_id: 'synthesize', state: 'complete', stale: false },
        ],
        terminal_results: [{ node_id: 'synthesize', attempt: 1 }],
      },
    });

    await writeStep(projectRoot, created.run_id, {
      nodeId: 'gather',
      attempt: 2,
      status: 'succeeded',
      contextSha256: gatherContext,
      settledAt: '2026-07-24T20:03:00.000Z',
      body: 'Refreshed evidence with identical semantics',
    });

    const refreshed = await inspect(projectRoot, created.run_id);
    expect(refreshed).toMatchObject({
      ok: true,
      value: {
        status: 'incomplete',
        nodes: [
          {
            node_id: 'gather',
            state: 'complete',
            selected_result: { attempt: 2 },
          },
          {
            node_id: 'synthesize',
            state: 'runnable',
            stale: true,
            next_attempt: 2,
          },
        ],
        terminal_results: [],
      },
    });
  });

  it('should retain a prior Selected Result after a later non-successful attempt', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: retained-success
name: Retained Success
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'succeeded',
      contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'Good Result',
    });
    await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 2,
      status: 'failed',
      contextSha256,
      settledAt: '2026-07-24T20:02:00.000Z',
      body: 'Refresh failed',
    });

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        nodes: [
          {
            node_id: 'execute',
            state: 'complete',
            next_attempt: 3,
            selected_result: { attempt: 1 },
          },
        ],
      },
    });
  });

  it('should require and expose a contracted successful JSON Result', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: paired-result
name: Paired Result
nodes:
  - id: execute
    name: Execute
    prompt: Return a structured answer.
    data_contract:
      type: object
      required: [answer]
      properties:
        answer:
          type: string
      additionalProperties: false
`);
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    const markdownPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'succeeded',
      contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'Structured Result',
    });
    const json = await writeSidecar(projectRoot, markdownPath, { answer: 'yes' });

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        nodes: [
          {
            selected_result: {
              markdown: { path: markdownPath },
              json,
            },
          },
        ],
      },
    });
  });

  it('should invalidate a successful JSON Result that violates its Data Contract', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: invalid-contract
name: Invalid Contract
nodes:
  - id: execute
    name: Execute
    prompt: Return a structured answer.
    data_contract:
      type: object
      required: [answer]
      properties:
        answer:
          type: string
      additionalProperties: false
`);
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    const markdownPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'succeeded',
      contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'Structured Result',
    });
    await writeSidecar(projectRoot, markdownPath, { answer: 42, extra: true });

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_run',
        diagnostics: [
          {
            code: 'data_contract',
            file: markdownPath.replace(/\.md$/, '.json'),
            path: '/answer',
          },
          {
            code: 'data_contract',
            file: markdownPath.replace(/\.md$/, '.json'),
            path: '/extra',
          },
        ],
      },
    });
  });

  it('should require an exact Run ID without inferring the only or latest Run', async () => {
    const { projectRoot } = await createRun(`schema_version: breakdown.workflow.v1
id: exact-run
name: Exact Run
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);

    const missing = await operate({ operation: 'inspect_run' } as Parameters<typeof operate>[0], {
      projectRoot,
    });
    const unknown = await inspect(projectRoot, '20260724T200001.000Z--exact-run--aaaaaaaaaaaa');

    for (const result of [missing, unknown]) {
      expect(result).toEqual({
        ok: false,
        failure: {
          kind: 'invalid',
          code: 'run_not_found',
          message: 'The exact Run was not found.',
          diagnostics: [],
        },
      });
    }
  });

  it('should ignore temporary, orphan JSON, and unrelated direct step entries', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: ignored-entries
name: Ignored Entries
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const stepsPath = join(projectRoot, created.path, 'steps');
    await writeFile(join(stepsPath, '.publish.tmp'), 'partial');
    await writeFile(join(stepsPath, '20260724T200100.000Z--execute--a1.json'), '{"orphan":true}');
    await writeFile(join(stepsPath, 'notes.md'), 'unrelated');
    await writeFile(join(stepsPath, '20260724T200100.000Z--execute--a01.md'), 'non-normative');

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'incomplete',
        attempts: [],
        nodes: [{ node_id: 'execute', state: 'runnable', next_attempt: 1 }],
      },
    });
  });

  it.each([
    ['missing contracted', true, 'succeeded', false],
    ['unexpected uncontracted', false, 'succeeded', true],
    ['unexpected non-success', false, 'failed', true],
  ] as const)(
    'should invalidate %s Result pairing',
    async (_case, contracted, status, addSidecar) => {
      const dataContract = contracted
        ? `    data_contract:
      type: object
`
        : '';
      const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: pairing
name: Pairing
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
${dataContract}`);
      const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
      const markdownPath = await writeStep(projectRoot, created.run_id, {
        nodeId: 'execute',
        attempt: 1,
        status,
        contextSha256,
        settledAt: '2026-07-24T20:01:00.000Z',
      });
      if (addSidecar) await writeSidecar(projectRoot, markdownPath, {});

      const result = await inspect(projectRoot, created.run_id);

      expect(result).toMatchObject({
        ok: false,
        failure: {
          kind: 'invalid',
          code: 'invalid_run',
          diagnostics: [{ code: 'status_invariant', file: markdownPath }],
        },
      });
    },
  );

  it('should invalidate attempt gaps and duplicate per-node attempt identities', async () => {
    for (const corruption of ['gap', 'duplicate'] as const) {
      const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: attempts
name: Attempts
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
      const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
      await writeStep(projectRoot, created.run_id, {
        nodeId: 'execute',
        attempt: corruption === 'gap' ? 2 : 1,
        status: 'failed',
        contextSha256,
        settledAt: '2026-07-24T20:01:00.000Z',
      });
      if (corruption === 'duplicate') {
        await writeStep(projectRoot, created.run_id, {
          nodeId: 'execute',
          attempt: 1,
          status: 'cancelled',
          contextSha256,
          settledAt: '2026-07-24T20:02:00.000Z',
        });
      }

      const result = await inspect(projectRoot, created.run_id);

      expect(result, corruption).toMatchObject({
        ok: false,
        failure: {
          kind: 'invalid',
          code: 'invalid_run',
        },
      });
      if (result.ok) throw new Error('Expected invalid attempt history.');
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'duplicate_attempt', path: '/attempt' }),
        ]),
      );
    }
  });

  it.each([
    ['context digest', 'integrity'],
    ['filename timestamp', 'layout'],
    ['malformed frontmatter', 'parse'],
    ['unknown artifact version', 'unsupported_version'],
  ] as const)('should invalidate committed corruption in %s', async (corruption, code) => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: corrupt
name: Corrupt
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    const markdownPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'failed',
      contextSha256: corruption === 'context digest' ? '0'.repeat(64) : contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
    });
    let diagnosticFile = markdownPath;
    if (corruption === 'filename timestamp') {
      diagnosticFile = markdownPath.replace('200100.000Z', '200200.000Z');
      await rename(join(projectRoot, markdownPath), join(projectRoot, diagnosticFile));
    } else if (corruption === 'malformed frontmatter') {
      await writeFile(join(projectRoot, markdownPath), '---\nnot: [valid\n---\n');
    } else if (corruption === 'unknown artifact version') {
      const source = await readFile(join(projectRoot, markdownPath), 'utf8');
      await writeFile(
        join(projectRoot, markdownPath),
        source.replace('breakdown.step-artifact.v1', 'breakdown.step-artifact.v2'),
      );
    }

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: code === 'unsupported_version' ? 'unsupported' : 'invalid',
        diagnostics: [{ code, file: diagnosticFile }],
      },
    });
  });

  it('should order Run diagnostics by file, RFC 6901 path, then code', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: ordered-diagnostics
name: Ordered Diagnostics
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const laterFile = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 2,
      status: 'failed',
      contextSha256: '0'.repeat(64),
      settledAt: '2026-07-24T20:02:00.000Z',
    });
    const earlierFile = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'failed',
      contextSha256: '0'.repeat(64),
      settledAt: '2026-07-24T20:01:00.000Z',
    });

    const result = await inspect(projectRoot, created.run_id);
    if (result.ok) throw new Error('Expected invalid Run.');

    const order = result.failure.diagnostics.map(({ file, path, code }) => ({
      file,
      path,
      code,
    }));
    expect(order).toEqual(
      [...order].sort(
        (left, right) =>
          left.file!.localeCompare(right.file!) ||
          left.path.localeCompare(right.path) ||
          left.code.localeCompare(right.code),
      ),
    );
    expect(order.map((item) => item.file)).toContain(earlierFile);
    expect(order.map((item) => item.file)).toContain(laterFile);
  });

  it('should validate exact Workflow Input membership, references, and raw bytes', async () => {
    const { projectRoot, created } = await createRun(
      `schema_version: breakdown.workflow.v1
id: workflow-input
name: Workflow Input
inputs:
  brief:
    description: Exact brief
    default: brief.txt
nodes:
  - id: execute
    name: Execute
    prompt: Use the brief.
    inputs:
      brief:
        workflow_input: brief
`,
      (projectRoot) => writeFile(join(projectRoot, 'brief.txt'), 'exact input'),
    );
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'succeeded',
      contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
      inputs: {
        brief: {
          workflow_input: 'brief',
        },
      },
      body: 'Used exact input',
    });
    expect(await inspect(projectRoot, created.run_id)).toMatchObject({
      ok: true,
      value: { status: 'complete' },
    });

    await writeFile(join(projectRoot, 'brief.txt'), 'mutated input');
    const before = await readFile(join(projectRoot, 'brief.txt'));
    const result = await inspect(projectRoot, created.run_id);
    const after = await readFile(join(projectRoot, 'brief.txt'));

    expect(result).toMatchObject({
      ok: false,
      failure: {
        code: 'invalid_run',
        diagnostics: [
          {
            code: 'integrity',
            file: `${created.path}/run.md`,
            path: '/inputs/brief/sha256',
          },
        ],
      },
    });
    expect(after).toEqual(before);
  });

  it.each([
    ['Workflow Snapshot bytes', 'snapshot'],
    ['Run Manifest timestamp', 'timestamp'],
    ['Run Manifest version', 'version'],
  ] as const)('should fail closed on corrupted %s without repair', async (_label, corruption) => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: run-records
name: Run Records
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const relativePath =
      corruption === 'snapshot' ? `${created.path}/breakdown.yaml` : `${created.path}/run.md`;
    const path = join(projectRoot, relativePath);
    const original = await readFile(path, 'utf8');
    const corrupted =
      corruption === 'snapshot'
        ? original.replace('Execute.', 'Execute differently.')
        : corruption === 'timestamp'
          ? original.replace('2026-07-24T20:00:00.000Z', '2026-07-24T20:00:01.000Z')
          : original.replace('breakdown.run.v1', 'breakdown.run.v2');
    await writeFile(path, corrupted);

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: corruption === 'version' ? 'unsupported' : 'invalid',
        diagnostics: [
          {
            code:
              corruption === 'snapshot'
                ? 'integrity'
                : corruption === 'timestamp'
                  ? 'layout'
                  : 'unsupported_version',
            file: relativePath,
          },
        ],
      },
    });
    expect(await readFile(path, 'utf8')).toBe(corrupted);
  });

  it('should invalidate a mismatched predecessor Result digest', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: bad-reference
name: Bad Reference
nodes:
  - id: gather
    name: Gather
    prompt: Gather.
  - id: use
    name: Use
    prompt: Use the Result.
    inputs:
      evidence:
        node: gather
`);
    const gatherContext = await currentContext(projectRoot, created.run_id, 'gather');
    const gatherPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'gather',
      attempt: 1,
      status: 'succeeded',
      contextSha256: gatherContext,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'Evidence',
    });
    const useContext = await currentContext(projectRoot, created.run_id, 'use');
    const usePath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'use',
      attempt: 1,
      status: 'succeeded',
      contextSha256: useContext,
      settledAt: '2026-07-24T20:02:00.000Z',
      inputs: {
        evidence: {
          result: {
            node_id: 'gather',
            attempt: 1,
            markdown: {
              ...(await resultFileDescriptor(projectRoot, gatherPath)),
              sha256: '0'.repeat(64),
            },
          },
        },
      },
    });

    const result = await inspect(projectRoot, created.run_id);
    if (result.ok) throw new Error('Expected an invalid Result reference.');

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'integrity',
          file: usePath,
          path: '/inputs/evidence/result/markdown',
        }),
        expect.objectContaining({
          code: 'integrity',
          file: usePath,
          path: '/context_sha256',
        }),
      ]),
    );
  });

  it.each([
    ['succeeded with problem', 'succeeded'],
    ['failed without problem', 'failed'],
  ] as const)('should enforce the %s status invariant', async (_label, status) => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: status-invariant
name: Status Invariant
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    const markdownPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status,
      contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
    });
    const path = join(projectRoot, markdownPath);
    const source = await readFile(path, 'utf8');
    await writeFile(
      path,
      status === 'succeeded'
        ? source.replace(
            '  "executor": {',
            '  "problem": {"code":"unexpected","message":"Unexpected"},\n  "executor": {',
          )
        : source.replace(
            ',\n  "problem": {\n    "code": "fixture_failed",\n    "message": "Fixture failed."\n  }',
            '',
          ),
    );

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        diagnostics: [
          {
            code: 'status_invariant',
            file: markdownPath,
            path: '/problem',
          },
        ],
      },
    });
  });

  it('should validate committed Markdown independently when the Snapshot is malformed', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: independent-records
name: Independent Records
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    const stepPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'failed',
      contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
    });
    await writeFile(join(projectRoot, stepPath), '---\ninvalid: [yaml\n---\n');
    await writeFile(join(projectRoot, created.path, 'breakdown.yaml'), 'nodes: [');

    const result = await inspect(projectRoot, created.run_id);
    if (result.ok) throw new Error('Expected independently invalid records.');

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'parse',
          file: `${created.path}/breakdown.yaml`,
        }),
        expect.objectContaining({
          code: 'parse',
          file: stepPath,
        }),
      ]),
    );
  });

  it('should invalidate a StepArtifact identity that names another Run', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: artifact-identity
name: Artifact Identity
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    const stepPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'failed',
      contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
    });
    const path = join(projectRoot, stepPath);
    const source = await readFile(path, 'utf8');
    await writeFile(
      path,
      source.replace(created.run_id, '20260724T200000.000Z--artifact-identity--bbbbbbbbbbbb'),
    );

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        diagnostics: [
          {
            code: 'reference_mismatch',
            file: stepPath,
            path: '/run_id',
          },
        ],
      },
    });
  });

  it('should invalidate committed StepArtifact Input membership drift', async () => {
    const { projectRoot, created } = await createRun(
      `schema_version: breakdown.workflow.v1
id: input-membership
name: Input Membership
inputs:
  brief:
    default: brief.txt
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
    inputs:
      brief:
        workflow_input: brief
`,
      (projectRoot) => writeFile(join(projectRoot, 'brief.txt'), 'brief'),
    );
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    const stepPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'succeeded',
      contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
      inputs: {},
    });

    const result = await inspect(projectRoot, created.run_id);
    if (result.ok) throw new Error('Expected invalid Input membership.');

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'reference_mismatch',
          file: stepPath,
          path: '/inputs',
        }),
      ]),
    );
  });

  it('should invalidate a mismatched predecessor JSON Result digest', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: json-reference
name: JSON Reference
nodes:
  - id: gather
    name: Gather
    prompt: Gather.
    data_contract:
      type: object
  - id: use
    name: Use
    prompt: Use.
    inputs:
      evidence:
        node: gather
`);
    const gatherContext = await currentContext(projectRoot, created.run_id, 'gather');
    const gatherPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'gather',
      attempt: 1,
      status: 'succeeded',
      contextSha256: gatherContext,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'Evidence',
    });
    const gatherJson = await writeSidecar(projectRoot, gatherPath, { evidence: true });
    const useContext = await currentContext(projectRoot, created.run_id, 'use');
    const usePath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'use',
      attempt: 1,
      status: 'succeeded',
      contextSha256: useContext,
      settledAt: '2026-07-24T20:02:00.000Z',
      inputs: {
        evidence: {
          result: {
            node_id: 'gather',
            attempt: 1,
            markdown: await resultFileDescriptor(projectRoot, gatherPath),
            json: {
              ...gatherJson,
              sha256: '0'.repeat(64),
            },
          },
        },
      },
    });

    const result = await inspect(projectRoot, created.run_id);
    if (result.ok) throw new Error('Expected invalid JSON Result reference.');

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'integrity',
          file: usePath,
          path: '/inputs/evidence/result/json',
        }),
      ]),
    );
  });
});

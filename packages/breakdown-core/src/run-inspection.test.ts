import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { operate } from './index.js';

const stepArtifactReadProbe = vi.hoisted(() => {
  let active = 0;
  let enabled = false;
  let maximum = 0;
  let observed = 0;
  let releaseGate: (() => void) | undefined;
  let startGate = Promise.resolve();

  return {
    begin() {
      active = 0;
      enabled = true;
      maximum = 0;
      observed = 0;
      startGate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
    },
    async started(path: string) {
      if (!enabled || !path.includes('/steps/') || !path.endsWith('.md')) return false;
      active += 1;
      observed += 1;
      maximum = Math.max(maximum, active);
      if (active === 1) {
        setImmediate(() => releaseGate?.());
      } else {
        releaseGate?.();
        releaseGate = undefined;
      }
      await startGate;
      return true;
    },
    settled(wasObserved: boolean) {
      if (wasObserved) active -= 1;
    },
    finish() {
      enabled = false;
      releaseGate?.();
      releaseGate = undefined;
      return { maximum, observed };
    },
  };
});

vi.mock('./secure-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./secure-store.js')>();
  return {
    ...actual,
    readSecureResultFile: async (...args: Parameters<typeof actual.readSecureResultFile>) => {
      const wasObserved = await stepArtifactReadProbe.started(args[1]);
      try {
        return await actual.readSecureResultFile(...args);
      } finally {
        stepArtifactReadProbe.settled(wasObserved);
      }
    },
  };
});

const temporaryProjects: string[] = [];
const inspectionConformanceRoot = new URL(
  '../../../local/contracts/conformance/run-inspection/',
  import.meta.url,
);
const derivationConformanceRoot = new URL(
  '../../../local/contracts/conformance/run-derivation/',
  import.meta.url,
);
const hashConformanceRoot = new URL(
  '../../../local/contracts/conformance/hashing/',
  import.meta.url,
);
const inspectionMatrix = JSON.parse(
  await readFile(new URL('matrix.json', inspectionConformanceRoot), 'utf8'),
) as { rows: Array<{ id: string; requirement: string; oracle: string }> };
const inspectionScenarios = JSON.parse(
  await readFile(new URL('fixtures/scenarios.json', inspectionConformanceRoot), 'utf8'),
) as {
  schema_version: string;
  statuses: Array<{ id: string; case_ref: string }>;
  corruptions: Array<{ id: string; case_ref: string }>;
  ignored_entries: Array<{ id: string; case_ref: string }>;
};
const derivationMatrix = JSON.parse(
  await readFile(new URL('matrix.json', derivationConformanceRoot), 'utf8'),
) as { rows: Array<{ id: string; requirement: string; oracle: string }> };
const hashVectors = JSON.parse(
  await readFile(new URL('fixtures/hash-vectors.json', hashConformanceRoot), 'utf8'),
) as {
  schema_version: string;
  raw_files: Array<{
    id: string;
    bytes_base64: string;
    sha256: string;
  }>;
  raw_semantic_pairs: Array<{
    id: string;
    left: string;
    right: string;
    decoded_semantic_value: unknown;
  }>;
  node_contexts: Array<{
    id: string;
    canonical_jcs: string;
    sha256: string;
  }>;
  included_context_factors: Array<{
    factor: string;
    baseline_vector: string;
    mutated_vector: string;
    mutation: unknown;
  }>;
  excluded_context_factors: Array<{
    factor: string;
    baseline_vector: string;
    expected_vector: string;
    mutation: unknown;
  }>;
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

function nodeContextVector(id: string) {
  const vector = hashVectors.node_contexts.find((candidate) => candidate.id === id);
  if (vector === undefined) throw new Error(`Missing Node Context vector: ${id}`);
  return vector;
}

function rawFileVector(id: string) {
  const vector = hashVectors.raw_files.find((candidate) => candidate.id === id);
  if (vector === undefined) throw new Error(`Missing raw file vector: ${id}`);
  return vector;
}

async function createRun(
  workflow: string,
  setup?: (projectRoot: string) => void | Promise<void>,
  options: {
    inputs?: Record<string, string>;
    now?: string;
  } = {},
) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-inspection-'));
  temporaryProjects.push(projectRoot);
  await writeFile(join(projectRoot, 'breakdown.yaml'), workflow, 'utf8');
  await setup?.(projectRoot);
  const created = await operate(
    {
      operation: 'create_run',
      ...(options.inputs === undefined ? {} : { inputs: options.inputs }),
    },
    {
      projectRoot,
      testControls: {
        now: () => new Date(options.now ?? '2026-07-24T20:00:00.000Z'),
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

async function replaceWorkflowSnapshot(
  projectRoot: string,
  run: { path: string; workflow: { sha256: string } },
  replace: (snapshot: string) => string,
) {
  const snapshotPath = join(projectRoot, run.path, 'breakdown.yaml');
  const snapshot = await readFile(snapshotPath, 'utf8');
  const replacement = replace(snapshot);
  await writeFile(snapshotPath, replacement, 'utf8');
  const replacementDigest = createHash('sha256').update(replacement).digest('hex');
  const manifestPath = join(projectRoot, run.path, 'run.md');
  const manifest = await readFile(manifestPath, 'utf8');
  await writeFile(manifestPath, manifest.replace(run.workflow.sha256, replacementDigest), 'utf8');
}

afterEach(async () => {
  stepArtifactReadProbe.finish();
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
    const executorSchema = stepArtifactSchema.properties.executor as {
      additionalProperties: boolean;
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(executorSchema).toMatchObject({
      additionalProperties: false,
      required: ['kind', 'name'],
    });
    expect(Object.keys(executorSchema.properties)).toEqual(['kind', 'name', 'version']);
    expect(inspectionMatrix.rows.map((row) => row.id)).toEqual(
      Array.from(
        { length: 13 },
        (_, index) => `CASE-RUN-INSPECT-${String(index + 1).padStart(3, '0')}`,
      ),
    );
    expect(inspectionScenarios.schema_version).toBe('breakdown.run-inspection-fixtures.v1');
    expect(inspectionScenarios.statuses.map(({ id }) => id)).toEqual([
      'succeeded',
      'failed',
      'blocked',
      'cancelled',
    ]);
    expect(inspectionScenarios.corruptions.map(({ id }) => id)).toEqual([
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
    ]);
    expect(inspectionScenarios.ignored_entries.map(({ id }) => id)).toEqual([
      'temporary-entry',
      'orphan-json',
      'unrelated-markdown',
      'unrelated-entry',
    ]);
  });

  it('should publish the complete Run derivation conformance catalog', () => {
    expect(derivationMatrix.rows.map((row) => row.id)).toEqual(
      Array.from(
        { length: 7 },
        (_, index) => `CASE-RUN-DERIVE-${String(index + 1).padStart(3, '0')}`,
      ),
    );
    expect(hashVectors).toMatchObject({
      schema_version: 'breakdown.hash-vectors.v1',
      raw_files: [
        { id: 'empty' },
        { id: 'binary' },
        { id: 'utf8-bom' },
        { id: 'lf' },
        { id: 'crlf' },
        { id: 'no-trailing-newline' },
        { id: 'workflow-comments-order-a' },
        { id: 'workflow-comments-order-b' },
        { id: 'json-raw-semantic-a' },
        { id: 'json-raw-semantic-b' },
      ],
    });
    expect(hashVectors.node_contexts.map((vector) => vector.id)).toEqual([
      'node-definition-workflow-input-baseline',
      'included-run-id',
      'included-node-id',
      'included-node-name',
      'included-node-prompt',
      'included-input-bindings',
      'included-data-contract',
      'included-workflow-input-id',
      'included-workflow-input-description',
      'included-workflow-input-path',
      'included-workflow-input-sha256',
      'included-predecessor-result',
      'predecessor-baseline',
      'included-predecessor-node-id',
      'included-predecessor-attempt',
      'included-predecessor-markdown-path',
      'included-predecessor-markdown-sha256',
      'included-predecessor-json-path',
      'included-predecessor-json-sha256',
      'normalized-absent-node-fields',
      'normalized-absent-result-json',
      'normalized-absent-workflow-input-description',
      'rfc-8785-numbers',
      'rfc-8785-escaping',
      'rfc-8785-unicode-ordering',
    ]);
    expect(hashVectors.included_context_factors.map(({ factor }) => factor)).toEqual([
      'run-id',
      'node-id',
      'node-name',
      'node-prompt',
      'input-bindings',
      'data-contract',
      'workflow-input-id',
      'workflow-input-description',
      'workflow-input-path',
      'workflow-input-sha256',
      'predecessor-node-id',
      'predecessor-attempt',
      'predecessor-markdown-path',
      'predecessor-markdown-sha256',
      'predecessor-json-path',
      'predecessor-json-sha256',
    ]);
    expect(hashVectors.excluded_context_factors.map(({ factor }) => factor)).toEqual([
      'extensions',
      'unrelated-nodes',
      'author-order-position',
      'workflow-input-default-after-resolution',
      'timestamps',
      'executor-metadata',
      'status-problem-outcome',
      'executing-attempt',
      'candidate-result',
      'host-transport-environment',
      'absolute-root',
      'filesystem-metadata',
    ]);
    const vectorIds = new Set(hashVectors.node_contexts.map((vector) => vector.id));
    for (const factor of hashVectors.included_context_factors) {
      expect(vectorIds.has(factor.baseline_vector), factor.factor).toBe(true);
      expect(vectorIds.has(factor.mutated_vector), factor.factor).toBe(true);
      expect(nodeContextVector(factor.mutated_vector).sha256, factor.factor).not.toBe(
        nodeContextVector(factor.baseline_vector).sha256,
      );
    }
    for (const factor of hashVectors.excluded_context_factors) {
      expect(vectorIds.has(factor.baseline_vector), factor.factor).toBe(true);
      expect(vectorIds.has(factor.expected_vector), factor.factor).toBe(true);
      expect(nodeContextVector(factor.expected_vector).sha256, factor.factor).toBe(
        nodeContextVector(factor.baseline_vector).sha256,
      );
    }
    for (const vector of hashVectors.node_contexts) {
      expect(createHash('sha256').update(vector.canonical_jcs).digest('hex'), vector.id).toBe(
        vector.sha256,
      );
    }
  });

  it.each(hashVectors.raw_files)(
    'should match the independent $id raw file SHA-256 vector',
    async (vector) => {
      const { projectRoot, created } = await createRun(
        `schema_version: breakdown.workflow.v1
id: raw-${vector.id}
name: Raw Hash
inputs:
  source:
    default: source.bin
nodes:
  - id: consume
    name: Consume
    prompt: Consume the source.
    inputs:
      source:
        workflow_input: source
`,
        (projectRoot) =>
          writeFile(join(projectRoot, 'source.bin'), Buffer.from(vector.bytes_base64, 'base64')),
      );

      const result = await inspect(projectRoot, created.run_id);

      expect(result).toMatchObject({
        ok: true,
        value: {
          inputs: {
            source: {
              path: 'source.bin',
              sha256: vector.sha256,
            },
          },
        },
      });
    },
  );

  it('should preserve Workflow semantics while comments and authored order change raw Snapshot hashes', async () => {
    const pair = hashVectors.raw_semantic_pairs.find(({ id }) => id === 'workflow-comments-order');
    if (pair === undefined) throw new Error('Missing Workflow comments/order pair.');

    const observedHashes: string[] = [];
    for (const vectorId of [pair.left, pair.right]) {
      const vector = rawFileVector(vectorId);
      const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-workflow-raw-pair-'));
      temporaryProjects.push(projectRoot);
      await writeFile(
        join(projectRoot, 'breakdown.yaml'),
        Buffer.from(vector.bytes_base64, 'base64'),
      );

      const validation = await operate({ operation: 'validate_workflow' }, { projectRoot });
      expect(validation).toEqual({
        ok: true,
        value: {
          definitionPath: 'breakdown.yaml',
          workflow: pair.decoded_semantic_value,
        },
      });

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
      expect(created).toMatchObject({
        ok: true,
        value: { workflow: { sha256: vector.sha256 } },
      });
      observedHashes.push(vector.sha256);
    }
    expect(observedHashes).toEqual([
      'c2d5087afba9b01bfaf6f4179b6f2317507f11cd5feff342bf47013ceac0ba6b',
      'a2ad20df462a2233001cbf47e9a686b553db6b0573fb7877c2cbf862baa3c381',
    ]);
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

  it('should match the independent RFC 8785 Node Context number vector', async () => {
    const vector = nodeContextVector('rfc-8785-numbers');
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: jcs-numbers
name: JCS Numbers
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
    data_contract:
      const:
        numbers:
          - 333333333.33333329
          - 1E30
          - 4.50
          - 2e-3
          - 0.000000000000000000000000001
          - 9007199254740993
`);

    const result = await inspect(projectRoot, created.run_id);

    expect(createHash('sha256').update(vector.canonical_jcs).digest('hex')).toBe(vector.sha256);
    expect(result).toMatchObject({
      ok: true,
      value: {
        nodes: [
          {
            node_id: 'execute',
            context_sha256: vector.sha256,
          },
        ],
      },
    });
  });

  it('should match the independent Node Definition and Workflow Input context vector', async () => {
    const vector = nodeContextVector('node-definition-workflow-input-baseline');
    const { projectRoot, created } = await createRun(
      `schema_version: breakdown.workflow.v1
id: context-factors
name: Context Factors
inputs:
  source:
    description: Source material.
    default: default.txt
nodes:
  - id: execute
    name: Execute
    prompt: Use source.
    inputs:
      material:
        workflow_input: source
    data_contract:
      type: string
`,
      (projectRoot) => writeFile(join(projectRoot, 'selected.bin'), 'content'),
      { inputs: { source: 'selected.bin' } },
    );

    const result = await inspect(projectRoot, created.run_id);

    expect(createHash('sha256').update(vector.canonical_jcs).digest('hex')).toBe(vector.sha256);
    expect(result).toMatchObject({
      ok: true,
      value: {
        nodes: [
          {
            node_id: 'execute',
            context_sha256: vector.sha256,
          },
        ],
      },
    });
  });

  it('should match a Node Context vector containing the Selected Result from a Predecessor', async () => {
    const vector = nodeContextVector('included-predecessor-result');
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: predecessor-vector
name: Predecessor Vector
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
    await writeSidecar(projectRoot, gatherPath, { a: 1 });

    expect(await currentContext(projectRoot, created.run_id, 'consume')).toBe(vector.sha256);
  });

  it('should match independent absent-field normalization vectors', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: null-normalizations
name: Null Normalizations
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
    const gatherContext = await currentContext(projectRoot, created.run_id, 'gather');
    expect(gatherContext).toBe(nodeContextVector('normalized-absent-node-fields').sha256);
    await writeStep(projectRoot, created.run_id, {
      nodeId: 'gather',
      attempt: 1,
      status: 'succeeded',
      contextSha256: gatherContext,
      settledAt: '2026-07-24T20:01:00.000Z',
    });
    expect(await currentContext(projectRoot, created.run_id, 'consume')).toBe(
      nodeContextVector('normalized-absent-result-json').sha256,
    );

    const withoutDescription = await createRun(
      `schema_version: breakdown.workflow.v1
id: null-description
name: Null Description
inputs:
  source:
    default: source.bin
nodes:
  - id: consume
    name: Consume
    prompt: Consume.
    inputs:
      source:
        workflow_input: source
`,
      (projectRoot) => writeFile(join(projectRoot, 'source.bin'), Buffer.alloc(0)),
    );
    expect(
      await currentContext(
        withoutDescription.projectRoot,
        withoutDescription.created.run_id,
        'consume',
      ),
    ).toBe(nodeContextVector('normalized-absent-workflow-input-description').sha256);
  });

  it('should include every core Node Definition and Workflow Input factor in Node Context', async () => {
    const workflow = `schema_version: breakdown.workflow.v1
id: context-factors
name: Context Factors
inputs:
  source:
    description: Source material.
    default: default.txt
nodes:
  - id: execute
    name: Execute
    prompt: Use source.
    inputs:
      material:
        workflow_input: source
    data_contract:
      type: string
`;
    async function nodeContextHashFor({
      definition = workflow,
      inputId = 'source',
      path = 'selected.bin',
      bytes = 'content',
      now,
    }: {
      definition?: string;
      inputId?: string;
      path?: string;
      bytes?: string;
      now?: string;
    } = {}) {
      const { projectRoot, created } = await createRun(
        definition,
        (projectRoot) => writeFile(join(projectRoot, path), bytes),
        {
          inputs: { [inputId]: path },
          ...(now === undefined ? {} : { now }),
        },
      );
      const result = await inspect(projectRoot, created.run_id);
      if (!result.ok) throw new Error(`Could not inspect factor fixture: ${result.failure.code}`);
      const contextHash = result.value.nodes[0]?.context_sha256;
      if (contextHash === undefined) throw new Error('Factor fixture has no Node Context hash.');
      return contextHash;
    }

    expect(await nodeContextHashFor()).toBe(
      nodeContextVector('node-definition-workflow-input-baseline').sha256,
    );
    const variants: Array<{
      vectorId: string;
      observe: () => Promise<string>;
    }> = [
      {
        vectorId: 'included-run-id',
        observe: () => nodeContextHashFor({ now: '2026-07-24T20:00:01.000Z' }),
      },
      {
        vectorId: 'included-node-id',
        observe: () =>
          nodeContextHashFor({ definition: workflow.replace('- id: execute', '- id: changed') }),
      },
      {
        vectorId: 'included-node-name',
        observe: () =>
          nodeContextHashFor({ definition: workflow.replace('name: Execute', 'name: Changed') }),
      },
      {
        vectorId: 'included-node-prompt',
        observe: () =>
          nodeContextHashFor({
            definition: workflow.replace('prompt: Use source.', 'prompt: Changed.'),
          }),
      },
      {
        vectorId: 'included-input-bindings',
        observe: () =>
          nodeContextHashFor({ definition: workflow.replaceAll('material:', 'evidence:') }),
      },
      {
        vectorId: 'included-data-contract',
        observe: () =>
          nodeContextHashFor({ definition: workflow.replace('type: string', 'type: number') }),
      },
      {
        vectorId: 'included-workflow-input-id',
        observe: () =>
          nodeContextHashFor({
            definition: workflow
              .replace('  source:\n', '  source-two:\n')
              .replace('workflow_input: source', 'workflow_input: source-two'),
            inputId: 'source-two',
          }),
      },
      {
        vectorId: 'included-workflow-input-description',
        observe: () =>
          nodeContextHashFor({
            definition: workflow.replace('description: Source material.', 'description: Changed.'),
          }),
      },
      {
        vectorId: 'included-workflow-input-path',
        observe: () => nodeContextHashFor({ path: 'other.bin' }),
      },
      {
        vectorId: 'included-workflow-input-sha256',
        observe: () => nodeContextHashFor({ bytes: 'changed content' }),
      },
    ];
    for (const variant of variants) {
      expect(await variant.observe(), variant.vectorId).toBe(
        nodeContextVector(variant.vectorId).sha256,
      );
    }
  });

  it('should exclude inert definition and execution metadata from Node Context', async () => {
    const workflow = `schema_version: breakdown.workflow.v1
id: context-factors
name: Context Factors
inputs:
  source:
    description: Source material.
    default: default.txt
nodes:
  - id: execute
    name: Execute
    prompt: Use source.
    inputs:
      material:
        workflow_input: source
    data_contract:
      type: string
`;
    async function createFactorRun(definition: string) {
      return createRun(
        definition,
        (projectRoot) => writeFile(join(projectRoot, 'selected.bin'), 'content'),
        { inputs: { source: 'selected.bin' } },
      );
    }

    const baselineRun = await createFactorRun(workflow);
    const baseline = await currentContext(
      baselineRun.projectRoot,
      baselineRun.created.run_id,
      'execute',
    );
    const baselineVector = nodeContextVector('node-definition-workflow-input-baseline');
    expect(baseline).toBe(baselineVector.sha256);
    const variants = [
      workflow.replace(
        '    inputs:\n',
        `    extensions:
      com.example.metadata:
        ignored: true
    inputs:
`,
      ),
      workflow.replace(
        'nodes:\n',
        `nodes:
  - id: unrelated
    name: Unrelated
    prompt: Unrelated.
`,
      ),
      workflow.replace('default: default.txt', 'default: other.txt'),
      `# Raw comments and authored key order do not enter Node Context.
name: Context Factors
schema_version: breakdown.workflow.v1
id: context-factors
inputs:
  source:
    description: Source material.
    default: default.txt
nodes:
  - prompt: Use source.
    inputs:
      material:
        workflow_input: source
    name: Execute
    id: execute
    data_contract:
      type: string
`,
    ];
    for (const variant of variants) {
      const run = await createFactorRun(variant);
      expect(await currentContext(run.projectRoot, run.created.run_id, 'execute')).toBe(
        baselineVector.sha256,
      );
      expect(run.created.workflow.sha256).not.toBe(baselineRun.created.workflow.sha256);
    }

    const stepPath = await writeStep(baselineRun.projectRoot, baselineRun.created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'failed',
      contextSha256: baseline,
      settledAt: '2026-07-24T20:01:00.000Z',
      inputs: {
        material: {
          workflow_input: 'source',
        },
      },
      body: 'Candidate diagnostic content.',
    });
    const step = await readFile(join(baselineRun.projectRoot, stepPath), 'utf8');
    await writeFile(
      join(baselineRun.projectRoot, stepPath),
      step
        .replace('"name": "inspection-fixture"', '"name": "changed-executor",\n    "version": "2"')
        .replace('\n}\n---', ',\n  "extensions": {"com.example.audit":{"ignored":true}}\n}\n---'),
      'utf8',
    );

    expect(
      await currentContext(baselineRun.projectRoot, baselineRun.created.run_id, 'execute'),
    ).toBe(baseline);
  });

  it('should reject model identity in durable StepArtifact executor metadata', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: model-neutral-history
name: Model Neutral History
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    const stepPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'succeeded',
      contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'Result',
    });
    const step = await readFile(join(projectRoot, stepPath), 'utf8');
    await writeFile(
      join(projectRoot, stepPath),
      step.replace(
        '"name": "inspection-fixture"',
        '"name": "inspection-fixture",\n    "model": "durable-model"',
      ),
      'utf8',
    );

    expect(await inspect(projectRoot, created.run_id)).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_run',
        diagnostics: [
          expect.objectContaining({
            file: stepPath,
            path: '/executor/model',
          }),
        ],
      },
    });
  });

  it('should include exact predecessor Result identity, paths, and raw hashes in Node Context', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: predecessor-factors
name: Predecessor Factors
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
      evidence:
        node: gather
`);
    const gatherContext = await currentContext(projectRoot, created.run_id, 'gather');
    const firstPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'gather',
      attempt: 1,
      status: 'succeeded',
      contextSha256: gatherContext,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'Evidence',
    });
    const firstJsonPath = firstPath.replace(/\.md$/, '.json');
    await writeFile(join(projectRoot, firstJsonPath), '{"a":1,"b":2}', 'utf8');
    const baseline = await currentContext(projectRoot, created.run_id, 'consume');

    await writeFile(join(projectRoot, firstJsonPath), '{ "b": 2, "a": 1 }', 'utf8');
    const changedJsonHash = await currentContext(projectRoot, created.run_id, 'consume');
    expect(changedJsonHash).not.toBe(baseline);

    await writeFile(join(projectRoot, firstJsonPath), '{"a":1,"b":2}', 'utf8');
    const firstMarkdown = await readFile(join(projectRoot, firstPath), 'utf8');
    await writeFile(
      join(projectRoot, firstPath),
      firstMarkdown.replace('Evidence', 'Changed evidence'),
      'utf8',
    );
    const changedMarkdownHash = await currentContext(projectRoot, created.run_id, 'consume');
    expect(changedMarkdownHash).not.toBe(baseline);

    await writeFile(join(projectRoot, firstPath), firstMarkdown, 'utf8');
    const secondPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'gather',
      attempt: 2,
      status: 'succeeded',
      contextSha256: gatherContext,
      settledAt: '2026-07-24T20:02:00.000Z',
      body: 'Evidence',
    });
    await writeFile(join(projectRoot, secondPath.replace(/\.md$/, '.json')), '{"a":1,"b":2}');
    const changedIdentityAndPaths = await currentContext(projectRoot, created.run_id, 'consume');
    expect(changedIdentityAndPaths).not.toBe(baseline);
  });

  it('should match the independent RFC 8785 Unicode ordering vector without normalization', async () => {
    const vector = nodeContextVector('rfc-8785-unicode-ordering');
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: jcs-unicode-order
name: JCS Unicode Order
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
    data_contract:
      const:
        "\\u20ac": Euro Sign
        "\\r": Carriage Return
        "\\ufb33": Hebrew Letter Dalet With Dagesh
        "1": One
        "\\U0001F600": "Emoji: Grinning Face"
        "\\u0080": Control
        "\\u00f6": Latin Small Letter O With Diaeresis
        composed: "\\u00e9"
        decomposed: "e\\u0301"
`);

    const result = await inspect(projectRoot, created.run_id);

    expect(createHash('sha256').update(vector.canonical_jcs).digest('hex')).toBe(vector.sha256);
    expect(result).toMatchObject({
      ok: true,
      value: {
        nodes: [
          {
            node_id: 'execute',
            context_sha256: vector.sha256,
          },
        ],
      },
    });
  });

  it('should reject invalid Unicode before deriving a Node Context', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: jcs-unicode
name: JCS Unicode
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    await replaceWorkflowSnapshot(projectRoot, created, (snapshot) =>
      snapshot.replace('prompt: Execute.', 'prompt: "\\uD800"'),
    );

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        code: 'invalid_run',
        diagnostics: [
          {
            code: 'schema',
            file: `${created.path}/breakdown.yaml`,
            path: '/nodes/0/prompt',
          },
        ],
      },
    });
  });

  it('should reject invalid Unicode nested in a Data Contract before derivation', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: jcs-contract-unicode
name: JCS Contract Unicode
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
    data_contract:
      const: valid
`);
    await replaceWorkflowSnapshot(projectRoot, created, (snapshot) =>
      snapshot.replace('const: valid', 'const: "\\uDEAD"'),
    );

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: false,
      failure: {
        code: 'invalid_run',
        diagnostics: [
          {
            code: 'schema',
            file: `${created.path}/breakdown.yaml`,
            path: '/nodes/0/data_contract/const',
          },
        ],
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
      body: 'First evidence',
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

  it('should derive blocked nodes while independent branches remain runnable', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: independent-branches
name: Independent Branches
nodes:
  - id: failed-root
    name: Failed Root
    prompt: Fail once.
  - id: blocked-child
    name: Blocked Child
    prompt: Wait for the failed root.
    inputs:
      source:
        node: failed-root
  - id: independent-root
    name: Independent Root
    prompt: Remain runnable.
`);
    const failedContext = await currentContext(projectRoot, created.run_id, 'failed-root');
    await writeStep(projectRoot, created.run_id, {
      nodeId: 'failed-root',
      attempt: 1,
      status: 'failed',
      contextSha256: failedContext,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'Failed branch diagnostic.',
    });

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'incomplete',
        nodes: [
          {
            node_id: 'failed-root',
            state: 'runnable',
            stale: false,
            next_attempt: 2,
          },
          {
            node_id: 'independent-root',
            state: 'runnable',
            stale: false,
            next_attempt: 1,
          },
          {
            node_id: 'blocked-child',
            state: 'blocked',
            stale: false,
            next_attempt: 1,
          },
        ],
        terminal_results: [],
      },
    });
  });

  it('should report selected empty Markdown Terminal Results in deterministic order', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: terminal-results
name: Terminal Results
nodes:
  - id: zeta-terminal
    name: Zeta Terminal
    prompt: Return an empty Result.
  - id: alpha-terminal
    name: Alpha Terminal
    prompt: Return another empty Result.
`);
    const zetaContext = await currentContext(projectRoot, created.run_id, 'zeta-terminal');
    const alphaContext = await currentContext(projectRoot, created.run_id, 'alpha-terminal');
    const zetaPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'zeta-terminal',
      attempt: 1,
      status: 'succeeded',
      contextSha256: zetaContext,
      settledAt: '2026-07-24T20:02:00.000Z',
    });
    const alphaPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'alpha-terminal',
      attempt: 1,
      status: 'succeeded',
      contextSha256: alphaContext,
      settledAt: '2026-07-24T20:01:00.000Z',
    });

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        terminal_results: [
          {
            node_id: 'zeta-terminal',
            attempt: 1,
            markdown: {
              path: zetaPath,
              sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            },
          },
          {
            node_id: 'alpha-terminal',
            attempt: 1,
            markdown: {
              path: alphaPath,
              sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
            },
          },
        ],
      },
    });
    expect(await readFile(join(projectRoot, zetaPath), 'utf8')).toMatch(/---\n$/);
    expect(await readFile(join(projectRoot, alphaPath), 'utf8')).toMatch(/---\n$/);
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

  it('should preserve selected descendants after a failed predecessor refresh', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: failed-refresh
name: Failed Refresh
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
    const gatherContext = await currentContext(projectRoot, created.run_id, 'gather');
    const gatherPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'gather',
      attempt: 1,
      status: 'succeeded',
      contextSha256: gatherContext,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'Evidence',
    });
    const consumeContext = await currentContext(projectRoot, created.run_id, 'consume');
    await writeStep(projectRoot, created.run_id, {
      nodeId: 'consume',
      attempt: 1,
      status: 'succeeded',
      contextSha256: consumeContext,
      settledAt: '2026-07-24T20:02:00.000Z',
      inputs: {
        evidence: {
          result: {
            node_id: 'gather',
            attempt: 1,
            markdown: await resultFileDescriptor(projectRoot, gatherPath),
          },
        },
      },
      body: 'Consumed',
    });
    await writeStep(projectRoot, created.run_id, {
      nodeId: 'gather',
      attempt: 2,
      status: 'failed',
      contextSha256: gatherContext,
      settledAt: '2026-07-24T20:03:00.000Z',
      body: 'Refresh failed.',
    });

    const result = await inspect(projectRoot, created.run_id);

    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        nodes: [
          {
            node_id: 'gather',
            state: 'complete',
            selected_result: { attempt: 1 },
            next_attempt: 3,
          },
          {
            node_id: 'consume',
            state: 'complete',
            stale: false,
            selected_result: { attempt: 1 },
          },
        ],
        terminal_results: [{ node_id: 'consume', attempt: 1 }],
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

  it('should bound overlapping StepArtifact reads and preserve Run diagnostic order', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: ordered-diagnostics
name: Ordered Diagnostics
nodes:
  - id: execute
    name: Execute
    prompt: Execute.
`);
    const diagnosticFiles: string[] = [];
    for (let attempt = 18; attempt >= 1; attempt -= 1) {
      diagnosticFiles.push(
        await writeStep(projectRoot, created.run_id, {
          nodeId: 'execute',
          attempt,
          status: 'failed',
          contextSha256: '0'.repeat(64),
          settledAt: `2026-07-24T20:${String(attempt).padStart(2, '0')}:00.000Z`,
        }),
      );
    }
    const earlierFile = diagnosticFiles.at(-1);
    const laterFile = diagnosticFiles[0];

    stepArtifactReadProbe.begin();
    const result = await inspect(projectRoot, created.run_id);
    const readConcurrency = stepArtifactReadProbe.finish();
    if (result.ok) throw new Error('Expected invalid Run.');

    expect(readConcurrency.observed).toBe(18);
    expect(readConcurrency.maximum).toBeGreaterThan(1);
    expect(readConcurrency.maximum).toBeLessThanOrEqual(16);
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
    expect(earlierFile).toBeDefined();
    expect(laterFile).toBeDefined();
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

    await writeFile(join(projectRoot, 'brief.txt'), 'exact input');
    expect(await inspect(projectRoot, created.run_id)).toMatchObject({
      ok: true,
      value: {
        status: 'complete',
        resumable: true,
      },
    });
  });

  it('should resume an unchanged whole-project copy regardless of root, mtimes, or Git state', async () => {
    const { projectRoot, created } = await createRun(
      `schema_version: breakdown.workflow.v1
id: context-factors
name: Context Factors
inputs:
  source:
    description: Source material.
    default: default.txt
nodes:
  - id: execute
    name: Execute
    prompt: Use source.
    inputs:
      material:
        workflow_input: source
    data_contract:
      type: string
`,
      (projectRoot) => writeFile(join(projectRoot, 'selected.bin'), 'content'),
      { inputs: { source: 'selected.bin' } },
    );
    const contextSha256 = await currentContext(projectRoot, created.run_id, 'execute');
    expect(contextSha256).toBe(nodeContextVector('node-definition-workflow-input-baseline').sha256);
    const markdownPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'execute',
      attempt: 1,
      status: 'succeeded',
      contextSha256,
      settledAt: '2026-07-24T20:01:00.000Z',
      inputs: {
        material: {
          workflow_input: 'source',
        },
      },
      body: 'Portable Result',
    });
    await writeSidecar(projectRoot, markdownPath, 'portable');
    const original = await inspect(projectRoot, created.run_id);
    if (!original.ok) throw new Error('Expected the original Run to be valid.');

    const copyParent = await mkdtemp(join(tmpdir(), 'breakdown-project-copy-'));
    temporaryProjects.push(copyParent);
    const copiedRoot = join(copyParent, 'different-absolute-root');
    await cp(projectRoot, copiedRoot, { recursive: true });
    await mkdir(join(copiedRoot, '.git'));
    const changedTime = new Date('2030-01-01T00:00:00.000Z');
    await Promise.all(
      [
        'breakdown.yaml',
        'selected.bin',
        `${created.path}/run.md`,
        `${created.path}/breakdown.yaml`,
      ].map((path) => utimes(join(copiedRoot, path), changedTime, changedTime)),
    );

    const copied = await inspect(copiedRoot, created.run_id);

    expect(copied).toEqual(original);
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

  it('should fail integrity when a referenced committed Result is mutated', async () => {
    const { projectRoot, created } = await createRun(`schema_version: breakdown.workflow.v1
id: artifact-mutation
name: Artifact Mutation
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
    const gatherContext = await currentContext(projectRoot, created.run_id, 'gather');
    const gatherPath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'gather',
      attempt: 1,
      status: 'succeeded',
      contextSha256: gatherContext,
      settledAt: '2026-07-24T20:01:00.000Z',
      body: 'Original evidence',
    });
    const consumeContext = await currentContext(projectRoot, created.run_id, 'consume');
    const consumePath = await writeStep(projectRoot, created.run_id, {
      nodeId: 'consume',
      attempt: 1,
      status: 'succeeded',
      contextSha256: consumeContext,
      settledAt: '2026-07-24T20:02:00.000Z',
      inputs: {
        evidence: {
          result: {
            node_id: 'gather',
            attempt: 1,
            markdown: await resultFileDescriptor(projectRoot, gatherPath),
          },
        },
      },
      body: 'Consumed',
    });
    const original = await readFile(join(projectRoot, gatherPath), 'utf8');
    await writeFile(
      join(projectRoot, gatherPath),
      original.replace('Original evidence', 'Mutated evidence'),
      'utf8',
    );

    const result = await inspect(projectRoot, created.run_id);
    if (result.ok) throw new Error('Expected committed Result mutation to invalidate the Run.');

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'integrity',
          file: consumePath,
          path: '/inputs/evidence/result/markdown',
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

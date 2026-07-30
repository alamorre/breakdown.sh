import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = join(import.meta.dirname, '..', '..');
const contractsRoot = join(repositoryRoot, 'local', 'contracts');
const releaseVersion = '1.0.0';
const expectedGroups = [
  'WFV',
  'RUN',
  'HASH',
  'STATE',
  'SEC',
  'PUB',
  'OPS',
  'CLI',
  'MCP',
  'SKILL',
  'HOST',
  'PKG',
  'DOC',
] as const;
const expectedRowCounts = {
  WFV: 17,
  RUN: 18,
  HASH: 6,
  STATE: 10,
  SEC: 14,
  PUB: 10,
  OPS: 18,
  CLI: 12,
  MCP: 12,
  SKILL: 13,
  HOST: 8,
  PKG: 16,
  DOC: 13,
} as const;
const expectedRequirementCounts = {
  'specifications/cli.md': 12,
  'specifications/conformance.md': 13,
  'specifications/hashing-and-state.md': 16,
  'specifications/mcp.md': 12,
  'specifications/operations.md': 18,
  'specifications/release.md': 16,
  'specifications/run-records.md': 18,
  'specifications/security-and-publication.md': 24,
  'specifications/skills-and-hosts.md': 21,
  'specifications/workflow-definition.md': 17,
} as const;
const expectedFixtureFileCounts = {
  'workflow-validation': 39,
  'run-records': 1,
  hashing: 1,
  state: 1,
  security: 1,
  boundaries: 1,
  publication: 2,
  operations: 1,
  cli: 1,
  mcp: 1,
  package: 1,
  skills: 1,
  hosts: 2,
} as const;

interface MatrixIndex {
  schema_version: string;
  release_version: string;
  matrices: Array<{ group: string; path: string }>;
}

interface TraceabilityRow {
  id: string;
  requirements: string[];
  setup?: string;
  action?: string;
  oracle?: string;
  oracle_type?: string;
  applicability?: Record<string, string>;
  gate?: string;
  retained_evidence?: string;
  fixture?: string;
}

interface TraceabilityMatrix {
  schema_version: string;
  release_version: string;
  group: string;
  defaults: Omit<TraceabilityRow, 'id' | 'requirements'>;
  rows: TraceabilityRow[];
}

interface JsonPatchOperation {
  op: 'add' | 'replace' | 'move';
  path: string;
  from?: string;
  value?: unknown;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return nested.flat().sort();
}

function visitJson(value: unknown, visitor: (key: string, item: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visitJson(item, visitor);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    visitor(key, item);
    visitJson(item, visitor);
  }
}

function collectReferences(value: unknown): string[] {
  const references: string[] = [];
  visitJson(value, (key, item) => {
    if (key === '$ref' && typeof item === 'string') references.push(item);
  });
  return references;
}

function collectStableRowIds(value: unknown): string[] {
  const ids: string[] = [];
  visitJson(value, (key, item) => {
    if (
      key === 'id' &&
      typeof item === 'string' &&
      new RegExp(`^(?:${expectedGroups.join('|')})-\\d{3}$`).test(item)
    ) {
      ids.push(item);
    }
  });
  return ids;
}

function jsonPointerSegments(pointer: string): string[] {
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON Pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
}

function jsonPointerParent(document: unknown, pointer: string): [Record<string, unknown>, string] {
  const segments = jsonPointerSegments(pointer);
  const key = segments.pop();
  if (key === undefined) throw new Error(`JSON Pointer has no target: ${pointer}`);
  let parent = document;
  for (const segment of segments) {
    if (parent === null || typeof parent !== 'object') {
      throw new Error(`JSON Pointer does not resolve: ${pointer}`);
    }
    parent = (parent as Record<string, unknown>)[segment];
  }
  if (parent === null || typeof parent !== 'object') {
    throw new Error(`JSON Pointer parent is not an object: ${pointer}`);
  }
  return [parent as Record<string, unknown>, key];
}

function applyJsonPatch(
  source: unknown,
  patch: JsonPatchOperation | JsonPatchOperation[],
): unknown {
  const document = structuredClone(source);
  for (const operation of Array.isArray(patch) ? patch : [patch]) {
    const [parent, key] = jsonPointerParent(document, operation.path);
    if (operation.op === 'replace') {
      if (!Object.hasOwn(parent, key))
        throw new Error(`Replace target is absent: ${operation.path}`);
      parent[key] = structuredClone(operation.value);
    } else if (operation.op === 'add') {
      if (Array.isArray(parent) && key === '-') parent.push(structuredClone(operation.value));
      else parent[key] = structuredClone(operation.value);
    } else {
      if (operation.from === undefined) throw new Error(`Move source is absent: ${operation.path}`);
      const [sourceParent, sourceKey] = jsonPointerParent(document, operation.from);
      if (!Object.hasOwn(sourceParent, sourceKey)) {
        throw new Error(`Move source does not resolve: ${operation.from}`);
      }
      parent[key] = sourceParent[sourceKey];
      delete sourceParent[sourceKey];
    }
  }
  return document;
}

function projectNodeContext(source: unknown) {
  const value = source as {
    run_id: string;
    node_definition: {
      id: string;
      name: string;
      prompt: string;
      inputs: unknown;
      data_contract: unknown;
    };
    resolved_inputs: {
      material: {
        workflow_input: {
          id: string;
          description: string;
          path: string;
          sha256: string;
        };
      };
    };
  };
  const workflowInput = value.resolved_inputs.material.workflow_input;
  return {
    hash_schema: 'breakdown.node-context.v1',
    node_definition: {
      data_contract: value.node_definition.data_contract,
      id: value.node_definition.id,
      inputs: value.node_definition.inputs,
      name: value.node_definition.name,
      prompt: value.node_definition.prompt,
    },
    resolved_inputs: {
      material: {
        workflow_input: {
          description: workflowInput.description,
          id: workflowInput.id,
          path: workflowInput.path,
          sha256: workflowInput.sha256,
        },
      },
    },
    run_id: value.run_id,
  };
}

describe('verifyContractCorpus', () => {
  it('should publish the exact versioned traceability groups with complete effective rows', async () => {
    await expect(readFile(join(contractsRoot, 'VERSION'), 'utf8')).resolves.toBe(
      `${releaseVersion}\n`,
    );

    const index = await readJson<MatrixIndex>(join(contractsRoot, 'conformance', 'matrix.json'));
    expect(index).toMatchObject({
      schema_version: 'breakdown.conformance-index.v1',
      release_version: releaseVersion,
    });
    expect(index.matrices.map(({ group }) => group)).toEqual(expectedGroups);

    const rowIds = new Set<string>();
    const tracedRequirements = new Set<string>();
    const incompleteRows: string[] = [];
    const emptyFixtures: string[] = [];
    for (const entry of index.matrices) {
      const matrix = await readJson<TraceabilityMatrix>(
        join(contractsRoot, 'conformance', entry.path),
      );
      expect(matrix.schema_version, entry.group).toBe('breakdown.traceability-matrix.v1');
      expect(matrix.release_version, entry.group).toBe(releaseVersion);
      expect(matrix.group, entry.group).toBe(entry.group);
      expect(matrix.rows.length, entry.group).toBe(
        expectedRowCounts[entry.group as keyof typeof expectedRowCounts],
      );

      for (const row of matrix.rows) {
        expect(row.id, entry.group).toMatch(new RegExp(`^${entry.group}-\\d{3}$`));
        expect(rowIds.has(row.id), row.id).toBe(false);
        rowIds.add(row.id);
        if (row.requirements.length === 0) incompleteRows.push(`${row.id}:requirements`);
        row.requirements.forEach((requirement) => tracedRequirements.add(requirement));

        const effective = { ...matrix.defaults, ...row };
        for (const field of ['setup', 'action', 'oracle', 'gate', 'retained_evidence'] as const) {
          if (typeof effective[field] !== 'string' || effective[field].length === 0) {
            incompleteRows.push(`${row.id}:${field}`);
          }
        }
        if (!['byte', 'structural', 'effect', 'human'].includes(effective.oracle_type ?? '')) {
          incompleteRows.push(`${row.id}:oracle_type`);
        }
        const applicability = effective.applicability ?? {};
        expect(Object.keys(applicability).sort(), row.id).toEqual([
          'architecture',
          'filesystem',
          'host',
          'os',
          'protocol',
          'transport',
        ]);
        for (const [field, value] of Object.entries(applicability)) {
          if (typeof value !== 'string' || value.length === 0) {
            incompleteRows.push(`${row.id}:applicability.${field}`);
          }
        }

        if (row.fixture !== undefined) {
          if ((await readFile(join(contractsRoot, row.fixture))).byteLength === 0) {
            emptyFixtures.push(row.fixture);
          }
        }
      }
    }
    expect(incompleteRows).toEqual([]);
    expect(emptyFixtures).toEqual([]);

    const specificationFiles = (await filesBelow(join(contractsRoot, 'specifications'))).filter(
      (path) => extname(path) === '.md',
    );
    expect(specificationFiles.map((path) => relative(contractsRoot, path))).toEqual([
      'specifications/cli.md',
      'specifications/conformance.md',
      'specifications/hashing-and-state.md',
      'specifications/mcp.md',
      'specifications/operations.md',
      'specifications/release.md',
      'specifications/run-records.md',
      'specifications/security-and-publication.md',
      'specifications/skills-and-hosts.md',
      'specifications/workflow-definition.md',
    ]);

    const authoredRequirements = new Set<string>();
    for (const path of specificationFiles) {
      const specification = await readFile(path, 'utf8');
      expect(specification, path).toContain('Document kind: Authored normative contract');
      expect(specification, path).toContain(`Contract version: ${releaseVersion}`);
      const requirementIds = [...specification.matchAll(/^### (REQ-[A-Z]+-\d{3})$/gm)].map(
        ([, id]) => id,
      );
      expect(requirementIds.length, path).toBe(
        expectedRequirementCounts[
          relative(contractsRoot, path) as keyof typeof expectedRequirementCounts
        ],
      );
      for (const requirementId of requirementIds) {
        expect(authoredRequirements.has(requirementId), requirementId).toBe(false);
        authoredRequirements.add(requirementId);
      }
    }

    expect([...tracedRequirements].sort()).toEqual([...authoredRequirements].sort());

    const stableRowIds: string[] = [];
    for (const path of await filesBelow(join(contractsRoot, 'conformance'))) {
      if (extname(path) !== '.json') continue;
      stableRowIds.push(...collectStableRowIds(await readJson<unknown>(path)));
    }
    expect(stableRowIds).toHaveLength(Object.values(expectedRowCounts).reduce((a, b) => a + b, 0));
    expect(new Set(stableRowIds).size).toBe(stableRowIds.length);
  });

  it('should keep public shapes and enumerated CLI/MCP facts in offline machine authorities', async () => {
    const schemaPaths = (await filesBelow(join(contractsRoot, 'schemas'))).filter(
      (path) => extname(path) === '.json',
    );
    const schemaIds = new Set<string>();
    const schemaDocuments = new Map<string, unknown>();
    for (const path of schemaPaths) {
      const schema = await readJson<Record<string, unknown>>(path);
      expect(schema.$schema, path).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(schema.$comment, path).toContain(`release_version=${releaseVersion}`);
      schemaIds.add(schema.$id as string);
      schemaDocuments.set(path, schema);
    }
    expect([...schemaIds].sort()).toEqual([
      'breakdown.candidate.v1',
      'breakdown.cli-output.v1',
      'breakdown.mcp-output.v1',
      'breakdown.operation-request.v1',
      'breakdown.operation-value.v1',
      'breakdown.run.v1',
      'breakdown.step-artifact.v1',
      'breakdown.traceability-matrix.v1',
      'breakdown.work-packet-batch.v1',
      'breakdown.work-packet.v1',
      'breakdown.workflow.v1',
    ]);

    for (const [path, schema] of schemaDocuments) {
      for (const reference of collectReferences(schema)) {
        if (reference.startsWith('#')) continue;
        expect(
          reference,
          `${relative(contractsRoot, path)} must not require a network`,
        ).not.toMatch(/^(?:https?:|file:|git:)/);
        expect(
          schemaIds.has(reference.split('#', 1)[0]),
          `${relative(contractsRoot, path)} -> ${reference}`,
        ).toBe(true);
      }
    }

    const catalogPaths = (await filesBelow(join(contractsRoot, 'catalogs'))).filter(
      (path) => extname(path) === '.json',
    );
    for (const path of catalogPaths) {
      const catalog = await readJson<Record<string, unknown>>(path);
      expect(catalog.release_version, path).toBe(releaseVersion);
    }

    const operationOrder = [
      'validate_workflow',
      'create_run',
      'inspect_run',
      'prepare_work',
      'read_work_input',
      'submit_candidate',
    ];
    const operations = await readJson<{
      operations: string[];
      failure_codes: Record<string, string[]>;
    }>(join(contractsRoot, 'catalogs', 'operations.v1.json'));
    const cli = await readJson<{
      operations: string[];
      failure_codes: Record<string, string[]>;
    }>(join(contractsRoot, 'catalogs', 'cli.v1.json'));
    const mcp = await readJson<{
      operations: Array<{ name: string }>;
      protocol_versions: string[];
      server: { name: string; title: string; version: string };
      forbidden_capabilities: string[];
    }>(join(contractsRoot, 'catalogs', 'mcp.v1.json'));
    expect(operations.operations).toEqual(operationOrder);
    expect(cli.operations).toEqual(operations.operations);
    expect(cli.failure_codes).toEqual(operations.failure_codes);
    expect(mcp.operations.map(({ name }) => name)).toEqual(operationOrder);
    expect(mcp.protocol_versions).toEqual(['2025-06-18', '2025-11-25']);
    expect(mcp.server).toEqual({
      name: '@breakdown-sh/mcp',
      title: 'Breakdown Local',
      version: releaseVersion,
    });
    expect(mcp.forbidden_capabilities).toEqual([
      'resources',
      'prompts',
      'tasks',
      'progress',
      'logging',
      'sampling',
      'elicitation',
      'completion',
      'roots',
      'dynamic_tools',
      'http',
      'daemon',
      'auth',
      'hosted_fallback',
    ]);
  });

  it('should publish literal examples and every settled conformance-fixture role', async () => {
    const examples = await filesBelow(join(contractsRoot, 'examples'));
    expect(examples.map((path) => relative(contractsRoot, path))).toEqual(
      expect.arrayContaining([
        'examples/contracted-workflow.yaml',
        'examples/fan-out-fan-in.yaml',
        'examples/minimal-workflow.yaml',
      ]),
    );

    for (const [role, expectedCount] of Object.entries(expectedFixtureFileCounts)) {
      const fixtures = await filesBelow(join(contractsRoot, 'conformance', role, 'fixtures'));
      expect(fixtures.length, role).toBe(expectedCount);
    }

    const vectors = await readJson<{
      raw_files: Array<{ id: string; bytes_base64: string; sha256: string }>;
      node_contexts: Array<{ id: string; canonical_jcs: string; sha256: string }>;
      raw_semantic_pairs: Array<{ id: string; left: string; right: string }>;
      jcs_rejections: Array<{
        id: string;
        input_json_utf8: string;
        oracle: { code: string; path: string };
      }>;
      included_context_factors: Array<{
        factor: string;
        baseline_vector: string;
        mutated_vector: string;
        mutation: unknown;
      }>;
      excluded_context_factors: Array<{
        factor: string;
        source_fixture: string;
        projection: string;
        baseline_vector: string;
        expected_vector: string;
        mutation: JsonPatchOperation;
      }>;
      context_source_baseline: unknown;
      node_context_projection: { literal_vector: string };
    }>(join(contractsRoot, 'conformance', 'hashing', 'fixtures', 'hash-vectors.json'));
    expect(vectors.raw_files.find(({ id }) => id === 'empty')).toEqual({
      id: 'empty',
      bytes_base64: '',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
    for (const vector of vectors.raw_files) {
      expect(
        createHash('sha256').update(Buffer.from(vector.bytes_base64, 'base64')).digest('hex'),
        vector.id,
      ).toBe(vector.sha256);
    }
    for (const vector of vectors.node_contexts) {
      expect(createHash('sha256').update(vector.canonical_jcs, 'utf8').digest('hex')).toBe(
        vector.sha256,
      );
    }
    const rawFiles = new Map(vectors.raw_files.map((vector) => [vector.id, vector]));
    expect(vectors.raw_semantic_pairs.map(({ id }) => id)).toEqual([
      'workflow-comments-order',
      'json-whitespace-property-order',
    ]);
    for (const pair of vectors.raw_semantic_pairs) {
      expect(rawFiles.get(pair.left)?.sha256, pair.id).not.toBe(rawFiles.get(pair.right)?.sha256);
    }
    expect(vectors.jcs_rejections).toEqual([
      {
        id: 'rfc-8785-lone-high-surrogate',
        input_json_utf8: '{"value":"\\ud800"}',
        oracle: { code: 'invalid_unicode', path: '/value' },
      },
      {
        id: 'rfc-8785-lone-low-surrogate',
        input_json_utf8: '{"value":"\\udead"}',
        oracle: { code: 'invalid_unicode', path: '/value' },
      },
    ]);
    const contextHashes = new Map(
      vectors.node_contexts.map((vector) => [vector.id, vector.sha256]),
    );
    const missingMutations: string[] = [];
    for (const factor of vectors.included_context_factors) {
      if (factor.mutation === undefined) missingMutations.push(factor.factor);
      expect(factor.mutated_vector, factor.factor).not.toBe(factor.baseline_vector);
      expect(contextHashes.get(factor.mutated_vector), factor.factor).not.toBe(
        contextHashes.get(factor.baseline_vector),
      );
    }
    for (const factor of vectors.excluded_context_factors) {
      if (factor.mutation === undefined) missingMutations.push(factor.factor);
      expect(factor.source_fixture, factor.factor).toBe('context_source_baseline');
      expect(factor.projection, factor.factor).toBe('node_context_projection');
      expect(factor.expected_vector, factor.factor).toBe(factor.baseline_vector);
    }
    expect(missingMutations).toEqual([]);
    const projectedBaseline = projectNodeContext(vectors.context_source_baseline);
    const baselineVector = vectors.node_contexts.find(
      ({ id }) => id === vectors.node_context_projection.literal_vector,
    );
    if (baselineVector === undefined) throw new Error('The projection literal vector is absent.');
    expect(projectedBaseline).toEqual(JSON.parse(baselineVector.canonical_jcs));
    for (const factor of vectors.excluded_context_factors) {
      expect(
        projectNodeContext(applyJsonPatch(vectors.context_source_baseline, factor.mutation)),
        factor.factor,
      ).toEqual(projectedBaseline);
    }

    const records = await readJson<{
      byte_oracles: {
        workflow_snapshot: { bytes_base64: string; sha256: string };
        node_context: { canonical_jcs: string; sha256: string };
        run_manifest_utf8: string;
        succeeded_step_utf8: string;
        failed_step_utf8: string;
        blocked_step_utf8: string;
        cancelled_step_utf8: string;
        compact_contracted_json_utf8: string;
        compact_contracted_json_sha256: string;
      };
    }>(join(contractsRoot, 'conformance', 'run-records', 'fixtures', 'records.json'));
    expect(
      createHash('sha256')
        .update(Buffer.from(records.byte_oracles.workflow_snapshot.bytes_base64, 'base64'))
        .digest('hex'),
    ).toBe(records.byte_oracles.workflow_snapshot.sha256);
    expect(
      createHash('sha256').update(records.byte_oracles.node_context.canonical_jcs).digest('hex'),
    ).toBe(records.byte_oracles.node_context.sha256);
    expect(
      createHash('sha256').update(records.byte_oracles.compact_contracted_json_utf8).digest('hex'),
    ).toBe(records.byte_oracles.compact_contracted_json_sha256);
    expect(records.byte_oracles.run_manifest_utf8).toMatch(
      /^---\nschema_version: breakdown\.run\.v1\n/,
    );
    for (const status of ['succeeded', 'failed', 'blocked', 'cancelled'] as const) {
      expect(records.byte_oracles[`${status}_step_utf8`]).toContain(`\nstatus: ${status}\n`);
    }

    const limits = await readJson<{ limits: Record<string, number> }>(
      join(contractsRoot, 'catalogs', 'limits.v1.json'),
    );
    const boundaryCases = await readJson<{
      limits: Array<{ name: string; value: number; cases: number[] }>;
    }>(join(contractsRoot, 'conformance', 'boundaries', 'fixtures', 'limit-cases.json'));
    expect(
      Object.fromEntries(boundaryCases.limits.map(({ name, value }) => [name, value])),
    ).toEqual(limits.limits);
    for (const boundary of boundaryCases.limits) {
      expect(boundary.cases).toEqual([boundary.value - 1, boundary.value, boundary.value + 1]);
    }

    const operationTraces = await readJson<{
      traces: Array<{
        id: string;
        steps?: Array<{ request: Record<string, unknown> }>;
        action?: { request?: Record<string, unknown> };
        oracle?: unknown;
        final_oracle?: unknown;
        effects?: unknown;
      }>;
      sequence_runs: Array<{ id: string; trace_ids: string[] }>;
    }>(join(contractsRoot, 'conformance', 'operations', 'fixtures', 'shared-traces.json'));
    const expectedTraceIds = [
      'no-input-success',
      'workflow-input-success',
      'predecessor-markdown-success',
      'contracted-json-success',
      'failed-candidate',
      'blocked-candidate',
      'cancelled-candidate',
      'refresh-success',
      'stale-context-conflict',
      'run-lock-conflict',
      'invalid-workflow',
      'invalid-run',
      'resource-limit',
    ];
    expect(operationTraces.traces.map(({ id }) => id)).toEqual(expectedTraceIds);
    expect(operationTraces.sequence_runs).toEqual([
      {
        id: 'core-only',
        trace_ids: expectedTraceIds,
        adapters: ['core', 'core'],
        oracle: {
          decoded_values_equal: true,
          failures_equal: true,
          ordering_equal: true,
          limits_equal: true,
          disk_effects_equal: true,
        },
      },
      {
        id: 'cli-only',
        trace_ids: expectedTraceIds,
        adapters: ['cli', 'cli'],
        oracle: {
          decoded_values_equal: true,
          failures_equal: true,
          ordering_equal: true,
          limits_equal: true,
          disk_effects_equal: true,
        },
      },
      {
        id: 'mcp-only',
        trace_ids: expectedTraceIds,
        adapters: ['mcp', 'mcp'],
        oracle: {
          decoded_values_equal: true,
          failures_equal: true,
          ordering_equal: true,
          limits_equal: true,
          disk_effects_equal: true,
        },
      },
      {
        id: 'cli-to-mcp',
        trace_ids: expectedTraceIds,
        adapters: ['cli', 'mcp'],
        oracle: {
          decoded_values_equal: true,
          failures_equal: true,
          ordering_equal: true,
          limits_equal: true,
          disk_effects_equal: true,
        },
      },
      {
        id: 'mcp-to-cli',
        trace_ids: expectedTraceIds,
        adapters: ['mcp', 'cli'],
        oracle: {
          decoded_values_equal: true,
          failures_equal: true,
          ordering_equal: true,
          limits_equal: true,
          disk_effects_equal: true,
        },
      },
    ]);
    const incompleteOperationTraces: string[] = [];
    const operationRequests: Array<{ trace: string; request: Record<string, unknown> }> = [];
    for (const trace of operationTraces.traces) {
      if (trace.steps !== undefined) {
        if (trace.steps.length === 0) incompleteOperationTraces.push(`${trace.id}:steps`);
        operationRequests.push(...trace.steps.map(({ request }) => ({ trace: trace.id, request })));
      } else {
        if (trace.action === undefined) incompleteOperationTraces.push(`${trace.id}:action`);
        if (trace.oracle === undefined) incompleteOperationTraces.push(`${trace.id}:oracle`);
        if (trace.action?.request === undefined) {
          incompleteOperationTraces.push(`${trace.id}:request`);
        } else {
          operationRequests.push({ trace: trace.id, request: trace.action.request });
        }
      }
    }
    expect(incompleteOperationTraces).toEqual([]);
    const requiredRequestFields = {
      validate_workflow: ['operation', 'schema_version'],
      create_run: ['operation', 'schema_version'],
      inspect_run: ['operation', 'run_id', 'schema_version'],
      prepare_work: ['mode', 'operation', 'run_id', 'schema_version'],
      read_work_input: ['binding', 'operation', 'packet', 'schema_version'],
      submit_candidate: ['candidate', 'operation', 'packet', 'schema_version'],
    } as const;
    for (const { trace, request } of operationRequests) {
      expect(request.schema_version, trace).toBe('breakdown.operation-request.v1');
      expect(Object.keys(request).sort(), trace).toEqual(
        requiredRequestFields[request.operation as keyof typeof requiredRequestFields],
      );
      if (request.operation === 'submit_candidate') {
        const candidate = request.candidate as Record<string, unknown>;
        expect(candidate.schema_version, trace).toBe('breakdown.candidate.v1');
        expect(candidate.executor, trace).toEqual({ kind: 'program', name: 'shared-trace' });
        expect(candidate.submission, trace).toMatch(
          /^\$(?:PACKET|REFRESH_PACKET|STALE_PACKET)\.submission$/,
        );
      }
    }

    const cliCases = await readJson<{
      byte_oracles: Array<{ id: string; stdout_utf8: string; stderr_utf8: string }>;
      human_commands: Array<{ id: string }>;
      automation_operations: Array<{ id: string }>;
      boundary_cases: Array<{ id: string }>;
      byte_field_cases: Array<{ id: string }>;
      process_cases: Array<{ id: string }>;
      ambient_cases: Array<{ id: string }>;
    }>(join(contractsRoot, 'conformance', 'cli', 'fixtures', 'process-cases.json'));
    expect(cliCases.byte_oracles.map(({ id }) => id)).toEqual([
      'help',
      'version',
      'machine-invalid-json',
      'human-missing-project',
    ]);
    expect(cliCases.human_commands.map(({ id }) => id)).toEqual([
      'workflow-validate',
      'run-create',
      'run-inspect-exact',
      'help',
      'version',
    ]);
    expect(cliCases.automation_operations.map(({ id }) => id)).toEqual([
      'validate_workflow',
      'create_run',
      'inspect_run',
      'prepare_work',
      'read_work_input',
      'submit_candidate',
    ]);
    expect(cliCases.boundary_cases.map(({ id }) => id)).toEqual([
      'request-utf8',
      'request-bytes',
      'response-bytes',
      'human-stderr-bytes',
    ]);
    expect(cliCases.byte_field_cases.map(({ id }) => id)).toEqual([
      'workflow-input-base64',
      'result-markdown-base64',
      'result-json-base64',
    ]);
    expect(cliCases.process_cases.map(({ id }) => id)).toEqual([
      'exit-codes',
      'sigint',
      'sigterm',
      'tty-color',
      'no-color',
      'terminal-controls',
    ]);
    expect(cliCases.ambient_cases.map(({ id }) => id)).toEqual([
      'no-git',
      'no-cwd-discovery',
      'no-environment-discovery',
      'no-latest-run',
    ]);

    const mcpCases = await readJson<{
      byte_oracles: Array<{ id: string; stdout_utf8: string; stdout_sha256?: string }>;
      clients: Array<{ id: string }>;
      discovery: Array<{ id: string }>;
      root_cases: Array<{ id: string }>;
      error_cases: Array<{ id: string }>;
      lifecycle_cases: Array<{ id: string }>;
      stream_cases: Array<{ id: string }>;
    }>(join(contractsRoot, 'conformance', 'mcp', 'fixtures', 'protocol-cases.json'));
    expect(mcpCases.byte_oracles.map(({ id }) => id)).toEqual([
      'initialize-2025-06-18',
      'initialize-2025-11-25',
      'json-rpc-parse',
      'json-rpc-request',
      'json-rpc-method',
    ]);
    const unterminatedMcpFrames: string[] = [];
    for (const oracle of mcpCases.byte_oracles) {
      if (!oracle.stdout_utf8.endsWith('\n')) unterminatedMcpFrames.push(oracle.id);
      if (oracle.stdout_sha256 !== undefined) {
        expect(createHash('sha256').update(oracle.stdout_utf8).digest('hex'), oracle.id).toBe(
          oracle.stdout_sha256,
        );
      }
    }
    expect(unterminatedMcpFrames).toEqual([]);
    expect(mcpCases.clients.map(({ id }) => id)).toEqual([
      'mcp-inspector',
      'sdk-client',
      'independent-json-rpc-client',
    ]);
    expect(mcpCases.discovery.map(({ id }) => id)).toEqual([
      'server-identity',
      'tool-order',
      'annotations',
      'strict-input-schemas',
      'forbidden-capabilities',
    ]);
    expect(mcpCases.root_cases.map(({ id }) => id)).toEqual([
      'absolute-native',
      'missing',
      'relative',
      'uri',
      'cwd',
      'environment',
      'workspace',
      'repository',
      'mcp-roots',
    ]);
    expect(mcpCases.error_cases.map(({ id }) => id)).toEqual([
      'json-rpc-parse',
      'json-rpc-request',
      'json-rpc-method',
      'json-rpc-params',
      'core-expected-failure',
    ]);
    expect(mcpCases.lifecycle_cases.map(({ id }) => id)).toEqual([
      'cancellation',
      'connection-close',
      'eof',
      'sigint',
      'sigterm',
      'no-daemon',
    ]);
    expect(mcpCases.stream_cases.map(({ id }) => id)).toEqual([
      'one-json-rpc-message-per-line',
      'bounded-sanitized-stderr',
      'structured-text-envelope-identity',
    ]);

    const stateCases = await readJson<{
      scenarios: Array<{ id: string; setup: unknown; oracle: unknown }>;
    }>(join(contractsRoot, 'conformance', 'state', 'fixtures', 'scenarios.json'));
    expect(stateCases.scenarios).toHaveLength(18);
    const incompleteStateCases: string[] = [];
    for (const scenario of stateCases.scenarios) {
      if (scenario.setup === undefined) incompleteStateCases.push(`${scenario.id}:setup`);
      if (scenario.oracle === undefined) incompleteStateCases.push(`${scenario.id}:oracle`);
    }
    expect(incompleteStateCases).toEqual([]);

    const securityCases = await readJson<{
      path_cases: Array<{ id: string; value: string; oracle: unknown }>;
      filesystem_cases: Array<{ id: string; setup: unknown; oracle: unknown }>;
      ambient_cases: Array<{ id: string; setup: unknown; oracle: unknown }>;
    }>(join(contractsRoot, 'conformance', 'security', 'fixtures', 'attacks.json'));
    expect(securityCases.path_cases).toHaveLength(13);
    expect(securityCases.filesystem_cases).toHaveLength(17);
    expect(securityCases.ambient_cases).toHaveLength(10);

    const recordCases = await readJson<{
      run_manifest_forms: Array<{ id: string; setup: unknown; oracle: unknown }>;
      step_artifact_forms: Array<{ id: string; setup: unknown; oracle: unknown }>;
      corruptions: Array<{ id: string; setup: unknown; oracle: unknown }>;
      ignored_entries: Array<{ id: string; setup: unknown; oracle: unknown }>;
    }>(join(contractsRoot, 'conformance', 'run-records', 'fixtures', 'records.json'));
    expect(recordCases.run_manifest_forms).toHaveLength(6);
    expect(recordCases.step_artifact_forms).toHaveLength(19);
    expect(recordCases.corruptions).toHaveLength(19);
    expect(recordCases.ignored_entries).toHaveLength(4);
  });
});

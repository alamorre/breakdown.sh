import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DATA_CONTRACT_KEYWORD_KINDS, DATA_CONTRACT_TYPES } from './data-contract-dialect.js';
import { isRawJsonNumber } from './exact-json-number.js';
import { FIXED_LIMITS } from './fixed-limits.js';
import { operate } from './index.js';

const temporaryProjects: string[] = [];
const conformanceRoot = new URL(
  '../../../local/contracts/conformance/workflow-validation/',
  import.meta.url,
);

interface ConformanceRow {
  id: string;
  requirement: string;
  fixture?: string;
  encoding?: 'base64';
  generated_cases?: Array<{
    id: string;
    generator:
      | 'workflow_definition_bytes'
      | 'nodes_per_workflow'
      | 'workflow_inputs_per_workflow'
      | 'input_bindings_per_node'
      | 'node_prompt_bytes'
      | 'yaml_json_nesting_depth'
      | 'data_contract_schema_nodes'
      | 'project_relative_path_bytes'
      | 'diagnostics_returned';
    value: number;
    oracle: {
      ok: boolean;
      failure_kind?: string;
      failure_code?: string;
      diagnostic_count?: number;
    };
  }>;
  oracle?:
    | {
        ok: true;
        value?: unknown;
        effect?: {
          absent_path: string;
        };
      }
    | {
        ok: false;
        failure_kind: string;
        failure_code: string;
        diagnostics: Array<{ code: string; path: string }>;
      };
}

const conformanceMatrix = JSON.parse(
  await readFile(new URL('matrix.json', conformanceRoot), 'utf8'),
) as { rows: ConformanceRow[] };

const limitCatalog = JSON.parse(
  await readFile(
    new URL('../../../local/contracts/catalogs/limits.v1.json', import.meta.url),
    'utf8',
  ),
) as {
  schema_version: string;
  limits: Record<string, number>;
};

const workflowMachineSchema = JSON.parse(
  await readFile(
    new URL('../../../local/contracts/schemas/breakdown.workflow.v1.schema.json', import.meta.url),
    'utf8',
  ),
) as {
  $defs: {
    'data-contract-type': { enum: string[] };
    'data-contract-schema': { properties: Record<string, unknown> };
  };
};

type DataContractKeywordKind =
  (typeof DATA_CONTRACT_KEYWORD_KINDS)[keyof typeof DATA_CONTRACT_KEYWORD_KINDS];

const EXPECTED_DATA_CONTRACT_KEYWORD_SCHEMAS: Record<DataContractKeywordKind, unknown> = {
  type: {
    oneOf: [
      { $ref: '#/$defs/data-contract-type' },
      {
        type: 'array',
        minItems: 1,
        uniqueItems: true,
        items: { $ref: '#/$defs/data-contract-type' },
      },
    ],
  },
  enum: { type: 'array' },
  any: {},
  string: { type: 'string' },
  schemas: {
    type: 'object',
    additionalProperties: { $ref: '#/$defs/data-contract-schema-node' },
  },
  'string-array': {
    type: 'array',
    uniqueItems: true,
    items: { type: 'string' },
  },
  schema: { $ref: '#/$defs/data-contract-schema-node' },
  'non-negative-integer': { type: 'integer', minimum: 0 },
  number: { type: 'number' },
};

async function createProject(workflow: string | Uint8Array) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-core-'));
  temporaryProjects.push(projectRoot);
  await writeFile(join(projectRoot, 'breakdown.yaml'), workflow, 'utf8');
  return projectRoot;
}

async function createEmptyProject() {
  const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-core-'));
  temporaryProjects.push(projectRoot);
  return projectRoot;
}

function workflowDocumentAtBytes(byteLength: number) {
  const workflow = {
    schema_version: 'breakdown.workflow.v1',
    id: 'definition-boundary',
    name: 'Definition Boundary',
    nodes: [
      {
        id: 'validate',
        name: 'Validate',
        prompt: 'Validate the exact Workflow Definition bytes.',
      },
    ],
    extensions: {
      'com.example.boundary': {
        payload: '',
      },
    },
  };
  const emptyDocument = JSON.stringify(workflow);
  workflow.extensions['com.example.boundary'].payload = 'x'.repeat(
    byteLength - Buffer.byteLength(emptyDocument),
  );
  const document = JSON.stringify(workflow);
  expect(Buffer.byteLength(document)).toBe(byteLength);
  return document;
}

function workflowWithNodeCount(count: number) {
  return JSON.stringify({
    schema_version: 'breakdown.workflow.v1',
    id: 'node-boundary',
    name: 'Node Boundary',
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `node-${index}`,
      name: `Node ${index}`,
      prompt: 'Validate the Node Definition count.',
    })),
  });
}

function workflowWithInputCount(count: number) {
  const inputEntries = Array.from({ length: count }, (_, index) => [`input-${index}`, {}] as const);
  return JSON.stringify({
    schema_version: 'breakdown.workflow.v1',
    id: 'input-boundary',
    name: 'Input Boundary',
    inputs: Object.fromEntries(inputEntries),
    nodes: Array.from({ length: Math.ceil(count / 64) }, (_, nodeIndex) => ({
      id: `node-${nodeIndex}`,
      name: `Node ${nodeIndex}`,
      prompt: 'Consume the Workflow Inputs.',
      inputs: Object.fromEntries(
        inputEntries
          .slice(nodeIndex * 64, (nodeIndex + 1) * 64)
          .map(([inputId], index) => [`binding-${index}`, { workflow_input: inputId }]),
      ),
    })),
  });
}

function workflowWithBindingCount(count: number) {
  const inputEntries = Array.from({ length: count }, (_, index) => [`input-${index}`, {}] as const);
  return JSON.stringify({
    schema_version: 'breakdown.workflow.v1',
    id: 'binding-boundary',
    name: 'Binding Boundary',
    inputs: Object.fromEntries(inputEntries),
    nodes: [
      {
        id: 'consume',
        name: 'Consume',
        prompt: 'Consume the Workflow Inputs.',
        inputs: Object.fromEntries(
          inputEntries.map(([inputId], index) => [`binding-${index}`, { workflow_input: inputId }]),
        ),
      },
    ],
  });
}

function workflowWithPromptBytes(byteLength: number) {
  return JSON.stringify({
    schema_version: 'breakdown.workflow.v1',
    id: 'prompt-boundary',
    name: 'Prompt Boundary',
    nodes: [
      {
        id: 'prompt',
        name: 'Prompt',
        prompt: 'x'.repeat(byteLength),
      },
    ],
  });
}

function workflowWithNestingDepth(depth: number) {
  let nested: unknown = 'leaf';
  for (let currentDepth = 3; currentDepth < depth; currentDepth += 1) {
    nested = [nested];
  }
  return JSON.stringify({
    schema_version: 'breakdown.workflow.v1',
    id: 'depth-boundary',
    name: 'Depth Boundary',
    extensions: {
      'com.example.depth': {
        nested,
      },
    },
    nodes: [
      {
        id: 'validate',
        name: 'Validate',
        prompt: 'Validate nesting depth.',
      },
    ],
  });
}

function workflowWithSchemaNodeCount(count: number) {
  return JSON.stringify({
    schema_version: 'breakdown.workflow.v1',
    id: 'schema-boundary',
    name: 'Schema Boundary',
    nodes: [
      {
        id: 'validate',
        name: 'Validate',
        prompt: 'Validate the Data Contract schema node count.',
        data_contract: {
          properties: Object.fromEntries(
            Array.from({ length: count - 1 }, (_, index) => [`property-${index}`, {}]),
          ),
        },
      },
    ],
  });
}

function workflowWithPathBytes(byteLength: number) {
  return JSON.stringify({
    schema_version: 'breakdown.workflow.v1',
    id: 'path-boundary',
    name: 'Path Boundary',
    inputs: {
      source: {
        default: 'x'.repeat(byteLength),
      },
    },
    nodes: [
      {
        id: 'consume',
        name: 'Consume',
        prompt: 'Consume the source.',
        inputs: {
          source: {
            workflow_input: 'source',
          },
        },
      },
    ],
  });
}

function workflowWithDiagnosticCount(count: number) {
  return JSON.stringify({
    schema_version: 'breakdown.workflow.v1',
    id: 'diagnostic-boundary',
    name: 'Diagnostic Boundary',
    inputs: {
      source: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`unexpected-${index}`, true]),
      ),
    },
    nodes: [
      {
        id: 'consume',
        name: 'Consume',
        prompt: 'Consume the source.',
        inputs: {
          source: {
            workflow_input: 'source',
          },
        },
      },
    ],
  });
}

function generatedWorkflow(
  generator: NonNullable<ConformanceRow['generated_cases']>[number]['generator'],
  value: number,
) {
  switch (generator) {
    case 'workflow_definition_bytes':
      return workflowDocumentAtBytes(value);
    case 'nodes_per_workflow':
      return workflowWithNodeCount(value);
    case 'workflow_inputs_per_workflow':
      return workflowWithInputCount(value);
    case 'input_bindings_per_node':
      return workflowWithBindingCount(value);
    case 'node_prompt_bytes':
      return workflowWithPromptBytes(value);
    case 'yaml_json_nesting_depth':
      return workflowWithNestingDepth(value);
    case 'data_contract_schema_nodes':
      return workflowWithSchemaNodeCount(value);
    case 'project_relative_path_bytes':
      return workflowWithPathBytes(value);
    case 'diagnostics_returned':
      return workflowWithDiagnosticCount(value);
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryProjects
      .splice(0)
      .map((projectRoot) => rm(projectRoot, { recursive: true, force: true })),
  );
});

describe('operate', () => {
  it('should publish the complete fixed core limit profile as a machine contract', () => {
    expect(limitCatalog.schema_version).toBe('breakdown.limits.v1');
    expect(limitCatalog.limits).toEqual(FIXED_LIMITS);
  });

  it('should keep the runtime Data Contract dialect aligned with the machine schema', () => {
    expect(workflowMachineSchema.$defs['data-contract-type'].enum).toEqual(DATA_CONTRACT_TYPES);
    const machineKeywords = workflowMachineSchema.$defs['data-contract-schema'].properties;
    expect(Object.keys(machineKeywords)).toEqual(Object.keys(DATA_CONTRACT_KEYWORD_KINDS));
    for (const [keyword, kind] of Object.entries(DATA_CONTRACT_KEYWORD_KINDS)) {
      expect(machineKeywords[keyword], keyword).toEqual(
        EXPECTED_DATA_CONTRACT_KEYWORD_SCHEMAS[kind],
      );
    }
  });

  it.each([1_048_575, 1_048_576])(
    'should accept and preserve a %i-byte Workflow Definition',
    async (byteLength) => {
      const definition = workflowDocumentAtBytes(byteLength);
      const projectRoot = await createProject(definition);

      const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

      expect(result).toMatchObject({ ok: true });
      if (result.ok) {
        expect(result.value.workflow).toEqual(JSON.parse(definition));
      }
    },
  );

  it('should fail closed when the Workflow Definition exceeds its byte limit', async () => {
    const projectRoot = await createProject(workflowDocumentAtBytes(1_048_577));

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'resource_limit',
        code: 'limit_exceeded',
        message: 'A fixed resource limit was exceeded.',
        diagnostics: [],
      },
    });
    await expect(access(join(projectRoot, 'outputs'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(projectRoot, '.breakdown'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should map YAML parser resource exhaustion to the fixed depth-limit failure', async () => {
    const nesting = 1_000;
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: parser-depth
name: Parser Depth
extensions:
  com.example.depth:
    nested: ${'['.repeat(nesting)}0${']'.repeat(nesting)}
nodes:
  - id: validate
    name: Validate
    prompt: Validate parser depth exhaustion.
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'resource_limit',
        code: 'limit_exceeded',
        message: 'A fixed resource limit was exceeded.',
        diagnostics: [],
      },
    });
  });

  const fixedDefinitionLimits = [
    {
      resource: 'Node Definitions',
      limit: 256,
      workflow: workflowWithNodeCount,
    },
    {
      resource: 'Workflow Inputs',
      limit: 128,
      workflow: workflowWithInputCount,
    },
    {
      resource: 'Input Bindings per node',
      limit: 64,
      workflow: workflowWithBindingCount,
    },
    {
      resource: 'Node prompt bytes',
      limit: 102_400,
      workflow: workflowWithPromptBytes,
    },
    {
      resource: 'YAML/JSON nesting depth',
      limit: 64,
      workflow: workflowWithNestingDepth,
    },
    {
      resource: 'Data Contract schema nodes',
      limit: 4_096,
      workflow: workflowWithSchemaNodeCount,
    },
    {
      resource: 'project-relative path bytes',
      limit: 1_024,
      workflow: workflowWithPathBytes,
    },
  ];

  describe.each(fixedDefinitionLimits)('$resource limit', ({ limit, workflow }) => {
    it.each([limit - 1, limit])('should accept the boundary value %i', async (value) => {
      const definition = workflow(value);
      const projectRoot = await createProject(definition);

      const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

      expect(result).toMatchObject({ ok: true });
      if (result.ok) {
        expect(result.value.workflow).toEqual(JSON.parse(definition));
      }
    });

    it(`should fail closed at ${limit + 1}`, async () => {
      const projectRoot = await createProject(workflow(limit + 1));

      const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

      expect(result).toEqual({
        ok: false,
        failure: {
          kind: 'resource_limit',
          code: 'limit_exceeded',
          message: 'A fixed resource limit was exceeded.',
          diagnostics: [],
        },
      });
      await expect(access(join(projectRoot, 'outputs'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(join(projectRoot, '.breakdown'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    });
  });

  it.each([999, 1_000])(
    'should return all %i independently discoverable diagnostics in stable order',
    async (diagnosticCount) => {
      const projectRoot = await createProject(workflowWithDiagnosticCount(diagnosticCount));

      const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

      expect(result).toMatchObject({
        ok: false,
        failure: {
          kind: 'invalid',
          code: 'invalid_workflow',
        },
      });
      if (!result.ok) {
        expect(result.failure.diagnostics).toHaveLength(diagnosticCount);
        expect(result.failure.diagnostics).toEqual(
          [...result.failure.diagnostics].sort(
            (left, right) =>
              left.path.localeCompare(right.path) || left.code.localeCompare(right.code),
          ),
        );
      }
    },
  );

  it('should fail closed without returning more than 1,000 diagnostics', async () => {
    const projectRoot = await createProject(workflowWithDiagnosticCount(1_001));

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'resource_limit',
        code: 'limit_exceeded',
        message: 'A fixed resource limit was exceeded.',
      },
    });
    if (!result.ok) {
      expect(result.failure.diagnostics).toHaveLength(1_000);
    }
    await expect(access(join(projectRoot, 'outputs'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(join(projectRoot, '.breakdown'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should validate a minimal Workflow Definition from an explicit project root', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: research
name: Research
nodes:
  - id: investigate
    name: Investigate
    prompt: Gather the relevant evidence.
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toEqual({
      ok: true,
      value: {
        definitionPath: 'breakdown.yaml',
        workflow: {
          schema_version: 'breakdown.workflow.v1',
          id: 'research',
          name: 'Research',
          nodes: [
            {
              id: 'investigate',
              name: 'Investigate',
              prompt: 'Gather the relevant evidence.',
            },
          ],
        },
      },
    });
  });

  it('should reject validation without an explicit project root', async () => {
    const result = await operate({ operation: 'validate_workflow' }, {});

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'project_root_required',
        message: 'An explicit project root is required.',
        diagnostics: [],
      },
    });
  });

  it('should return a structured I/O failure when breakdown.yaml is absent', async () => {
    const projectRoot = await createEmptyProject();

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'io',
        code: 'io_error',
        message: 'Could not read breakdown.yaml.',
        diagnostics: [],
      },
    });
  });

  it('should reject an unsupported dispatcher operation', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: research
name: Research
nodes:
  - id: investigate
    name: Investigate
    prompt: Gather the relevant evidence.
`);

    const result = await operate(
      { operation: 'not_validate_workflow' } as unknown as {
        operation: 'validate_workflow';
      },
      { projectRoot },
    );

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'unsupported',
        code: 'unsupported_operation',
        message: 'The requested operation is not supported.',
        diagnostics: [],
      },
    });
  });

  it('should count name and description limits in Unicode characters', async () => {
    const workflowName = '😀'.repeat(200);
    const description = '🧪'.repeat(2_000);
    const nodeName = '界'.repeat(200);
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: unicode-boundaries
name: ${workflowName}
description: ${description}
nodes:
  - id: validate
    name: ${nodeName}
    prompt: Validate Unicode boundaries.
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({ ok: true });
  });

  it('should reject names and descriptions above their Unicode character limits', async () => {
    const workflowName = '😀'.repeat(201);
    const description = '🧪'.repeat(2_001);
    const nodeName = '界'.repeat(201);
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: unicode-overflow
name: ${workflowName}
description: ${description}
nodes:
  - id: validate
    name: ${nodeName}
    prompt: Validate Unicode boundaries.
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        diagnostics: [
          { code: 'schema', path: '/description' },
          { code: 'schema', path: '/name' },
          { code: 'schema', path: '/nodes/0/name' },
        ],
      },
    });
  });

  it('should preserve a portable constrained Data Contract', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: contracted-result
name: Contracted Result
nodes:
  - id: summarize
    name: Summarize
    prompt: Produce a structured summary.
    data_contract:
      type: object
      title: Summary
      description: A portable structured summary.
      properties:
        count:
          type: integer
          minimum: 0
          maximum: 10
          exclusiveMinimum: -1
          exclusiveMaximum: 11
        labels:
          type: array
          items:
            type: string
            minLength: 1
            maxLength: 20
          minItems: 1
          maxItems: 3
        state:
          enum: [ready, blocked]
        version:
          const: 1
      required: [count, labels, state, version]
      additionalProperties: false
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({
      ok: true,
      value: {
        workflow: {
          nodes: [
            {
              data_contract: {
                type: 'object',
                properties: {
                  labels: {
                    items: {
                      type: 'string',
                    },
                  },
                },
                additionalProperties: false,
              },
            },
          ],
        },
      },
    });
  });

  it('should accept empty and repeated enum members under JSON Schema 2020-12', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: enum-semantics
name: Enum Semantics
nodes:
  - id: impossible
    name: Impossible
    prompt: Exercise an empty enum.
    data_contract:
      enum: []
  - id: repeated
    name: Repeated
    prompt: Exercise repeated enum values.
    data_contract:
      enum: [same, same]
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({ ok: true });
  });

  it('should reject unsupported Data Contract keywords and invalid keyword shapes', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: invalid-contracts
name: Invalid Contracts
nodes:
  - id: invalid
    name: Invalid
    prompt: Exercise invalid contract shapes.
    data_contract:
      type: unknown
      properties:
        nested:
          type: [string, string]
          pattern: ".*"
      required: [nested, nested, 1]
      additionalProperties: no
      minItems: -1
      maxLength: 1.5
      minimum: not-a-number
      default: {}
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_workflow',
        diagnostics: [
          { code: 'schema', path: '/nodes/0/data_contract/additionalProperties' },
          { code: 'schema', path: '/nodes/0/data_contract/default' },
          { code: 'schema', path: '/nodes/0/data_contract/maxLength' },
          { code: 'schema', path: '/nodes/0/data_contract/minItems' },
          { code: 'schema', path: '/nodes/0/data_contract/minimum' },
          { code: 'schema', path: '/nodes/0/data_contract/properties/nested/pattern' },
          { code: 'schema', path: '/nodes/0/data_contract/properties/nested/type' },
          { code: 'schema', path: '/nodes/0/data_contract/required' },
          { code: 'schema', path: '/nodes/0/data_contract/type' },
        ],
      },
    });
  });

  it('should reject Data Contract keywords inherited from Object.prototype', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: inherited-keywords
name: Inherited Keywords
nodes:
  - id: invalid
    name: Invalid
    prompt: Reject inherited object property names.
    data_contract:
      __proto__: {}
      constructor: {}
      hasOwnProperty: {}
      toString: {}
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_workflow',
        diagnostics: [
          { code: 'schema', path: '/nodes/0/data_contract/__proto__' },
          { code: 'schema', path: '/nodes/0/data_contract/constructor' },
          { code: 'schema', path: '/nodes/0/data_contract/hasOwnProperty' },
          { code: 'schema', path: '/nodes/0/data_contract/toString' },
        ],
      },
    });
  });

  it('should preserve inert reverse-DNS Workflow Definition and Node Definition extensions', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: extended
name: Extended
extensions:
  com.example.canvas:
    collapsed: true
    position:
      x: 10
      y: 20
nodes:
  - id: inspect
    name: Inspect
    prompt: Inspect the source.
    extensions:
      org.example.reviewer:
        labels: [portable, inert]
        settings:
          enabled: false
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({
      ok: true,
      value: {
        workflow: {
          extensions: {
            'com.example.canvas': {
              collapsed: true,
              position: { x: 10, y: 20 },
            },
          },
          nodes: [
            {
              extensions: {
                'org.example.reviewer': {
                  labels: ['portable', 'inert'],
                  settings: { enabled: false },
                },
              },
            },
          ],
        },
      },
    });
  });

  it('should preserve JSON integers beyond the safe JavaScript number range', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: exact-integers
name: Exact Integers
extensions:
  com.example.metadata:
    serial: 9007199254740993
nodes:
  - id: inspect
    name: Inspect
    prompt: Preserve exact JSON integers.
    data_contract:
      const: 9007199254740993
      minimum: 9007199254740993
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({
      ok: true,
      value: {
        workflow: {
          extensions: {
            'com.example.metadata': {
              serial: 9_007_199_254_740_993n,
            },
          },
          nodes: [
            {
              data_contract: {
                const: 9_007_199_254_740_993n,
                minimum: 9_007_199_254_740_993n,
              },
            },
          ],
        },
      },
    });
  });

  it('should preserve exact scientific-notation integers and high-precision decimals', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: exact-numbers
name: Exact Numbers
extensions:
  com.example.metadata:
    scientific: 9.007199254740993e15
    decimal: 0.10000000000000001
nodes:
  - id: inspect
    name: Inspect
    prompt: Preserve exact JSON numbers.
    data_contract:
      minimum: 9.007199254740993e15
      maximum: 0.10000000000000001
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      const metadata = result.value.workflow.extensions?.['com.example.metadata'];
      expect(metadata?.scientific).toBe(9_007_199_254_740_993n);
      expect(isRawJsonNumber(metadata?.decimal)).toBe(true);
      expect(JSON.stringify({ decimal: metadata?.decimal })).toBe(
        '{"decimal":1.0000000000000001e-1}',
      );
      const dataContract = result.value.workflow.nodes[0]?.data_contract;
      expect(dataContract?.minimum).toBe(9_007_199_254_740_993n);
      expect(isRawJsonNumber(dataContract?.maximum)).toBe(true);
    }
  });

  it('should reject invalid extension namespaces and non-object values', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: invalid-extensions
name: Invalid Extensions
extensions:
  invalid: {}
  com..example: {}
  com.example.value: false
nodes:
  - id: inspect
    name: Inspect
    prompt: Inspect the source.
    extensions:
      Com.Example.Reviewer: {}
      org.example.reviewer: []
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        diagnostics: [
          { code: 'schema', path: '/extensions/com..example' },
          { code: 'schema', path: '/extensions/com.example.value' },
          { code: 'schema', path: '/extensions/invalid' },
          { code: 'schema', path: '/nodes/0/extensions/Com.Example.Reviewer' },
          { code: 'schema', path: '/nodes/0/extensions/org.example.reviewer' },
        ],
      },
    });
  });

  it('should reject non-string mapping keys throughout JSON-compatible values', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: json-compatible
name: JSON Compatible
extensions:
  com.example.metadata:
    1: invalid
nodes:
  - id: validate
    name: Validate
    prompt: Validate JSON-compatible mapping keys.
    data_contract:
      enum:
        - false: invalid
      properties:
        true:
          type: string
`);

    const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        diagnostics: [
          { code: 'schema', path: '/extensions/com.example.metadata/1' },
          { code: 'schema', path: '/nodes/0/data_contract/enum/0/false' },
          { code: 'schema', path: '/nodes/0/data_contract/properties/true' },
        ],
      },
    });
  });

  describe.each(conformanceMatrix.rows)('$id', (row) => {
    it(`should satisfy ${row.id}: ${row.requirement}`, async () => {
      if (row.generated_cases !== undefined) {
        for (const generatedCase of row.generated_cases) {
          const projectRoot = await createProject(
            generatedWorkflow(generatedCase.generator, generatedCase.value),
          );
          const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

          expect(result.ok, generatedCase.id).toBe(generatedCase.oracle.ok);
          if (!generatedCase.oracle.ok) {
            expect(result, generatedCase.id).toMatchObject({
              ok: false,
              failure: {
                kind: generatedCase.oracle.failure_kind,
                code: generatedCase.oracle.failure_code,
              },
            });
            if (!result.ok && generatedCase.oracle.diagnostic_count !== undefined) {
              expect(result.failure.diagnostics, generatedCase.id).toHaveLength(
                generatedCase.oracle.diagnostic_count,
              );
            }
          }
        }
        return;
      }
      if (row.fixture === undefined || row.oracle === undefined) {
        throw new Error(`Conformance row ${row.id} has no executable fixture.`);
      }
      const fixture = await readFile(new URL(row.fixture, conformanceRoot));
      let workflow: string | Uint8Array =
        row.encoding === 'base64'
          ? Buffer.from(fixture.toString('utf8').trim(), 'base64')
          : fixture;
      if (row.oracle.ok && row.oracle.effect !== undefined) {
        workflow = fixture.toString('utf8').replace('{{SENTINEL}}', row.oracle.effect.absent_path);
      }
      const projectRoot = await createProject(workflow);

      const result = await operate({ operation: 'validate_workflow' }, { projectRoot });

      expect(result.ok).toBe(row.oracle.ok);
      if (!row.oracle.ok) {
        expect(result).toMatchObject({
          ok: false,
          failure: {
            kind: row.oracle.failure_kind,
            code: row.oracle.failure_code,
            diagnostics: row.oracle.diagnostics,
          },
        });
      } else if (row.oracle.value !== undefined) {
        expect(result).toEqual({
          ok: true,
          value: row.oracle.value,
        });
      } else if (row.oracle.effect !== undefined) {
        await expect(
          access(join(projectRoot, row.oracle.effect.absent_path)),
        ).rejects.toMatchObject({ code: 'ENOENT' });
      }
    });
  });
});

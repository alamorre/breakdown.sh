import {
  access,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
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

const runManifestMachineSchema = JSON.parse(
  await readFile(
    new URL('../../../local/contracts/schemas/breakdown.run.v1.schema.json', import.meta.url),
    'utf8',
  ),
) as {
  additionalProperties: boolean;
  required: string[];
  properties: Record<string, unknown>;
};

const runCreationMatrix = JSON.parse(
  await readFile(
    new URL('../../../local/contracts/conformance/run-creation/matrix.json', import.meta.url),
    'utf8',
  ),
) as {
  rows: Array<{ id: string; requirement: string; oracle: string }>;
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

  it('should publish the immutable Run Manifest contract and its conformance rows', () => {
    expect(runManifestMachineSchema).toMatchObject({
      additionalProperties: false,
      required: ['schema_version', 'run_id', 'created_at', 'workflow', 'inputs', 'producer'],
    });
    expect(Object.keys(runManifestMachineSchema.properties)).toEqual([
      'schema_version',
      'run_id',
      'created_at',
      'workflow',
      'inputs',
      'producer',
      'extensions',
    ]);
    for (const mutableField of [
      'status',
      'completed_at',
      'attempt',
      'results',
      'cancellation',
      'metrics',
    ]) {
      expect(runManifestMachineSchema.properties).not.toHaveProperty(mutableField);
    }
    expect(runCreationMatrix.rows.map((row) => row.id)).toEqual([
      'RUN-001',
      'RUN-002',
      'RUN-003',
      'RUN-004',
      'RUN-005',
      'RUN-006',
      'RUN-007',
      'RUN-008',
      'RUN-009',
    ]);
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

  it('should create a byte-exact immutable Run through the dispatcher', async () => {
    const workflow = `schema_version: breakdown.workflow.v1
id: research
name: Research
nodes:
  - id: investigate
    name: Investigate
    prompt: Gather the relevant evidence.
`;
    const projectRoot = await createProject(workflow);

    const result = await operate(
      { operation: 'create_run' },
      {
        projectRoot,
        producer: { name: '@breakdown-sh/core', version: '1.0.0-beta.1' },
        testControls: {
          now: () => new Date('2026-07-24T12:34:56.789Z'),
          randomBytes: () => Buffer.alloc(8),
        },
      },
    );

    const runId = '20260724T123456.789Z--research--aaaaaaaaaaaa';
    const runPath = `outputs/${runId}`;
    expect(result).toEqual({
      ok: true,
      value: {
        run_id: runId,
        path: runPath,
        created_at: '2026-07-24T12:34:56.789Z',
        workflow: {
          id: 'research',
          snapshot: 'breakdown.yaml',
          sha256: '50140f5006c219cf6a32689e54b581ad420a780b4ffe3c67418345edc5652785',
        },
        inputs: {},
        producer: { name: '@breakdown-sh/core', version: '1.0.0-beta.1' },
      },
    });
    expect(await readFile(join(projectRoot, runPath, 'breakdown.yaml'), 'utf8')).toBe(workflow);
    expect(await readdir(join(projectRoot, runPath, 'steps'))).toEqual([]);
    expect(await readFile(join(projectRoot, runPath, 'run.md'), 'utf8')).toBe(`---
schema_version: breakdown.run.v1
run_id: ${runId}
created_at: "2026-07-24T12:34:56.789Z"
workflow:
  id: research
  snapshot: breakdown.yaml
  sha256: 50140f5006c219cf6a32689e54b581ad420a780b4ffe3c67418345edc5652785
inputs: {}
producer:
  name: "@breakdown-sh/core"
  version: "1.0.0-beta.1"
---
`);
    if (process.platform !== 'win32') {
      expect((await stat(join(projectRoot, runPath))).mode & 0o777).toBe(0o700);
      expect((await stat(join(projectRoot, runPath, 'steps'))).mode & 0o777).toBe(0o700);
      expect((await stat(join(projectRoot, runPath, 'run.md'))).mode & 0o777).toBe(0o600);
      expect((await stat(join(projectRoot, runPath, 'breakdown.yaml'))).mode & 0o777).toBe(0o600);
    }
  });

  it('should resolve each Workflow Input from one override or default and hash its raw bytes', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: input-hashes
name: Input Hashes
inputs:
  source:
    default: inputs/default.bin
  brief: {}
nodes:
  - id: compare
    name: Compare
    prompt: Compare the exact Inputs.
    inputs:
      source:
        workflow_input: source
      brief:
        workflow_input: brief
`);
    await mkdir(join(projectRoot, 'inputs'));
    await mkdir(join(projectRoot, 'sources'));
    await writeFile(join(projectRoot, 'inputs', 'default.bin'), Buffer.from([0, 255, 13, 10]));
    await writeFile(join(projectRoot, 'sources', 'override.txt'), 'exact\r\nbytes');

    const result = await operate(
      { operation: 'create_run', inputs: { brief: 'sources/override.txt' } },
      {
        projectRoot,
        testControls: {
          now: () => new Date('2026-07-24T13:00:00.000Z'),
          randomBytes: () => Buffer.alloc(8),
        },
      },
    );

    expect(result).toMatchObject({
      ok: true,
      value: {
        inputs: {
          brief: {
            path: 'sources/override.txt',
            sha256: '6fd1c2dce68f88fc2413c16f16411d7ea1123757f9428f94541212797fe1ddba',
          },
          source: {
            path: 'inputs/default.bin',
            sha256: 'e9489f37fb3051e9efa1dc916004d7274e7b63975e3209708947267f2393a9be',
          },
        },
      },
    });
    if (!result.ok) throw new Error('Expected Run creation to succeed.');
    const manifest = await readFile(join(projectRoot, result.value.path, 'run.md'), 'utf8');
    expect(manifest).toContain(`inputs:
  brief:
    path: "sources/override.txt"
    sha256: 6fd1c2dce68f88fc2413c16f16411d7ea1123757f9428f94541212797fe1ddba
  source:
    path: "inputs/default.bin"
    sha256: e9489f37fb3051e9efa1dc916004d7274e7b63975e3209708947267f2393a9be
`);
  });

  it('should resolve a Workflow Input whose valid identifier matches an object prototype name', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: prototype-name
name: Prototype Name
inputs:
  constructor:
    default: source.txt
nodes:
  - id: consume
    name: Consume
    prompt: Consume the Input.
    inputs:
      constructor:
        workflow_input: constructor
`);
    await writeFile(join(projectRoot, 'source.txt'), 'prototype-safe');

    const result = await operate({ operation: 'create_run' }, { projectRoot });

    expect(result).toMatchObject({
      ok: true,
      value: {
        inputs: {
          constructor: {
            path: 'source.txt',
          },
        },
      },
    });
  });

  it.each([
    [FIXED_LIMITS.workflow_input_file_bytes - 1, true],
    [FIXED_LIMITS.workflow_input_file_bytes, true],
    [FIXED_LIMITS.workflow_input_file_bytes + 1, false],
  ] as const)(
    'should enforce the %i-byte Workflow Input file boundary without truncation',
    async (byteLength, shouldSucceed) => {
      const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: input-limit
name: Input Limit
inputs:
  source:
    default: source.bin
nodes:
  - id: consume
    name: Consume
    prompt: Consume the exact Input.
    inputs:
      source:
        workflow_input: source
`);
      const inputPath = join(projectRoot, 'source.bin');
      await writeFile(inputPath, '');
      await truncate(inputPath, byteLength);

      const result = await operate({ operation: 'create_run' }, { projectRoot });

      if (shouldSucceed) {
        expect(result).toMatchObject({ ok: true });
      } else {
        expect(result).toMatchObject({
          ok: false,
          failure: {
            kind: 'resource_limit',
            code: 'limit_exceeded',
          },
        });
        await expect(access(join(projectRoot, 'outputs'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
    },
  );

  it.each([
    [FIXED_LIMITS.aggregate_workflow_input_bytes_per_run - 1, true],
    [FIXED_LIMITS.aggregate_workflow_input_bytes_per_run, true],
    [FIXED_LIMITS.aggregate_workflow_input_bytes_per_run + 1, false],
  ] as const)(
    'should enforce the %i-byte aggregate Workflow Input boundary without partial publication',
    async (aggregateBytes, shouldSucceed) => {
      const inputSizes: number[] = [];
      let remaining = aggregateBytes;
      while (remaining > 0) {
        const size = Math.min(remaining, FIXED_LIMITS.workflow_input_file_bytes);
        inputSizes.push(size);
        remaining -= size;
      }
      const inputEntries = inputSizes.map(
        (_, index) =>
          [
            `input-${index}`,
            {
              default: `inputs/input-${index}.bin`,
            },
          ] as const,
      );
      const workflow = JSON.stringify({
        schema_version: 'breakdown.workflow.v1',
        id: 'aggregate-limit',
        name: 'Aggregate Limit',
        inputs: Object.fromEntries(inputEntries),
        nodes: [
          {
            id: 'consume',
            name: 'Consume',
            prompt: 'Consume the exact Inputs.',
            inputs: Object.fromEntries(
              inputEntries.map(([inputId]) => [inputId, { workflow_input: inputId }]),
            ),
          },
        ],
      });
      const projectRoot = await createProject(workflow);
      await mkdir(join(projectRoot, 'inputs'));
      for (const [index, size] of inputSizes.entries()) {
        const inputPath = join(projectRoot, 'inputs', `input-${index}.bin`);
        await writeFile(inputPath, '');
        await truncate(inputPath, size);
      }

      const result = await operate({ operation: 'create_run' }, { projectRoot });

      if (shouldSucceed) {
        expect(result).toMatchObject({ ok: true });
      } else {
        expect(result).toMatchObject({
          ok: false,
          failure: {
            kind: 'resource_limit',
            code: 'limit_exceeded',
          },
        });
        await expect(access(join(projectRoot, 'outputs'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      }
    },
  );

  it('should report unknown, missing, and unsafe Workflow Input resolutions before publication', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: input-resolution
name: Input Resolution
inputs:
  alpha: {}
  beta: {}
nodes:
  - id: consume
    name: Consume
    prompt: Consume every Input.
    inputs:
      alpha:
        workflow_input: alpha
      beta:
        workflow_input: beta
`);

    const result = await operate(
      {
        operation: 'create_run',
        inputs: {
          alpha: '../outside.txt',
          extra: 'extra.txt',
        },
      },
      { projectRoot },
    );

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_workflow_input',
        message: 'The Workflow Inputs are invalid.',
        diagnostics: [
          {
            code: 'invalid_path',
            path: '/inputs/alpha',
            message: 'Workflow Input paths must be portable project-relative paths.',
            file: 'breakdown.yaml',
          },
          {
            code: 'schema',
            path: '/inputs/beta',
            message: 'A path is required for this Workflow Input.',
            file: 'breakdown.yaml',
          },
          {
            code: 'schema',
            path: '/inputs/extra',
            message: 'Unknown Workflow Input override.',
            file: 'breakdown.yaml',
          },
        ],
      },
    });
    await expect(access(join(projectRoot, 'outputs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should return a structured failure for a non-string direct Input override', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: malformed-override
name: Malformed Override
inputs:
  source: {}
nodes:
  - id: consume
    name: Consume
    prompt: Consume the Input.
    inputs:
      source:
        workflow_input: source
`);

    const result = await operate(
      {
        operation: 'create_run',
        inputs: { source: 42 },
      } as unknown as Parameters<typeof operate>[0],
      { projectRoot },
    );

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_workflow_input',
        diagnostics: [{ code: 'schema', path: '/inputs/source' }],
      },
    });
    await expect(access(join(projectRoot, 'outputs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should reject an invalid trusted producer identity before publication', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: invalid-producer
name: Invalid Producer
nodes:
  - id: execute
    name: Execute
    prompt: Execute once.
`);

    const result = await operate(
      { operation: 'create_run' },
      {
        projectRoot,
        producer: { name: '', version: '1.0.0-beta.1' },
      },
    );

    expect(result).toEqual({
      ok: false,
      failure: {
        kind: 'internal',
        code: 'internal_error',
        message: 'The trusted producer identity is invalid.',
        diagnostics: [],
      },
    });
    await expect(access(join(projectRoot, 'outputs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should reject a Workflow Input that traverses a symbolic link', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: linked-input
name: Linked Input
inputs:
  source:
    default: linked.txt
nodes:
  - id: consume
    name: Consume
    prompt: Consume the Input.
    inputs:
      source:
        workflow_input: source
`);
    await writeFile(join(projectRoot, 'source.txt'), 'private source');
    await symlink('source.txt', join(projectRoot, 'linked.txt'));

    const result = await operate({ operation: 'create_run' }, { projectRoot });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_workflow_input',
        diagnostics: [{ code: 'invalid_path', path: '/inputs/source' }],
      },
    });
    await expect(access(join(projectRoot, 'outputs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should reject a Workflow Input below a linked ancestor', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: linked-ancestor
name: Linked Ancestor
inputs:
  source:
    default: linked/source.txt
nodes:
  - id: consume
    name: Consume
    prompt: Consume the Input.
    inputs:
      source:
        workflow_input: source
`);
    await mkdir(join(projectRoot, 'actual'));
    await writeFile(join(projectRoot, 'actual', 'source.txt'), 'private source');
    await symlink('actual', join(projectRoot, 'linked'));

    const result = await operate({ operation: 'create_run' }, { projectRoot });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_workflow_input',
        diagnostics: [{ code: 'invalid_path', path: '/inputs/source' }],
      },
    });
  });

  it('should reject directories and hard-linked files as Workflow Inputs', async () => {
    for (const inputKind of ['directory', 'hard-link'] as const) {
      const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: non-regular-input
name: Non-Regular Input
inputs:
  source:
    default: source
nodes:
  - id: consume
    name: Consume
    prompt: Consume the Input.
    inputs:
      source:
        workflow_input: source
`);
      if (inputKind === 'directory') {
        await mkdir(join(projectRoot, 'source'));
      } else {
        await writeFile(join(projectRoot, 'original'), 'linked bytes');
        await link(join(projectRoot, 'original'), join(projectRoot, 'source'));
      }

      const result = await operate({ operation: 'create_run' }, { projectRoot });

      expect(result, inputKind).toMatchObject({
        ok: false,
        failure: {
          kind: 'invalid',
          code: 'invalid_workflow_input',
          diagnostics: [{ code: 'invalid_path', path: '/inputs/source' }],
        },
      });
    }
  });

  it('should reject ambiguous case aliases for a Workflow Input path', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: aliased-input
name: Aliased Input
inputs:
  source:
    default: source.txt
nodes:
  - id: consume
    name: Consume
    prompt: Consume the Input.
    inputs:
      source:
        workflow_input: source
`);
    await writeFile(join(projectRoot, 'source.txt'), 'first');
    try {
      await writeFile(join(projectRoot, 'Source.txt'), 'second', { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return;
      throw error;
    }

    const result = await operate({ operation: 'create_run' }, { projectRoot });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_workflow_input',
        diagnostics: [{ code: 'invalid_path', path: '/inputs/source' }],
      },
    });
  });

  it('should never publish a Run through a linked Breakdown-owned directory', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: linked-output
name: Linked Output
nodes:
  - id: execute
    name: Execute
    prompt: Execute safely.
`);
    const outsideRoot = await mkdtemp(join(tmpdir(), 'breakdown-outside-'));
    temporaryProjects.push(outsideRoot);
    await symlink(outsideRoot, join(projectRoot, 'outputs'));

    const result = await operate({ operation: 'create_run' }, { projectRoot });

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'io',
        code: 'io_error',
      },
    });
    expect(await readdir(outsideRoot)).toEqual([]);
  });

  it('should not classify an ordinary local directory by a synchronization-like name', async () => {
    const containerRoot = await mkdtemp(join(tmpdir(), 'breakdown-synchronized-'));
    temporaryProjects.push(containerRoot);
    const projectRoot = join(containerRoot, 'Dropbox', 'project');
    await mkdir(projectRoot, { recursive: true });
    await writeFile(
      join(projectRoot, 'breakdown.yaml'),
      `schema_version: breakdown.workflow.v1
id: synchronized
name: Synchronized
nodes:
  - id: execute
    name: Execute
    prompt: Execute once.
`,
    );

    const result = await operate({ operation: 'create_run' }, { projectRoot });

    expect(result).toMatchObject({
      ok: true,
      value: {
        workflow: { id: 'synchronized' },
        inputs: {},
      },
    });
  });

  it('should fail closed when a Workflow Input mutates during Run creation', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: mutated-input
name: Mutated Input
inputs:
  source:
    default: source.txt
nodes:
  - id: consume
    name: Consume
    prompt: Consume the Input.
    inputs:
      source:
        workflow_input: source
`);
    await writeFile(join(projectRoot, 'source.txt'), 'original bytes');

    const result = await operate(
      { operation: 'create_run' },
      {
        projectRoot,
        testControls: {
          onRunPublicationBoundary: async (boundary) => {
            if (boundary === 'before_publish') {
              await writeFile(join(projectRoot, 'source.txt'), 'mutated bytes');
            }
          },
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_workflow_input',
        diagnostics: [{ code: 'integrity', path: '/inputs/source' }],
      },
    });
    expect(await readdir(join(projectRoot, 'outputs'))).toEqual([]);
  });

  it('should fail closed when a Workflow Input is replaced with the same bytes', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: replaced-input
name: Replaced Input
inputs:
  source:
    default: source.txt
nodes:
  - id: consume
    name: Consume
    prompt: Consume the Input.
    inputs:
      source:
        workflow_input: source
`);
    const inputPath = join(projectRoot, 'source.txt');
    await writeFile(inputPath, 'same bytes');

    const result = await operate(
      { operation: 'create_run' },
      {
        projectRoot,
        testControls: {
          onRunPublicationBoundary: async (boundary) => {
            if (boundary === 'before_publish') {
              await rm(inputPath);
              await writeFile(inputPath, 'same bytes');
            }
          },
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'invalid',
        code: 'invalid_workflow_input',
        diagnostics: [{ code: 'integrity', path: '/inputs/source' }],
      },
    });
    expect(await readdir(join(projectRoot, 'outputs'))).toEqual([]);
  });

  it('should leave no visible partial Run after a publication fault', async () => {
    const boundaries = [
      'after_staging_created',
      'after_snapshot_written',
      'after_manifest_written',
      'before_publish',
    ] as const;

    for (const boundaryToFail of boundaries) {
      const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: publication-fault
name: Publication Fault
nodes:
  - id: test
    name: Test
    prompt: Test atomic publication.
`);
      const result = await operate(
        { operation: 'create_run' },
        {
          projectRoot,
          testControls: {
            now: () => new Date('2026-07-24T14:00:00.000Z'),
            randomBytes: () => Buffer.alloc(8),
            onRunPublicationBoundary: (boundary) => {
              if (boundary === boundaryToFail) {
                throw new Error(`Injected ${boundary} failure.`);
              }
            },
          },
        },
      );

      expect(result, boundaryToFail).toMatchObject({
        ok: false,
        failure: {
          kind: 'io',
          code: 'io_error',
        },
      });
      expect(await readdir(join(projectRoot, 'outputs')), boundaryToFail).toEqual([]);
    }
  });

  it('should create a fresh Run when generated identity entropy initially collides', async () => {
    const workflow = `schema_version: breakdown.workflow.v1
id: collision
name: Collision
nodes:
  - id: execute
    name: Execute
    prompt: Execute once.
`;
    const projectRoot = await createProject(workflow);
    const now = () => new Date('2026-07-24T15:00:00.000Z');
    const first = await operate(
      { operation: 'create_run' },
      {
        projectRoot,
        testControls: {
          now,
          randomBytes: () => Buffer.alloc(8),
        },
      },
    );
    let entropyCalls = 0;

    const second = await operate(
      { operation: 'create_run' },
      {
        projectRoot,
        testControls: {
          now,
          randomBytes: () => Buffer.alloc(8, entropyCalls++ === 0 ? 0 : 1),
        },
      },
    );

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (!first.ok || !second.ok) throw new Error('Expected both Runs to be created.');
    expect(second.value.run_id).not.toBe(first.value.run_id);
    expect(await readdir(join(projectRoot, 'outputs'))).toEqual(
      [first.value.run_id, second.value.run_id].sort(),
    );
  });

  it('should never replace a destination that appears before publication', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: no-replace
name: No Replace
nodes:
  - id: execute
    name: Execute
    prompt: Execute once.
`);
    const runId = '20260724T160000.000Z--no-replace--aaaaaaaaaaaa';
    const destinationPath = join(projectRoot, 'outputs', runId);

    const result = await operate(
      { operation: 'create_run' },
      {
        projectRoot,
        testControls: {
          now: () => new Date('2026-07-24T16:00:00.000Z'),
          randomBytes: () => Buffer.alloc(8),
          onRunPublicationBoundary: async (boundary) => {
            if (boundary === 'before_publish') {
              await mkdir(destinationPath);
            }
          },
        },
      },
    );

    expect(result).toMatchObject({
      ok: false,
      failure: {
        kind: 'conflict',
        code: 'run_id_collision',
      },
    });
    expect(await readdir(destinationPath)).toEqual([]);
  });

  it('should preserve prior Workflow Snapshots when the live Workflow Definition changes', async () => {
    const originalWorkflow = `schema_version: breakdown.workflow.v1
id: evolving
name: Evolving
nodes:
  - id: execute
    name: Execute
    prompt: Use the original instructions.
`;
    const revisedWorkflow = originalWorkflow.replace(
      'Use the original instructions.',
      'Use the revised instructions.',
    );
    const projectRoot = await createProject(originalWorkflow);

    const first = await operate({ operation: 'create_run' }, { projectRoot });
    expect(first).toMatchObject({ ok: true });
    if (!first.ok) throw new Error('Expected the first Run to be created.');

    await writeFile(join(projectRoot, 'breakdown.yaml'), revisedWorkflow);
    const second = await operate({ operation: 'create_run' }, { projectRoot });
    expect(second).toMatchObject({ ok: true });
    if (!second.ok) throw new Error('Expected the second Run to be created.');

    expect(await readFile(join(projectRoot, first.value.path, 'breakdown.yaml'), 'utf8')).toBe(
      originalWorkflow,
    );
    expect(await readFile(join(projectRoot, second.value.path, 'breakdown.yaml'), 'utf8')).toBe(
      revisedWorkflow,
    );
    expect(first.value.workflow.sha256).not.toBe(second.value.workflow.sha256);
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

import { readFile, writeFile } from 'node:fs/promises';

import { Ajv2020 } from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const schemaDirectory = new URL('../../../local/contracts/schemas/', import.meta.url);
const outputPath = new URL('../dist/protocol-assets.js', import.meta.url);
const validatorOutputPath = new URL('../dist/protocol-validators.js', import.meta.url);

const schemaFiles = {
  operation: 'breakdown.operation-request.v1.schema.json',
  workPacket: 'breakdown.work-packet.v1.schema.json',
  candidate: 'breakdown.candidate.v1.schema.json',
};

const schemas = Object.fromEntries(
  await Promise.all(
    Object.entries(schemaFiles).map(async ([name, file]) => [
      name,
      JSON.parse(await readFile(new URL(file, schemaDirectory), 'utf8')),
    ]),
  ),
);

const operationOrder = [
  'validate_workflow',
  'create_run',
  'inspect_run',
  'prepare_work',
  'read_work_input',
  'submit_candidate',
];

const descriptions = {
  validate_workflow: 'Validate the project Workflow Definition.',
  create_run: 'Create a new immutable Run.',
  inspect_run: 'Inspect one exact Run and its derived state.',
  prepare_work: 'Prepare deterministic Work Packets without creating a claim.',
  read_work_input: 'Read one exact Input named by a Work Packet.',
  submit_candidate: 'Validate and publish one Candidate Outcome.',
};

const readOnlyOperations = new Set([
  'validate_workflow',
  'inspect_run',
  'prepare_work',
  'read_work_input',
]);

function projectVariant(variant) {
  const definitions = structuredClone(schemas.operation.$defs ?? {});
  const embedded = new Set();

  function rewriteInternalReferences(value, prefix) {
    if (Array.isArray(value)) {
      return value.map((item) => rewriteInternalReferences(item, prefix));
    }
    if (value === null || typeof value !== 'object') return value;

    const rewritten = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && typeof item === 'string' && item.startsWith('#/$defs/')) {
        rewritten[key] = `#/$defs/${prefix}${item.slice('#/$defs/'.length)}`;
      } else {
        rewritten[key] = rewriteInternalReferences(item, prefix);
      }
    }
    return rewritten;
  }

  function embed(name, schema, prefix) {
    if (embedded.has(name)) return;
    embedded.add(name);
    const body = structuredClone(schema);
    const $defs = body.$defs ?? {};
    delete body.$schema;
    delete body.$id;
    delete body.title;
    delete body.$defs;
    definitions[name] = rewriteInternalReferences(body, prefix);
    for (const [definitionName, definition] of Object.entries($defs)) {
      definitions[`${prefix}${definitionName}`] = rewriteInternalReferences(definition, prefix);
    }
  }

  function bundleReferences(value) {
    if (Array.isArray(value)) return value.map(bundleReferences);
    if (value === null || typeof value !== 'object') return value;

    const bundled = {};
    for (const [key, item] of Object.entries(value)) {
      if (key === '$ref' && item === 'breakdown.work-packet.v1') {
        embed('work_packet', schemas.workPacket, 'work_packet_');
        bundled[key] = '#/$defs/work_packet';
      } else if (key === '$ref' && item === 'breakdown.candidate.v1') {
        embed('candidate', schemas.candidate, 'candidate_');
        bundled[key] = '#/$defs/candidate';
      } else {
        bundled[key] = bundleReferences(item);
      }
    }
    return bundled;
  }

  const projected = structuredClone(variant);
  const conditional =
    Array.isArray(projected.allOf) && projected.allOf.length === 1 ? projected.allOf[0] : undefined;
  delete projected.allOf;

  const originalProperties = projected.properties;
  projected.required = [
    'schema_version',
    'project_root',
    ...projected.required.filter((field) => field !== 'schema_version' && field !== 'operation'),
  ];
  projected.properties = {
    schema_version: originalProperties.schema_version,
    project_root: {
      type: 'string',
      minLength: 1,
      description: 'Absolute OS-native path to the selected Breakdown project root.',
    },
    ...Object.fromEntries(
      Object.entries(originalProperties).filter(
        ([field]) => field !== 'schema_version' && field !== 'operation',
      ),
    ),
  };
  if (conditional !== undefined) Object.assign(projected, conditional);

  const bundled = bundleReferences(projected);
  return {
    $schema: schemas.operation.$schema,
    type: 'object',
    ...bundled,
    $defs: definitions,
  };
}

const tools = operationOrder.map((operation) => {
  const variant = schemas.operation.oneOf.find(
    (candidate) => candidate.properties.operation.const === operation,
  );
  if (variant === undefined) {
    throw new Error(`The automation schema is missing the ${operation} operation.`);
  }
  const readOnly = readOnlyOperations.has(operation);
  return {
    name: operation,
    description: descriptions[operation],
    inputSchema: projectVariant(variant),
    annotations: {
      readOnlyHint: readOnly,
      destructiveHint: false,
      idempotentHint: readOnly,
      openWorldHint: false,
    },
  };
});

const validator = new Ajv2020({
  allErrors: true,
  code: { esm: true, lines: true, source: true },
  strict: true,
  strictRequired: false,
});
const validatorExports = {};
for (const tool of tools) {
  const schemaId = `breakdown.mcp-tool-input.v1.${tool.name}`;
  validator.addSchema(tool.inputSchema, schemaId);
  validatorExports[
    `validate${tool.name
      .split('_')
      .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
      .join('')}Arguments`
  ] = schemaId;
}

let validatorOutput = standaloneCode(validator, validatorExports);
const unicodeLengthImport = 'const func1 = require("ajv/dist/runtime/ucs2length").default;';
if (!validatorOutput.includes(unicodeLengthImport)) {
  throw new Error('The generated validator no longer has the expected Unicode-length helper.');
}
validatorOutput = validatorOutput.replace(
  unicodeLengthImport,
  'const func1 = (value) => Array.from(value).length;',
);
if (validatorOutput.includes('require(')) {
  throw new Error('The generated validator unexpectedly requires a runtime dependency.');
}

await writeFile(
  outputPath,
  `// Generated from local/contracts/schemas/breakdown.operation-request.v1.schema.json.\nexport const OPERATION_NAMES = ${JSON.stringify(operationOrder)};\nexport const TOOL_CATALOG = ${JSON.stringify(tools, null, 2)};\n`,
  'utf8',
);
await writeFile(validatorOutputPath, `${validatorOutput}\n`, 'utf8');

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const schemaDirectory = new URL('../../../local/contracts/schemas/', import.meta.url);
const catalogPath = new URL('../../../local/contracts/catalogs/mcp.v1.json', import.meta.url);
const outputPath = new URL('../dist/protocol-assets.js', import.meta.url);
const validatorOutputPath = new URL('../dist/protocol-validators.js', import.meta.url);
const standalonePostprocessorPath = fileURLToPath(
  new URL('../../../scripts/standalone-validator.mjs', import.meta.url),
);

const schemaFiles = {
  operation: 'breakdown.operation-request.v1.schema.json',
  workflow: 'breakdown.workflow.v1.schema.json',
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
const mcpCatalog = JSON.parse(await readFile(catalogPath, 'utf8'));

const operationOrder = mcpCatalog.operations.map(({ name }) => name);

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
    definitions[name] = bundleReferences(rewriteInternalReferences(body, prefix));
    for (const [definitionName, definition] of Object.entries($defs)) {
      definitions[`${prefix}${definitionName}`] = bundleReferences(
        rewriteInternalReferences(definition, prefix),
      );
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
      } else if (
        key === '$ref' &&
        typeof item === 'string' &&
        item.startsWith('breakdown.workflow.v1#/$defs/')
      ) {
        embed('workflow', schemas.workflow, 'workflow_');
        bundled[key] = `#/$defs/workflow_${item.slice('breakdown.workflow.v1#/$defs/'.length)}`;
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
  const catalogOperation = mcpCatalog.operations.find(({ name }) => name === operation);
  if (catalogOperation === undefined) {
    throw new Error(`The MCP catalog is missing the ${operation} operation.`);
  }
  return {
    name: operation,
    description: catalogOperation.description,
    inputSchema: projectVariant(variant),
    annotations: {
      readOnlyHint: catalogOperation.read_only,
      destructiveHint: catalogOperation.destructive,
      idempotentHint: catalogOperation.idempotent,
      openWorldHint: catalogOperation.open_world,
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

const validatorOutput = execFileSync(process.execPath, [standalonePostprocessorPath], {
  input: standaloneCode(validator, validatorExports),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

await writeFile(
  outputPath,
  `// Generated from local/contracts/schemas/breakdown.operation-request.v1.schema.json and local/contracts/catalogs/mcp.v1.json.\nexport const MCP_RELEASE_VERSION = ${JSON.stringify(mcpCatalog.release_version)};\nexport const MCP_PROTOCOL_VERSIONS = ${JSON.stringify(mcpCatalog.protocol_versions)};\nexport const MCP_PREFERRED_PROTOCOL_VERSION = ${JSON.stringify(mcpCatalog.preferred_protocol_version)};\nexport const MCP_SERVER_INFO = ${JSON.stringify(mcpCatalog.server)};\nexport const OPERATION_NAMES = ${JSON.stringify(operationOrder)};\nexport const TOOL_CATALOG = ${JSON.stringify(tools, null, 2)};\n`,
  'utf8',
);
await writeFile(validatorOutputPath, `${validatorOutput}\n`, 'utf8');

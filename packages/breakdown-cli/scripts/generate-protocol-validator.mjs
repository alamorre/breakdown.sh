import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import standaloneCode from 'ajv/dist/standalone/index.js';

const schemaDirectory = new URL('../../../local/contracts/schemas/', import.meta.url);
const outputPath = new URL('../dist/protocol-validator.js', import.meta.url);
const standalonePostprocessorPath = fileURLToPath(
  new URL('../../../scripts/standalone-validator.mjs', import.meta.url),
);
const schemaNames = [
  'breakdown.workflow.v1.schema.json',
  'breakdown.work-packet.v1.schema.json',
  'breakdown.candidate.v1.schema.json',
  'breakdown.operation-request.v1.schema.json',
];

const validator = new Ajv2020({
  allErrors: true,
  code: { esm: true, lines: true, source: true },
  strict: true,
  strictRequired: false,
});

const schemas = [];
for (const schemaName of schemaNames) {
  const schema = JSON.parse(await readFile(new URL(schemaName, schemaDirectory), 'utf8'));
  schemas.push(schema);
  validator.addSchema(schema);
}

const requestSchema = schemas.at(-1);
const variantExports = {};
for (const variant of requestSchema.oneOf) {
  const operation = variant.properties.operation.const;
  const schemaId = `breakdown.operation-request.v1-${operation}`;
  validator.addSchema({
    $schema: requestSchema.$schema,
    $id: schemaId,
    ...variant,
    $defs: requestSchema.$defs,
  });
  variantExports[
    `validate${operation
      .split('_')
      .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
      .join('')}Request`
  ] = schemaId;
}

const output = execFileSync(process.execPath, [standalonePostprocessorPath], {
  input: standaloneCode(validator, {
    validateOperationRequest: 'breakdown.operation-request.v1',
    ...variantExports,
  }),
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});

await writeFile(outputPath, `${output}\n`, 'utf8');

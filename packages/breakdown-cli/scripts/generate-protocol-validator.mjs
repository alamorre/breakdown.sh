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

// Keep CLI presentation facts with their existing authored owners; no runtime filesystem lookup.
const catalog = JSON.parse(
  await readFile(new URL('../../../local/contracts/catalogs/cli.v1.json', import.meta.url), 'utf8'),
);
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const usage = `Usage:\n${[...catalog.human_commands, catalog.automation_command]
  .map((command) => `  ${command}\n`)
  .join('')}`;
await writeFile(
  new URL('../dist/cli-reference.js', import.meta.url),
  '// Generated from local/contracts/catalogs/cli.v1.json and packages/breakdown-cli/package.json.\n' +
    '// Regenerate: pnpm --filter @breakdown-sh/cli build\n' +
    `export const CLI_VERSION = ${JSON.stringify(manifest.version)};\n` +
    `export const CLI_USAGE = ${JSON.stringify(usage)};\n` +
    `export const CLI_EXIT_CODES = ${JSON.stringify(catalog.exit_codes)};\n` +
    `export const HUMAN_STDERR_LIMIT_BYTES = ${JSON.stringify(catalog.presentation.human_stderr_bytes)};\n`,
  'utf8',
);

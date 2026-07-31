#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const project = process.env.BREAKDOWN_QUALIFICATION_PROJECT;
const oracle = process.env.BREAKDOWN_QUALIFICATION_ORACLE;
const audit = process.env.BREAKDOWN_QUALIFICATION_AUTHOR_LOG;
if (![project, oracle, audit].every((value) => value !== undefined && isAbsolute(value))) {
  throw new Error('exact qualification author boundary is unavailable');
}
const bytes = await readFile(oracle);
const target = join(project, 'breakdown.yaml');
await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
const digest = createHash('sha256').update(bytes).digest('hex');
await appendFile(
  audit,
  `${JSON.stringify({ process: 'write-breakdown-oracle', target: 'breakdown.yaml', sha256: digest })}\n`,
  { mode: 0o600 },
);
process.stdout.write(`wrote byte-exact breakdown.yaml: ${digest}\n`);

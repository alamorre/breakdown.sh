#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

const project = process.env.BREAKDOWN_QUALIFICATION_PROJECT;
const relativePath = process.env.BREAKDOWN_QUALIFICATION_TERMINAL_RESULT;
const expectedDigest = process.env.BREAKDOWN_QUALIFICATION_TERMINAL_SHA256;
const audit = process.env.BREAKDOWN_QUALIFICATION_TERMINAL_LOG;
if (
  project === undefined ||
  !isAbsolute(project) ||
  relativePath === undefined ||
  relativePath.startsWith('/') ||
  relativePath
    .split('/')
    .some((segment) => segment === '' || segment === '.' || segment === '..') ||
  !/^[0-9a-f]{64}$/.test(expectedDigest ?? '') ||
  audit === undefined ||
  !isAbsolute(audit)
) {
  throw new Error('exact qualification Terminal Result boundary is unavailable');
}
const bytes = await readFile(join(project, relativePath));
const digest = createHash('sha256').update(bytes).digest('hex');
if (digest !== expectedDigest) throw new Error('selected Terminal Result digest mismatch');
await appendFile(
  audit,
  `${JSON.stringify({ process: 'read-terminal-result', path: relativePath, sha256: digest })}\n`,
  { mode: 0o600 },
);
process.stdout.write(bytes);

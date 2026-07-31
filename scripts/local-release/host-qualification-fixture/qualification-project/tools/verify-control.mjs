#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';

const expected = 'QUALIFICATION-CONTROL-v1\n';
const bytes = await readFile(new URL('../inputs/control.txt', import.meta.url));
if (bytes.toString('utf8') !== expected) {
  throw new Error('control fixture mismatch');
}
const digest = createHash('sha256').update(bytes).digest('hex');
const auditPath = process.env.BREAKDOWN_QUALIFICATION_CONTROL_LOG;
if (auditPath !== undefined) {
  await appendFile(
    auditPath,
    `${JSON.stringify({ process: 'verify-control', input_sha256: digest, exit_status: 0 })}\n`,
    { mode: 0o600 },
  );
}
process.stdout.write(`control fixture verified: ${digest}\n`);

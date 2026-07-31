#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const expected = 'QUALIFICATION-CONTROL-v1\n';
const bytes = await readFile(new URL('../inputs/control.txt', import.meta.url));
if (bytes.toString('utf8') !== expected) {
  throw new Error('control fixture mismatch');
}
process.stdout.write(
  `control fixture verified: ${createHash('sha256').update(bytes).digest('hex')}\n`,
);

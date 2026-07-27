import { rm, writeFile } from 'node:fs/promises';

import { operate } from '@breakdown-sh/core';

let inputBytes = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) inputBytes += chunk;
const input = JSON.parse(inputBytes);
const controller = new AbortController();
let replacementWritten = false;
const waitAtBoundary = async (boundary) => {
  if (
    !replacementWritten &&
    input.lockReplacement !== undefined &&
    boundary === input.lockReplacement.boundary
  ) {
    replacementWritten = true;
    if (input.lockReplacement.replaceFile !== false) {
      await rm(input.lockReplacement.path, { force: true });
    }
    await writeFile(input.lockReplacement.path, input.lockReplacement.contents, { mode: 0o600 });
  }
  if (boundary !== input.boundary) return;
  process.stdout.write(`boundary:${boundary}\n`);
  if (input.behavior === 'abort') {
    controller.abort();
    return;
  }
  await new Promise(() => {});
};
const testControls = {
  now: () => new Date(input.now),
  randomBytes: (size) => Buffer.alloc(size, input.entropyByte),
  onLockRecoveryBoundary: waitAtBoundary,
  ...(input.operation === 'create_run'
    ? { onRunPublicationBoundary: waitAtBoundary }
    : { onStepPublicationBoundary: waitAtBoundary }),
};

const result = await operate(input.request, {
  projectRoot: input.projectRoot,
  signal: controller.signal,
  testControls,
});
process.stdout.write(`result:${JSON.stringify(result)}\n`);

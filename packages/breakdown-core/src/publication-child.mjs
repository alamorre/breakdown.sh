import { operate } from '@breakdown-sh/core';

let inputBytes = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) inputBytes += chunk;
const input = JSON.parse(inputBytes);
const waitAtBoundary = async (boundary) => {
  if (boundary !== input.boundary) return;
  process.stdout.write(`boundary:${boundary}\n`);
  await new Promise(() => {});
};
const testControls = {
  now: () => new Date(input.now),
  randomBytes: (size) => Buffer.alloc(size, input.entropyByte),
  ...(input.operation === 'create_run'
    ? { onRunPublicationBoundary: waitAtBoundary }
    : { onStepPublicationBoundary: waitAtBoundary }),
};

const result = await operate(input.request, {
  projectRoot: input.projectRoot,
  testControls,
});
process.stdout.write(`result:${JSON.stringify(result)}\n`);

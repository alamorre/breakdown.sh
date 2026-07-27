import { execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { operate, type OperationResult, type SubmitCandidateValue } from './index.js';
import type { WorkPacket } from './prepare-work.js';
import type { StepPublicationBoundary, SuccessfulCandidateOutcome } from './submit-candidate.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const publicationChild = fileURLToPath(new URL('./publication-child.mjs', import.meta.url));
const temporaryProjects: string[] = [];
const fixedRunTime = '2026-07-27T20:00:00.000Z';
const fixedSubmissionTime = '2026-07-27T20:01:00.000Z';

function workflow(nodes: string) {
  return `schema_version: breakdown.workflow.v1
id: publication-safety
name: Publication Safety
nodes:
${nodes}
`;
}

async function createProject(nodes: string, entropyByte = 1) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-publication-'));
  temporaryProjects.push(projectRoot);
  await writeFile(join(projectRoot, 'breakdown.yaml'), workflow(nodes), 'utf8');
  const created = await operate(
    { operation: 'create_run' },
    {
      projectRoot,
      testControls: {
        now: () => new Date(fixedRunTime),
        randomBytes: (size) => seededBytes(entropyByte, size),
      },
    },
  );
  if (!created.ok) throw new Error(`Could not create race fixture: ${created.failure.code}`);
  return { projectRoot, runId: created.value.run_id };
}

async function prepare(projectRoot: string, runId: string, limit = 1) {
  const prepared = await operate(
    { operation: 'prepare_work', run_id: runId, limit },
    {
      projectRoot,
      testControls: { now: () => new Date('2026-07-27T20:00:30.000Z') },
    },
  );
  if (!prepared.ok) throw new Error(`Could not prepare race fixture: ${prepared.failure.code}`);
  return prepared.value.packets;
}

function successfulCandidate(packet: WorkPacket, markdown: string): SuccessfulCandidateOutcome {
  return {
    schema_version: 'breakdown.candidate.v1',
    submission: packet.submission,
    status: 'succeeded',
    executor: { kind: 'program', name: 'publication-safety-test' },
    markdown,
  };
}

function seededBytes(seed: number, size: number) {
  let state = (seed + 1) >>> 0;
  const bytes = Buffer.alloc(size);
  for (let index = 0; index < size; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

function submit(
  projectRoot: string,
  packet: WorkPacket,
  markdown: string,
  seed: number,
  onStepPublicationBoundary?: (boundary: StepPublicationBoundary) => void | Promise<void>,
) {
  return operate(
    {
      operation: 'submit_candidate',
      packet,
      candidate: successfulCandidate(packet, markdown),
    },
    {
      projectRoot,
      testControls: {
        now: () => new Date(fixedSubmissionTime),
        randomBytes: (size) => seededBytes(seed, size),
        onStepPublicationBoundary,
      },
    },
  );
}

function operationFacts(results: Array<OperationResult<SubmitCandidateValue>>) {
  return results.map((result) =>
    result.ok
      ? {
          ok: true,
          node_id: result.value.node_id,
          attempt: result.value.attempt,
        }
      : {
          ok: false,
          kind: result.failure.kind,
          code: result.failure.code,
        },
  );
}

function raceDiagnostics(
  seed: number,
  scheduledFirst: 'left' | 'right',
  initial: Array<OperationResult<SubmitCandidateValue>>,
  settled = initial,
) {
  return JSON.stringify({
    seed,
    scheduled_first: scheduledFirst,
    initial: operationFacts(initial),
    settled: operationFacts(settled),
  });
}

function holdWriterAfterLock() {
  let announceLock!: () => void;
  const lockAcquired = new Promise<void>((resolve) => {
    announceLock = resolve;
  });
  let releaseLock!: () => void;
  const keepLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  return {
    lockAcquired,
    releaseLock,
    onStepPublicationBoundary: async (boundary: StepPublicationBoundary) => {
      if (boundary !== 'after_lock_acquired') return;
      announceLock();
      await keepLock;
    },
  };
}

async function waitForSeededLock(lockAcquired: Promise<void>, seed: number) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      lockAcquired,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Seed ${seed} did not acquire its scheduled writer lock.`)),
          5_000,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function runSeededCases(count: number, execute: (seed: number) => Promise<void>) {
  for (let batchStart = 0; batchStart < count; batchStart += 10) {
    await Promise.all(
      Array.from({ length: Math.min(10, count - batchStart) }, (_unused, offset) =>
        execute(batchStart + offset),
      ),
    );
  }
}

interface ChildInput {
  operation: 'create_run' | 'submit_candidate';
  projectRoot: string;
  boundary: string;
  now: string;
  entropyByte: number;
  request: unknown;
}

function killAtPublicationBoundary(input: ChildInput) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [publicationChild], {
      cwd: packageRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(
        new Error(
          `Publication child did not reach ${input.boundary}. stdout=${stdout} stderr=${stderr}`,
        ),
      );
    }, 10_000);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
      if (settled || !stdout.includes(`boundary:${input.boundary}\n`)) return;
      settled = true;
      child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', () => {
      clearTimeout(timeout);
      if (!settled) {
        reject(
          new Error(
            `Publication child exited before ${input.boundary}. stdout=${stdout} stderr=${stderr}`,
          ),
        );
        return;
      }
      resolve();
    });
    child.stdin.end(JSON.stringify(input));
  });
}

beforeAll(async () => {
  const tscPath = require.resolve('typescript/bin/tsc');
  await execFileAsync(process.execPath, [
    tscPath,
    '-p',
    fileURLToPath(new URL('../tsconfig.build.json', import.meta.url)),
  ]);
});

afterAll(async () => {
  await Promise.all(
    temporaryProjects.map((projectRoot) => rm(projectRoot, { recursive: true, force: true })),
  );
});

describe('operate', () => {
  it('should make process termination before and after a Run commit unambiguous', async () => {
    for (const [boundary, committed] of [
      ['before_publish', false],
      ['after_publish', true],
    ] as const) {
      const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-run-crash-'));
      temporaryProjects.push(projectRoot);
      await writeFile(
        join(projectRoot, 'breakdown.yaml'),
        workflow(`  - id: execute
    name: Execute
    prompt: Execute once.`),
        'utf8',
      );
      await mkdir(join(projectRoot, 'outputs'));

      await killAtPublicationBoundary({
        operation: 'create_run',
        projectRoot,
        boundary,
        now: fixedRunTime,
        entropyByte: 0,
        request: { operation: 'create_run' },
      });

      const runId = '20260727T200000.000Z--publication-safety--aaaaaaaaaaaa';
      const visibleRuns = await readdir(join(projectRoot, 'outputs'));
      expect(visibleRuns, boundary).toEqual(committed ? [runId] : []);
      if (committed) {
        expect(await readdir(join(projectRoot, 'outputs', runId))).toEqual([
          'breakdown.yaml',
          'run.md',
          'steps',
        ]);
        expect(
          await operate({ operation: 'inspect_run', run_id: runId }, { projectRoot }),
        ).toMatchObject({
          ok: true,
          value: {
            lock: { lock_id: '0000000000000000' },
            attempts: [],
          },
        });
      }
    }
  }, 30_000);

  it('should let inspection settle a lost submission response without replay', async () => {
    for (const [boundary, committed] of [
      ['before_commit', false],
      ['after_commit', true],
    ] as const) {
      const { projectRoot, runId } = await createProject(`  - id: execute
    name: Execute
    prompt: Execute once.`);
      const packet = (await prepare(projectRoot, runId))[0]!;
      const request = {
        operation: 'submit_candidate' as const,
        packet,
        candidate: successfulCandidate(packet, `candidate killed at ${boundary}`),
      };

      await killAtPublicationBoundary({
        operation: 'submit_candidate',
        projectRoot,
        boundary,
        now: fixedSubmissionTime,
        entropyByte: 10,
        request,
      });

      const inspected = await operate({ operation: 'inspect_run', run_id: runId }, { projectRoot });
      expect(inspected, boundary).toMatchObject({
        ok: true,
        value: {
          lock: { lock_id: '0a0a0a0a0a0a0a0a' },
          attempts: committed ? [{ node_id: 'execute', attempt: 1, status: 'succeeded' }] : [],
          nodes: [
            committed
              ? { node_id: 'execute', state: 'complete', next_attempt: 2 }
              : { node_id: 'execute', state: 'runnable', next_attempt: 1 },
          ],
        },
      });
    }
  }, 30_000);

  it('should elect one winner in 100 seeded same-opportunity races', async () => {
    await runSeededCases(100, async (seed) => {
      const { projectRoot, runId } = await createProject(
        `  - id: execute
    name: Execute
    prompt: Execute once.`,
        seed + 1,
      );
      const packet = (await prepare(projectRoot, runId))[0]!;
      const scheduledFirst = seed % 2 === 0 ? 'left' : 'right';
      const scheduledSecond = scheduledFirst === 'left' ? 'right' : 'left';
      const heldWriter = holdWriterAfterLock();
      const firstSubmission = submit(
        projectRoot,
        packet,
        `${scheduledFirst}-${seed}`,
        seed * 2 + (scheduledFirst === 'left' ? 1 : 2),
        heldWriter.onStepPublicationBoundary,
      );
      await waitForSeededLock(heldWriter.lockAcquired, seed);
      let secondResult: OperationResult<SubmitCandidateValue>;
      try {
        secondResult = await submit(
          projectRoot,
          packet,
          `${scheduledSecond}-${seed}`,
          seed * 2 + (scheduledSecond === 'left' ? 1 : 2),
        );
      } finally {
        heldWriter.releaseLock();
      }
      const firstResult = await firstSubmission;
      const results =
        scheduledFirst === 'left' ? [firstResult, secondResult] : [secondResult, firstResult];
      const diagnostics = raceDiagnostics(seed, scheduledFirst, results);
      const successes = results.filter((result) => result.ok);
      const conflicts = results.filter((result) => !result.ok);

      expect(successes, diagnostics).toHaveLength(1);
      expect(conflicts, diagnostics).toHaveLength(1);
      expect(conflicts[0], diagnostics).toMatchObject({
        ok: false,
        failure: {
          kind: 'conflict',
          code: 'run_locked',
        },
      });
      const winningMarkdown = `${scheduledFirst}-${seed}`;
      const winningResult = results.find((result) => result.ok);
      if (
        winningResult === undefined ||
        !winningResult.ok ||
        winningResult.value.status !== 'succeeded'
      ) {
        throw new Error(diagnostics);
      }
      expect(
        await readFile(join(projectRoot, winningResult.value.result.markdown.path), 'utf8'),
        diagnostics,
      ).toMatch(new RegExp(`\\n---\\n${winningMarkdown}$`));
      const inspected = await operate({ operation: 'inspect_run', run_id: runId }, { projectRoot });
      expect(inspected, diagnostics).toMatchObject({
        ok: true,
        value: {
          attempts: [{ node_id: 'execute', attempt: 1, status: 'succeeded' }],
          nodes: [{ node_id: 'execute', state: 'complete', next_attempt: 2 }],
        },
      });
    });
  }, 120_000);

  it('should retain both valid Results in 100 seeded independent-submission races', async () => {
    await runSeededCases(100, async (seed) => {
      const { projectRoot, runId } = await createProject(
        `  - id: left
    name: Left
    prompt: Produce the left Result.
  - id: right
    name: Right
    prompt: Produce the right Result.`,
        seed + 101,
      );
      const packets = await prepare(projectRoot, runId, 2);
      const scheduledFirstIndex = seed % 2;
      const scheduledSecondIndex = scheduledFirstIndex === 0 ? 1 : 0;
      const scheduledFirst = scheduledFirstIndex === 0 ? 'left' : 'right';
      const heldWriter = holdWriterAfterLock();
      const firstSubmission = submit(
        projectRoot,
        packets[scheduledFirstIndex]!,
        `${scheduledFirst}-${seed}`,
        seed * 2 + 201 + scheduledFirstIndex,
        heldWriter.onStepPublicationBoundary,
      );
      await waitForSeededLock(heldWriter.lockAcquired, seed);
      let contendedResult: OperationResult<SubmitCandidateValue>;
      try {
        contendedResult = await submit(
          projectRoot,
          packets[scheduledSecondIndex]!,
          `${scheduledSecondIndex === 0 ? 'left' : 'right'}-${seed}`,
          seed * 2 + 201 + scheduledSecondIndex,
        );
      } finally {
        heldWriter.releaseLock();
      }
      const firstResult = await firstSubmission;
      const initial =
        scheduledFirstIndex === 0 ? [firstResult, contendedResult] : [contendedResult, firstResult];
      const settled = [...initial];
      for (const [index, result] of initial.entries()) {
        if (result.ok) continue;
        expect(result, raceDiagnostics(seed, scheduledFirst, initial)).toMatchObject({
          ok: false,
          failure: { kind: 'conflict', code: 'run_locked' },
        });
        settled[index] = await submit(
          projectRoot,
          packets[index]!,
          `${index === 0 ? 'left' : 'right'}-${seed}`,
          seed * 2 + 301 + index,
        );
      }
      const diagnostics = raceDiagnostics(seed, scheduledFirst, initial, settled);
      expect(
        settled.every((result) => result.ok),
        diagnostics,
      ).toBe(true);

      const inspected = await operate({ operation: 'inspect_run', run_id: runId }, { projectRoot });
      expect(inspected, diagnostics).toMatchObject({
        ok: true,
        value: {
          status: 'complete',
          attempts: [
            { node_id: 'left', attempt: 1, status: 'succeeded' },
            { node_id: 'right', attempt: 1, status: 'succeeded' },
          ],
          terminal_results: [
            { node_id: 'left', attempt: 1 },
            { node_id: 'right', attempt: 1 },
          ],
        },
      });
    });
  }, 120_000);

  it('should inject deterministic faults at every StepArtifact publication boundary', async () => {
    const boundaries = [
      'after_lock_acquired',
      'after_staging_written',
      'before_commit',
      'after_commit_visible',
      'after_commit',
    ] as const;

    for (const [index, boundaryToFail] of boundaries.entries()) {
      const { projectRoot, runId } = await createProject(`  - id: execute
    name: Execute
    prompt: Execute once.`);
      const packet = (await prepare(projectRoot, runId))[0]!;
      const submitted = await operate(
        {
          operation: 'submit_candidate',
          packet,
          candidate: successfulCandidate(packet, boundaryToFail),
        },
        {
          projectRoot,
          testControls: {
            now: () => new Date(fixedSubmissionTime),
            randomBytes: (size) => Buffer.alloc(size, index + 1),
            onStepPublicationBoundary: (boundary) => {
              if (boundary === boundaryToFail) {
                throw new Error(`Injected ${boundary} failure.`);
              }
            },
          },
        },
      );
      const committed =
        boundaryToFail === 'after_commit_visible' || boundaryToFail === 'after_commit';
      expect(submitted, boundaryToFail).toMatchObject(
        committed
          ? {
              ok: true,
              value: {
                attempt: 1,
                settled_at: fixedSubmissionTime,
              },
            }
          : { ok: false, failure: { kind: 'io', code: 'io_error' } },
      );
      const inspected = await operate({ operation: 'inspect_run', run_id: runId }, { projectRoot });
      expect(inspected, boundaryToFail).toMatchObject({
        ok: true,
        value: {
          lock: null,
          attempts: committed ? [{ node_id: 'execute', attempt: 1 }] : [],
        },
      });
      const stepEntries = await readdir(join(projectRoot, 'outputs', runId, 'steps'));
      expect(stepEntries, boundaryToFail).toHaveLength(committed ? 1 : 0);
      if (committed) {
        expect(
          await readFile(join(projectRoot, 'outputs', runId, 'steps', stepEntries[0]!), 'utf8'),
          boundaryToFail,
        ).toContain(`\n---\n${boundaryToFail}`);
      }
    }
  });
});

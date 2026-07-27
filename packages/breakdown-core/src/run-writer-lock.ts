import { lstat, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ensurePrivateDirectoryPath,
  publishPrivateFileNoReplace,
  syncDirectory,
  writePrivateFile,
} from './secure-store.js';

export class RunLockedError extends Error {}

export interface RunWriterLock {
  directory: string;
  path: string;
}

interface RunWriterLockDependencies {
  now(): Date;
  randomBytes(size: number): Uint8Array;
}

function randomHex(dependencies: RunWriterLockDependencies) {
  const bytes = Buffer.from(dependencies.randomBytes(8));
  if (bytes.byteLength !== 8) {
    throw new Error('Cryptographic entropy did not provide enough bytes for a Run lock.');
  }
  return bytes.toString('hex');
}

async function finalLockExists(lockPath: string) {
  try {
    await lstat(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function acquireRunWriterLock(
  projectRoot: string,
  runId: string,
  dependencies: RunWriterLockDependencies,
): Promise<RunWriterLock> {
  const directory = await ensurePrivateDirectoryPath(projectRoot, ['.breakdown', 'locks', 'runs']);
  const lockId = randomHex(dependencies);
  const stagingToken = randomHex(dependencies);
  const path = join(directory, `${runId}.lock`);
  const stagingPath = join(directory, `.acquire-${stagingToken}.lock.tmp`);
  const bytes = Buffer.from(
    JSON.stringify({
      lock_id: lockId,
      run_id: runId,
      created_at: dependencies.now().toISOString(),
      process_id: process.pid,
    }),
    'utf8',
  );

  try {
    await writePrivateFile(stagingPath, bytes);
    await publishPrivateFileNoReplace(stagingPath, path, () => syncDirectory(directory));
    await syncDirectory(directory);
    return { directory, path };
  } catch (error) {
    await rm(stagingPath, { force: true });
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' && (await finalLockExists(path))) {
      throw new RunLockedError('Another writer currently holds the Run lock.');
    }
    throw error;
  }
}

export async function releaseRunWriterLock(lock: RunWriterLock) {
  await unlink(lock.path);
  await syncDirectory(lock.directory);
}

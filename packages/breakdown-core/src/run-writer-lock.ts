import { createHash, randomBytes as cryptographicRandomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, readdir, rename, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import {
  isRunLockQuarantineAlias,
  isRunLockQuarantineForIdentity,
  runLockQuarantinePath,
  runLockRecoveryIdentity,
  runLockRecoveryPath,
} from './run-lock-paths.js';
import {
  assertSecureDirectoryIdentity,
  ensurePrivateDirectoryPath,
  publishPrivateFileNoReplace,
  readSecureDirectory,
  sameSecureFileIdentity,
  secureFileIdentity,
  type SecureFileIdentity,
  type SelectedProjectRoot,
  syncDirectory,
  writePrivateFile,
} from './secure-store.js';

export class RunLockedError extends Error {}
export class LockRecoveryMismatchError extends Error {}
class LockRecoveryContendedError extends LockRecoveryMismatchError {}
class LockRecoveryQuarantinedError extends Error {}

export interface RunWriterLock {
  projectRoot: SelectedProjectRoot;
  directory: string;
  path: string;
  lockId: string;
  identity: SecureFileIdentity;
  digest: string;
}

export interface LockRecoveryIntent {
  lock_id: string;
  confirmed_stopped: true;
}

export type LockRecoveryBoundary =
  | 'after_lock_observed'
  | 'after_recovery_alias_linked'
  | 'after_recovery_claimed'
  | 'after_lock_quarantined'
  | 'after_writer_lock_published';

interface RunWriterLockDependencies {
  now(): Date;
  randomBytes(size: number): Uint8Array;
  onLockRecoveryBoundary?: (boundary: LockRecoveryBoundary) => void | Promise<void>;
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

interface ObservedLock {
  lockId: string;
  identity: SecureFileIdentity;
  digest: string;
}

interface ObservedRecoveryClaim {
  path: string;
  lock: ObservedLock;
  identityToken: string;
  matchesIntent: boolean;
}

async function observeLockFile(path: string): Promise<ObservedLock> {
  const pathFacts = await lstat(path, { bigint: true });
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedFacts = await handle.stat({ bigint: true });
    if (
      pathFacts.isSymbolicLink() ||
      !pathFacts.isFile() ||
      !openedFacts.isFile() ||
      pathFacts.dev !== openedFacts.dev ||
      pathFacts.ino !== openedFacts.ino ||
      openedFacts.size > 65_536n
    ) {
      throw new LockRecoveryMismatchError('The observed Run lock is not recoverable.');
    }
    const bytes = await handle.readFile();
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as { lock_id?: unknown }).lock_id !== 'string'
    ) {
      throw new LockRecoveryMismatchError('The observed Run lock is not recoverable.');
    }
    return {
      lockId: (value as { lock_id: string }).lock_id,
      identity: secureFileIdentity(openedFacts),
      digest: createHash('sha256').update(bytes).digest('hex'),
    };
  } catch (error) {
    if (error instanceof LockRecoveryMismatchError) throw error;
    throw new LockRecoveryMismatchError('The observed Run lock is not recoverable.');
  } finally {
    await handle.close();
  }
}

function sameLock(left: ObservedLock, right: ObservedLock) {
  return (
    left.lockId === right.lockId &&
    sameSecureFileIdentity(left.identity, right.identity) &&
    left.digest === right.digest
  );
}

function lockMatchesOwnership(lock: RunWriterLock, observed: ObservedLock) {
  return (
    observed.lockId === lock.lockId &&
    sameSecureFileIdentity(observed.identity, lock.identity) &&
    observed.digest === lock.digest
  );
}

function lockIdentityToken(lock: ObservedLock) {
  return createHash('sha256')
    .update(
      `${lock.identity.device}:${lock.identity.inode}:${lock.identity.birthtime}:${lock.lockId}:${lock.digest}`,
    )
    .digest('hex')
    .slice(0, 16);
}

async function recoveryClaimPaths(directory: string, lockPath: string) {
  return (await readdir(directory)).sort().flatMap((entry) => {
    const identityToken = runLockRecoveryIdentity(lockPath, entry);
    return identityToken === undefined ? [] : [{ path: join(directory, entry), identityToken }];
  });
}

async function cleanupRecoveryClaimsAndCheckBlocked(directory: string, lockPath: string) {
  const claims = await recoveryClaimPaths(directory, lockPath);
  if (claims.length === 0) return false;
  let main: ObservedLock | undefined;
  try {
    main = await observeLockFile(lockPath);
  } catch {
    // A missing or unreadable main lock cannot make a recovery claim ignorable.
  }
  for (const claim of claims) {
    try {
      const observed = await observeLockFile(claim.path);
      if (lockIdentityToken(observed) === claim.identityToken) return true;
      if (main !== undefined && sameLock(observed, main)) continue;
      if (
        (await readdir(directory)).some((entry) =>
          isRunLockQuarantineForIdentity(entry, claim.identityToken),
        )
      ) {
        return true;
      }
      try {
        await unlink(claim.path);
        await syncDirectory(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return true;
      }
    } catch {
      return true;
    }
  }
  return false;
}

async function findRecoveryClaim(
  directory: string,
  lockPath: string,
  lockId: string,
): Promise<ObservedRecoveryClaim | undefined> {
  const observedClaims: ObservedRecoveryClaim[] = [];
  for (const claim of await recoveryClaimPaths(directory, lockPath)) {
    try {
      const lock = await observeLockFile(claim.path);
      observedClaims.push({
        ...claim,
        lock,
        matchesIntent: lock.lockId === lockId && lockIdentityToken(lock) === claim.identityToken,
      });
    } catch {
      // An unreadable recovery claim cannot authorize recovery.
    }
  }
  const matches = observedClaims.filter((claim) => claim.matchesIntent);
  if (matches.length === 1) return matches[0];
  return observedClaims.length === 1 ? observedClaims[0] : undefined;
}

async function restoreQuarantinedLock(quarantinePath: string, lockPath: string): Promise<boolean> {
  try {
    await link(quarantinePath, lockPath);
    await unlink(quarantinePath);
    return true;
  } catch {
    // Preserve the moved lock when its original name cannot be restored safely.
    return false;
  }
}

async function restoreCreatedLockFromQuarantine(
  directory: string,
  lockPath: string,
  lockId: string,
  digest: string,
): Promise<void> {
  const matches: string[] = [];
  for (const entry of await readdir(directory)) {
    if (!isRunLockQuarantineAlias(entry)) continue;
    const quarantinePath = join(directory, entry);
    try {
      const observed = await observeLockFile(quarantinePath);
      if (observed.lockId === lockId && observed.digest === digest) {
        matches.push(quarantinePath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (matches.length === 1) await restoreQuarantinedLock(matches[0]!, lockPath);
}

async function observedQuarantines(
  directory: string,
  identityToken: string,
): Promise<Array<{ path: string; lock: ObservedLock }>> {
  const quarantines: Array<{ path: string; lock: ObservedLock }> = [];
  for (const entry of await readdir(directory)) {
    if (!isRunLockQuarantineForIdentity(entry, identityToken)) continue;
    const quarantinePath = join(directory, entry);
    try {
      quarantines.push({ path: quarantinePath, lock: await observeLockFile(quarantinePath) });
    } catch (error) {
      if (
        !(error instanceof LockRecoveryMismatchError) &&
        (error as NodeJS.ErrnoException).code !== 'ENOENT'
      ) {
        throw error;
      }
    }
  }
  return quarantines;
}

async function removeExactQuarantines(directory: string, identityToken: string): Promise<void> {
  for (const quarantined of await observedQuarantines(directory, identityToken)) {
    if (lockIdentityToken(quarantined.lock) === identityToken) {
      await unlink(quarantined.path);
    }
  }
}

async function removeRecoveryClaim(
  directory: string,
  claimedPath: string,
  identityToken: string,
): Promise<void> {
  await removeExactQuarantines(directory, identityToken);
  await unlink(claimedPath);
  await syncDirectory(directory);
}

async function moveExactLockOutOfService(
  directory: string,
  lockPath: string,
  claimed: ObservedLock,
  randomBytes: (size: number) => Uint8Array,
  onBoundary?: (boundary: LockRecoveryBoundary) => void | Promise<void>,
) {
  const removalToken = Buffer.from(randomBytes(8));
  if (removalToken.byteLength !== 8) {
    throw new Error('Cryptographic entropy did not provide enough bytes for lock recovery.');
  }
  const quarantinePath = runLockQuarantinePath(
    directory,
    lockIdentityToken(claimed),
    removalToken.toString('hex'),
  );
  await writePrivateFile(quarantinePath, Buffer.alloc(0));
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    await rm(quarantinePath, { force: true });
    throw error;
  }
  try {
    await onBoundary?.('after_lock_quarantined');
  } catch {
    throw new LockRecoveryQuarantinedError(
      'Lock recovery stopped after moving the exact lock out of service.',
    );
  }

  let moved: ObservedLock;
  try {
    moved = await observeLockFile(quarantinePath);
  } catch {
    await restoreQuarantinedLock(quarantinePath, lockPath);
    throw mismatch();
  }
  if (!sameLock(moved, claimed)) {
    await restoreQuarantinedLock(quarantinePath, lockPath);
    throw mismatch();
  }
  await unlink(quarantinePath);
}

function mismatch(): LockRecoveryMismatchError {
  return new LockRecoveryMismatchError('The observed Run lock changed or is missing.');
}

export async function recoverRunWriterLock(
  selectedProjectRoot: SelectedProjectRoot,
  runId: string,
  intent: unknown,
  dependencies: Pick<RunWriterLockDependencies, 'onLockRecoveryBoundary' | 'randomBytes'>,
): Promise<void> {
  const projectRoot = selectedProjectRoot.path;
  if (
    typeof intent !== 'object' ||
    intent === null ||
    Array.isArray(intent) ||
    (intent as { confirmed_stopped?: unknown }).confirmed_stopped !== true ||
    typeof (intent as { lock_id?: unknown }).lock_id !== 'string' ||
    (intent as { lock_id: string }).lock_id.length === 0
  ) {
    throw mismatch();
  }
  const lockId = (intent as LockRecoveryIntent).lock_id;

  const directory = await ensurePrivateDirectoryPath(projectRoot, ['.breakdown', 'locks', 'runs'], {
    expectedProjectIdentity: selectedProjectRoot.identity,
  });
  const path = join(directory, `${runId}.lock`);
  let claimedPath: string;
  let createdClaimPath: string | undefined;
  let observedMain = false;
  try {
    let claimed: ObservedLock;
    let claimedIdentityToken: string;
    let claimMatchesIntent: boolean;
    let observed: ObservedLock | undefined;
    try {
      observed = await observeLockFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    if (observed?.lockId === lockId) {
      observedMain = true;
      claimedIdentityToken = lockIdentityToken(observed);
      claimMatchesIntent = true;
      await dependencies.onLockRecoveryBoundary?.('after_lock_observed');
      claimedPath = runLockRecoveryPath(path, claimedIdentityToken);
      try {
        await link(path, claimedPath);
        createdClaimPath = claimedPath;
        await dependencies.onLockRecoveryBoundary?.('after_recovery_alias_linked');
        const created = await observeLockFile(claimedPath);
        if (!sameLock(created, observed)) throw mismatch();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
          throw error;
        }
      }
      claimed = await observeLockFile(claimedPath);
      if (!sameLock(claimed, observed)) throw mismatch();
    } else {
      const existingClaim = await findRecoveryClaim(directory, path, lockId);
      if (existingClaim === undefined) throw mismatch();
      claimedPath = existingClaim.path;
      claimed = existingClaim.lock;
      claimedIdentityToken = existingClaim.identityToken;
      claimMatchesIntent = existingClaim.matchesIntent;
      await dependencies.onLockRecoveryBoundary?.('after_lock_observed');
    }

    await dependencies.onLockRecoveryBoundary?.('after_recovery_claimed');

    if (!claimMatchesIntent) {
      if (await finalLockExists(path)) throw mismatch();
      const quarantines = await observedQuarantines(directory, claimedIdentityToken);
      const restorablePath =
        quarantines.length === 1
          ? quarantines[0]!.path
          : quarantines.length === 0
            ? claimedPath
            : undefined;
      if (restorablePath !== undefined && (await restoreQuarantinedLock(restorablePath, path))) {
        if (restorablePath !== claimedPath) await unlink(claimedPath);
        await syncDirectory(directory);
      }
      throw mismatch();
    }

    if (observedMain) {
      try {
        await moveExactLockOutOfService(
          directory,
          path,
          claimed,
          dependencies.randomBytes ?? cryptographicRandomBytes,
          dependencies.onLockRecoveryBoundary,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new LockRecoveryContendedError(
            'Another recovery moved the claimed Run lock first.',
          );
        }
        throw error;
      }
      if (await finalLockExists(path)) throw mismatch();
    } else {
      const quarantines = await observedQuarantines(directory, claimedIdentityToken);
      const changedQuarantines = quarantines.filter(
        (quarantined) => lockIdentityToken(quarantined.lock) !== claimedIdentityToken,
      );
      if (await finalLockExists(path)) {
        await removeRecoveryClaim(directory, claimedPath, claimedIdentityToken);
        throw mismatch();
      }
      if (changedQuarantines.length > 0) {
        if (
          changedQuarantines.length === 1 &&
          (await restoreQuarantinedLock(changedQuarantines[0]!.path, path))
        ) {
          await removeRecoveryClaim(directory, claimedPath, claimedIdentityToken);
        }
        throw mismatch();
      }
    }

    try {
      await removeRecoveryClaim(directory, claimedPath, claimedIdentityToken);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw mismatch();
      throw error;
    }
  } catch (error) {
    if (
      createdClaimPath !== undefined &&
      !(error instanceof LockRecoveryContendedError) &&
      !(error instanceof LockRecoveryQuarantinedError)
    ) {
      try {
        await unlink(createdClaimPath);
        await syncDirectory(directory);
      } catch {
        // Another recovery may already have completed the exact identity-specific claim.
      }
    }
    if (
      error instanceof LockRecoveryMismatchError ||
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      throw mismatch();
    }
    throw error;
  }
}

export async function acquireRunWriterLock(
  selectedProjectRoot: SelectedProjectRoot,
  runId: string,
  dependencies: RunWriterLockDependencies,
): Promise<RunWriterLock> {
  const projectRoot = selectedProjectRoot.path;
  const directory = await ensurePrivateDirectoryPath(projectRoot, ['.breakdown', 'locks', 'runs'], {
    expectedProjectIdentity: selectedProjectRoot.identity,
  });
  const directoryIdentity = (
    await readSecureDirectory(projectRoot, '.breakdown/locks/runs', Number.MAX_SAFE_INTEGER, {
      expectedProjectIdentity: selectedProjectRoot.identity,
    })
  ).identity;
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
  const digest = createHash('sha256').update(bytes).digest('hex');

  try {
    if (await cleanupRecoveryClaimsAndCheckBlocked(directory, path)) {
      throw new RunLockedError('A Run lock recovery is in progress.');
    }
    await writePrivateFile(stagingPath, bytes);
    if (await cleanupRecoveryClaimsAndCheckBlocked(directory, path)) {
      throw new RunLockedError('A Run lock recovery is in progress.');
    }
    await publishPrivateFileNoReplace(stagingPath, path, {
      afterDestinationVisible: async () => {
        await syncDirectory(directory);
        await dependencies.onLockRecoveryBoundary?.('after_writer_lock_published');
      },
      assertDestinationParent: () => assertSecureDirectoryIdentity(directory, directoryIdentity),
    });
    if (await cleanupRecoveryClaimsAndCheckBlocked(directory, path)) {
      const current = await observeLockFile(path);
      if (current.lockId === lockId) await unlink(path);
      throw new RunLockedError('A Run lock recovery is in progress.');
    }
    await syncDirectory(directory);
    let observed: ObservedLock;
    try {
      observed = await observeLockFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await restoreCreatedLockFromQuarantine(directory, path, lockId, digest);
      observed = await observeLockFile(path);
    }
    if (observed.lockId !== lockId || observed.digest !== digest) {
      throw new RunLockedError('The created Run lock identity changed.');
    }
    return {
      projectRoot: selectedProjectRoot,
      directory,
      path,
      lockId,
      identity: observed.identity,
      digest: observed.digest,
    };
  } catch (error) {
    await rm(stagingPath, { force: true });
    if (error instanceof RunLockedError) throw error;
    if ((error as NodeJS.ErrnoException).code === 'EEXIST' && (await finalLockExists(path))) {
      throw new RunLockedError('Another writer currently holds the Run lock.');
    }
    throw error;
  }
}

export async function assertRunWriterLock(lock: RunWriterLock): Promise<void> {
  await readSecureDirectory(
    lock.projectRoot.path,
    '.breakdown/locks/runs',
    Number.MAX_SAFE_INTEGER,
    {
      expectedProjectIdentity: lock.projectRoot.identity,
    },
  );
  const directory = join(lock.projectRoot.path, '.breakdown', 'locks', 'runs');
  if (directory !== lock.directory) {
    throw new Error('The Run writer-lock directory changed.');
  }
  const current = await observeLockFile(lock.path);
  if (!lockMatchesOwnership(lock, current)) {
    throw new Error('The Run writer lock changed.');
  }
}

export async function releaseRunWriterLock(
  lock: RunWriterLock,
  assertProjectRoot?: () => void | Promise<void>,
): Promise<void> {
  await assertProjectRoot?.();
  try {
    await assertRunWriterLock(lock);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  await unlink(lock.path);
  await syncDirectory(lock.directory);
}

import { basename, join } from 'node:path';

const RECOVERY_SUFFIX = '.recovering';
const QUARANTINE_PATTERN = /^\.recover-remove-([0-9a-f]{16})-[0-9a-f]{16}\.lock\.tmp$/;

export function runLockRecoveryPath(lockPath: string, identityToken: string): string {
  return `${lockPath}${RECOVERY_SUFFIX}-${identityToken}`;
}

export function isRunLockRecoveryAlias(lockPath: string, entry: string): boolean {
  return runLockRecoveryIdentity(lockPath, entry) !== undefined;
}

export function runLockRecoveryIdentity(lockPath: string, entry: string): string | undefined {
  const prefix = `${basename(lockPath)}${RECOVERY_SUFFIX}-`;
  if (!entry.startsWith(prefix)) return undefined;
  const identityToken = entry.slice(prefix.length);
  return /^[0-9a-f]{16}$/.test(identityToken) ? identityToken : undefined;
}

export function isRunLockQuarantineAlias(entry: string): boolean {
  return QUARANTINE_PATTERN.test(entry);
}

export function isRunLockQuarantineForIdentity(entry: string, identityToken: string): boolean {
  return QUARANTINE_PATTERN.exec(entry)?.[1] === identityToken;
}

export function runLockQuarantinePath(
  directory: string,
  identityToken: string,
  removalToken: string,
): string {
  return join(directory, `.recover-remove-${identityToken}-${removalToken}.lock.tmp`);
}

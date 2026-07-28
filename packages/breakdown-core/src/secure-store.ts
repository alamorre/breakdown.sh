import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, statfs, unlink } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import { isRunLockQuarantineAlias, isRunLockRecoveryAlias } from './run-lock-paths.js';

export class ResourceLimitError extends Error {}
export class SecureDirectoryChangedError extends Error {}
export class UnsupportedFilesystemError extends Error {}

export interface SecureFileIdentity {
  device: string;
  inode: string;
  birthtime: string;
}

export interface SelectedProjectRoot {
  path: string;
  identity: SecureFileIdentity;
}

export interface SecureDirectorySnapshot {
  path: string;
  identity: SecureFileIdentity;
  mtime: string;
  ctime: string;
  entriesByCanonicalName: ReadonlyMap<string, readonly string[]>;
}

export function secureFileIdentity(facts: {
  dev: bigint;
  ino: bigint;
  birthtimeNs: bigint;
}): SecureFileIdentity {
  return {
    device: facts.dev.toString(),
    inode: facts.ino.toString(),
    birthtime: facts.birthtimeNs.toString(),
  };
}

export function sameSecureFileIdentity(
  left: SecureFileIdentity,
  right: SecureFileIdentity,
): boolean {
  return (
    left.device === right.device && left.inode === right.inode && left.birthtime === right.birthtime
  );
}

export interface SecureReadOptions {
  allowPublicationStagingAlias?: boolean;
  expectedParentSnapshot?: SecureDirectorySnapshot;
  expectedProjectIdentity?: SecureFileIdentity;
}

export interface SecureDirectoryOptions {
  expectedProjectIdentity?: SecureFileIdentity;
}

interface LinuxMount {
  id: string;
  path: string;
  type: string;
}

const UNSUPPORTED_FILESYSTEM_TYPES = new Set([
  0x6969n, // NFS
  0x517bn, // SMB
  0xff534d42n, // CIFS
  0x73757245n, // Coda
  0x5346414fn, // AFS
  0x01021997n, // 9P
  0x00c36400n, // Ceph
  0x65735546n, // FUSE
]);

const SUPPORTED_DARWIN_FILESYSTEM_TYPES = new Set([
  25n, // HFS
  26n, // APFS
]);

const SUPPORTED_LINUX_FILESYSTEM_TYPES = new Set([
  0xef53n, // ext2/ext3/ext4
  0x58465342n, // XFS
  0x9123683en, // Btrfs
  0x01021994n, // tmpfs
  0x794c7630n, // OverlayFS
  0x2fc12fc1n, // ZFS
  0xf2f52010n, // F2FS
]);

const UNSUPPORTED_MOUNT_TYPES = new Set([
  '9p',
  'afs',
  'ceph',
  'cifs',
  'davfs',
  'davfs2',
  'gfs',
  'gfs2',
  'glusterfs',
  'nfs',
  'nfs4',
  'smb3',
  'sshfs',
]);

function unescapeLinuxMountPath(value: string) {
  return value
    .replaceAll('\\040', ' ')
    .replaceAll('\\011', '\t')
    .replaceAll('\\012', '\n')
    .replaceAll('\\134', '\\');
}

async function readLinuxMounts() {
  let mountInfo: string;
  try {
    mountInfo = await readFile('/proc/self/mountinfo', 'utf8');
  } catch {
    return undefined;
  }
  const mounts: LinuxMount[] = [];
  for (const line of mountInfo.split('\n')) {
    const separator = line.indexOf(' - ');
    if (separator < 0) continue;
    const fields = line.slice(0, separator).split(' ');
    const id = fields[0];
    const mountPath = fields[4];
    const type = line.slice(separator + 3).split(' ')[0];
    if (id !== undefined && mountPath !== undefined && type !== undefined) {
      mounts.push({
        id,
        path: unescapeLinuxMountPath(mountPath),
        type,
      });
    }
  }
  return mounts;
}

function linuxMountForPath(mounts: LinuxMount[], path: string) {
  let selected: LinuxMount | undefined;
  for (const mount of mounts) {
    if (
      (path === mount.path || path.startsWith(mount.path === '/' ? '/' : `${mount.path}/`)) &&
      (selected === undefined || mount.path.length >= selected.path.length)
    ) {
      selected = mount;
    }
  }
  return selected;
}

async function linuxMountContext(projectRoot: string) {
  if (process.platform !== 'linux') return {};
  const mounts = await readLinuxMounts();
  const rootMountId = mounts === undefined ? undefined : linuxMountForPath(mounts, projectRoot)?.id;
  if (mounts === undefined || rootMountId === undefined) {
    throw new UnsupportedFilesystemError();
  }
  return { mounts, rootMountId };
}

function assertSameLinuxMount(
  mounts: LinuxMount[] | undefined,
  rootMountId: string | undefined,
  path: string,
) {
  if (
    mounts !== undefined &&
    rootMountId !== undefined &&
    linuxMountForPath(mounts, path)?.id !== rootMountId
  ) {
    throw new Error('A contract path traverses a mount alias.');
  }
}

function hasDetectableSynchronizedRoute(projectRoot: string) {
  const segments = projectRoot.split(/[\\/]+/).map((segment) => segment.toLowerCase());
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const next = segments[index + 1];
    if (
      process.platform === 'darwin' &&
      segment === 'library' &&
      (next === 'cloudstorage' || next === 'mobile documents')
    ) {
      return true;
    }
  }
  return false;
}

export async function assertSupportedFilesystem(projectRoot: string) {
  // Node/libuv reports no Windows filesystem type and POSIX modes do not enforce
  // account-only ACLs there, so the required guarantees cannot be established.
  if (process.platform === 'win32' || hasDetectableSynchronizedRoute(projectRoot)) {
    throw new UnsupportedFilesystemError();
  }
  const facts = await statfs(projectRoot, { bigint: true });
  if (
    UNSUPPORTED_FILESYSTEM_TYPES.has(facts.type) ||
    (process.platform === 'linux' && !SUPPORTED_LINUX_FILESYSTEM_TYPES.has(facts.type)) ||
    (process.platform === 'darwin' && !SUPPORTED_DARWIN_FILESYSTEM_TYPES.has(facts.type))
  ) {
    throw new UnsupportedFilesystemError();
  }
  if (process.platform === 'linux') {
    const { mounts } = await linuxMountContext(projectRoot);
    if (mounts === undefined) throw new UnsupportedFilesystemError();
    const mountType = linuxMountForPath(mounts, projectRoot)?.type;
    if (
      mountType !== undefined &&
      (UNSUPPORTED_MOUNT_TYPES.has(mountType) || mountType.startsWith('fuse.'))
    ) {
      throw new UnsupportedFilesystemError();
    }
  }
}

async function readBoundedFile(handle: Awaited<ReturnType<typeof open>>, maximumBytes: number) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  while (true) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximumBytes - totalBytes + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
    if (bytesRead === 0) return Buffer.concat(chunks, totalBytes);
    totalBytes += bytesRead;
    if (totalBytes > maximumBytes) {
      throw new ResourceLimitError('A secure file exceeds its fixed byte limit.');
    }
    chunks.push(buffer.subarray(0, bytesRead));
  }
}

async function matchingDirectoryEntries(directoryPath: string, expectedName: string) {
  const normalizedExpectedName = canonicalEntryName(expectedName);
  return (await readdir(directoryPath)).filter(
    (entry) => canonicalEntryName(entry) === normalizedExpectedName,
  );
}

function canonicalEntryName(entry: string) {
  return entry.normalize('NFC').toLowerCase();
}

function directoryEntryIndex(entries: string[]) {
  const index = new Map<string, string[]>();
  for (const entry of entries) {
    const canonicalName = canonicalEntryName(entry);
    const matches = index.get(canonicalName);
    if (matches === undefined) {
      index.set(canonicalName, [entry]);
    } else {
      matches.push(entry);
    }
  }
  return index;
}

async function assertSecureDirectorySnapshot(snapshot: SecureDirectorySnapshot) {
  const facts = await lstat(snapshot.path, { bigint: true });
  if (
    facts.isSymbolicLink() ||
    !facts.isDirectory() ||
    !sameSecureFileIdentity(secureFileIdentity(facts), snapshot.identity) ||
    facts.mtimeNs.toString() !== snapshot.mtime ||
    facts.ctimeNs.toString() !== snapshot.ctime
  ) {
    throw new SecureDirectoryChangedError('A secure directory changed after it was listed.');
  }
}

async function hasExpectedPublicationStagingAlias(
  path: string,
  facts: Awaited<ReturnType<typeof lstat>>,
) {
  if (facts.nlink !== 2n) return false;
  const filename = basename(path);
  const extension = extname(path).slice(1);
  const isAcceptedAlias = /\.lock\.recovering-[0-9a-f]{16}$/.test(filename)
    ? isRunLockQuarantineAlias
    : extension === 'md' || extension === 'json'
      ? (entry: string) => new RegExp(`^\\.submit-[0-9a-f]{16}\\.${extension}\\.tmp$`).test(entry)
      : extension === 'lock'
        ? (entry: string) =>
            /^\.acquire-[0-9a-f]{16}\.lock\.tmp$/.test(entry) || isRunLockRecoveryAlias(path, entry)
        : undefined;
  if (isAcceptedAlias === undefined) return false;
  let matchingAliases = 0;
  for (const entry of await readdir(dirname(path))) {
    if (!isAcceptedAlias(entry)) continue;
    const aliasFacts = await lstat(join(dirname(path), entry), { bigint: true });
    if (
      !aliasFacts.isSymbolicLink() &&
      aliasFacts.isFile() &&
      aliasFacts.dev === facts.dev &&
      aliasFacts.ino === facts.ino
    ) {
      matchingAliases += 1;
    }
  }
  return matchingAliases === 1;
}

async function hasAcceptedFileLinkCount(
  path: string,
  facts: Awaited<ReturnType<typeof lstat>>,
  options: SecureReadOptions,
) {
  return (
    facts.nlink === 1n ||
    (options.allowPublicationStagingAlias === true &&
      (await hasExpectedPublicationStagingAlias(path, facts)))
  );
}

async function readSecureRegularFileOnce(
  projectRoot: string,
  path: string,
  maximumBytes: number,
  options: SecureReadOptions,
) {
  const segments = path.split('/');
  let inputPath = projectRoot;
  const projectFacts = await lstat(projectRoot, { bigint: true });
  const projectIdentity = secureFileIdentity(projectFacts);
  if (
    options.expectedProjectIdentity !== undefined &&
    !sameSecureFileIdentity(projectIdentity, options.expectedProjectIdentity)
  ) {
    throw new Error('The selected project-root identity changed before a file was read.');
  }
  const { mounts: linuxMounts, rootMountId } = await linuxMountContext(projectRoot);
  const traversedEntries: Array<{ path: string; device: bigint; inode: bigint }> = [];
  for (const [index, segment] of segments.entries()) {
    const isFinalSegment = index === segments.length - 1;
    let aliases: readonly string[];
    if (isFinalSegment && options.expectedParentSnapshot !== undefined) {
      if (inputPath !== options.expectedParentSnapshot.path) {
        throw new Error('A secure file parent does not match its directory snapshot.');
      }
      await assertSecureDirectorySnapshot(options.expectedParentSnapshot);
      aliases =
        options.expectedParentSnapshot.entriesByCanonicalName.get(canonicalEntryName(segment)) ??
        [];
    } else {
      aliases = await matchingDirectoryEntries(inputPath, segment);
    }
    if (aliases.length !== 1 || aliases[0] !== segment) {
      throw new Error('Workflow Input path has an ambiguous case or Unicode alias.');
    }
    inputPath = join(inputPath, segment);
    assertSameLinuxMount(linuxMounts, rootMountId, inputPath);
    const facts = await lstat(inputPath, { bigint: true });
    const validFinalFile =
      isFinalSegment &&
      facts.isFile() &&
      (await hasAcceptedFileLinkCount(inputPath, facts, options));
    if (
      facts.isSymbolicLink() ||
      facts.dev !== projectFacts.dev ||
      (isFinalSegment ? !validFinalFile : !facts.isDirectory())
    ) {
      throw new Error('Workflow Input path traverses a linked, mounted, or non-regular entry.');
    }
    traversedEntries.push({ path: inputPath, device: facts.dev, inode: facts.ino });
  }

  const pathFactsBefore = await lstat(inputPath, { bigint: true });
  const handle = await open(inputPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedFactsBefore = await handle.stat({ bigint: true });
    if (
      !openedFactsBefore.isFile() ||
      !(await hasAcceptedFileLinkCount(inputPath, openedFactsBefore, options)) ||
      openedFactsBefore.dev !== pathFactsBefore.dev ||
      openedFactsBefore.ino !== pathFactsBefore.ino
    ) {
      throw new Error('Workflow Input identity changed before it was read.');
    }
    if (openedFactsBefore.size > BigInt(maximumBytes)) {
      throw new ResourceLimitError('A secure file exceeds its fixed byte limit.');
    }
    const bytes = await readBoundedFile(handle, maximumBytes);
    const openedFactsAfter = await handle.stat({ bigint: true });
    const projectFactsAfter = await lstat(projectRoot, { bigint: true });
    if (
      !projectFactsAfter.isDirectory() ||
      !sameSecureFileIdentity(secureFileIdentity(projectFactsAfter), projectIdentity)
    ) {
      throw new Error('The selected project-root identity changed while a file was read.');
    }
    const { mounts: linuxMountsAfter, rootMountId: rootMountIdAfter } =
      await linuxMountContext(projectRoot);
    if (rootMountIdAfter !== rootMountId) {
      throw new Error('The selected project root mount changed while a file was being read.');
    }
    for (const entry of traversedEntries) {
      assertSameLinuxMount(linuxMountsAfter, rootMountIdAfter, entry.path);
      const currentFacts = await lstat(entry.path, { bigint: true });
      if (
        currentFacts.isSymbolicLink() ||
        currentFacts.dev !== entry.device ||
        currentFacts.ino !== entry.inode
      ) {
        throw new Error('Workflow Input path identity changed while it was being read.');
      }
    }
    const pathFactsAfter = await lstat(inputPath, { bigint: true });
    if (options.expectedParentSnapshot !== undefined) {
      await assertSecureDirectorySnapshot(options.expectedParentSnapshot);
    }
    const changed =
      openedFactsAfter.dev !== openedFactsBefore.dev ||
      openedFactsAfter.ino !== openedFactsBefore.ino ||
      openedFactsAfter.size !== openedFactsBefore.size ||
      openedFactsAfter.mtimeNs !== openedFactsBefore.mtimeNs ||
      openedFactsAfter.ctimeNs !== openedFactsBefore.ctimeNs ||
      pathFactsAfter.dev !== openedFactsBefore.dev ||
      pathFactsAfter.ino !== openedFactsBefore.ino ||
      BigInt(bytes.byteLength) !== openedFactsBefore.size;
    if (changed) throw new Error('Workflow Input changed while it was being read.');
    return {
      bytes,
      identity: secureFileIdentity(openedFactsBefore),
    };
  } finally {
    await handle.close();
  }
}

export async function readSecureRegularFile(
  projectRoot: string,
  path: string,
  maximumBytes: number,
  options: SecureReadOptions = {},
) {
  // Removing a recognized publication alias can change ctime during the first read.
  // One full retry accepts only a freshly revalidated stable Result path.
  const attempts = options.allowPublicationStagingAlias === true ? 2 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await readSecureRegularFileOnce(projectRoot, path, maximumBytes, options);
    } catch (error) {
      if (
        attempt === attempts ||
        error instanceof ResourceLimitError ||
        error instanceof UnsupportedFilesystemError
      ) {
        throw error;
      }
    }
  }
  throw new Error('A secure file could not be read.');
}

export function readSecureResultFile(
  projectRoot: string,
  path: string,
  maximumBytes: number,
  options: Pick<SecureReadOptions, 'expectedParentSnapshot' | 'expectedProjectIdentity'> = {},
) {
  return readSecureRegularFile(projectRoot, path, maximumBytes, {
    allowPublicationStagingAlias: true,
    ...options,
  });
}

export async function readSecureDirectory(
  projectRoot: string,
  path: string,
  maximumEntries: number,
  options: SecureDirectoryOptions = {},
) {
  const segments = path.split('/');
  let directoryPath = projectRoot;
  const projectFacts = await lstat(projectRoot, { bigint: true });
  const projectIdentity = secureFileIdentity(projectFacts);
  if (
    options.expectedProjectIdentity !== undefined &&
    !sameSecureFileIdentity(projectIdentity, options.expectedProjectIdentity)
  ) {
    throw new Error('The selected project-root identity changed before a directory was read.');
  }
  const { mounts: linuxMounts, rootMountId } = await linuxMountContext(projectRoot);
  let directoryIdentity = secureFileIdentity(projectFacts);
  for (const segment of segments) {
    const aliases = await matchingDirectoryEntries(directoryPath, segment);
    if (aliases.length !== 1 || aliases[0] !== segment) {
      throw new Error('Directory path has an ambiguous case or Unicode alias.');
    }
    directoryPath = join(directoryPath, segment);
    assertSameLinuxMount(linuxMounts, rootMountId, directoryPath);
    const facts = await lstat(directoryPath, { bigint: true });
    if (facts.isSymbolicLink() || !facts.isDirectory() || facts.dev !== projectFacts.dev) {
      throw new Error('Directory path traverses a linked, mounted, or non-directory entry.');
    }
    directoryIdentity = secureFileIdentity(facts);
  }
  const listingFactsBefore = await lstat(directoryPath, { bigint: true });
  const entries = await readdir(directoryPath);
  if (entries.length > maximumEntries) {
    throw new ResourceLimitError('A secure directory exceeds its fixed entry limit.');
  }
  const listingFactsAfter = await lstat(directoryPath, { bigint: true });
  if (
    !sameSecureFileIdentity(secureFileIdentity(listingFactsBefore), directoryIdentity) ||
    !sameSecureFileIdentity(secureFileIdentity(listingFactsAfter), directoryIdentity) ||
    listingFactsAfter.mtimeNs !== listingFactsBefore.mtimeNs ||
    listingFactsAfter.ctimeNs !== listingFactsBefore.ctimeNs
  ) {
    throw new SecureDirectoryChangedError('A secure directory changed while it was listed.');
  }
  await assertSecureDirectoryIdentity(projectRoot, projectIdentity);
  return {
    entries,
    identity: directoryIdentity,
    snapshot: {
      path: directoryPath,
      identity: directoryIdentity,
      mtime: listingFactsAfter.mtimeNs.toString(),
      ctime: listingFactsAfter.ctimeNs.toString(),
      entriesByCanonicalName: directoryEntryIndex(entries),
    } satisfies SecureDirectorySnapshot,
  };
}

export async function assertSecureDirectoryIdentity(
  directoryPath: string,
  expectedIdentity: SecureFileIdentity,
) {
  const facts = await lstat(directoryPath, { bigint: true });
  if (
    facts.isSymbolicLink() ||
    !facts.isDirectory() ||
    !sameSecureFileIdentity(secureFileIdentity(facts), expectedIdentity)
  ) {
    throw new Error('A secure directory identity changed.');
  }
}

export async function ensurePrivateDirectoryPath(
  projectRoot: string,
  segments: string[],
  options: SecureDirectoryOptions = {},
) {
  let currentPath = projectRoot;
  const projectFacts = await lstat(projectRoot, { bigint: true });
  const projectIdentity = secureFileIdentity(projectFacts);
  if (
    options.expectedProjectIdentity !== undefined &&
    !sameSecureFileIdentity(projectIdentity, options.expectedProjectIdentity)
  ) {
    throw new Error('The selected project-root identity changed before a directory was created.');
  }
  const { mounts: linuxMounts, rootMountId } = await linuxMountContext(projectRoot);
  for (const segment of segments) {
    const existingAliases = await matchingDirectoryEntries(currentPath, segment);
    if (
      existingAliases.length > 1 ||
      (existingAliases.length === 1 && existingAliases[0] !== segment)
    ) {
      throw new Error('A Breakdown-owned directory path has an ambiguous alias.');
    }
    currentPath = join(currentPath, segment);
    try {
      await mkdir(currentPath, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    assertSameLinuxMount(linuxMounts, rootMountId, currentPath);
    const facts = await lstat(currentPath, { bigint: true });
    if (facts.isSymbolicLink() || !facts.isDirectory() || facts.dev !== projectFacts.dev) {
      throw new Error('A Breakdown-owned directory path is linked or not a directory.');
    }
  }
  await assertSecureDirectoryIdentity(projectRoot, projectIdentity);
  return currentPath;
}

export async function writePrivateFile(path: string, bytes: Uint8Array) {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export interface PrivateFilePublicationOptions {
  afterDestinationVisible?: () => void | Promise<void>;
  assertDestinationParent?: () => void | Promise<void>;
  afterDestinationValidated?: () => void | Promise<void>;
}

export async function publishPrivateFileNoReplace(
  stagingPath: string,
  destinationPath: string,
  options: PrivateFilePublicationOptions = {},
) {
  // Hard-link publication is the portable atomic no-replace move available in Node.
  // The final name is complete when it appears; removing the staging alias finishes the move.
  await options.assertDestinationParent?.();
  await options.afterDestinationValidated?.();
  await link(stagingPath, destinationPath);
  try {
    await options.assertDestinationParent?.();
  } catch (error) {
    await unlink(destinationPath);
    throw error;
  }
  try {
    await options.afterDestinationVisible?.();
  } finally {
    try {
      await unlink(stagingPath);
    } catch {
      // The no-replace destination is committed; a leftover staging alias is non-normative.
    }
  }
}

export async function syncDirectory(path: string) {
  if (process.platform === 'win32') return;
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

import { constants } from 'node:fs';
import { link, lstat, mkdir, open, readFile, readdir, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export class ResourceLimitError extends Error {}
export class UnsupportedFilesystemError extends Error {}

export interface SecureFileIdentity {
  device: string;
  inode: string;
  birthtime: string;
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

export async function assertSupportedFilesystem(projectRoot: string) {
  if (process.platform === 'win32' && /^[\\/]{2}/.test(projectRoot)) {
    throw new UnsupportedFilesystemError();
  }
  const facts = await statfs(projectRoot, { bigint: true });
  if (
    UNSUPPORTED_FILESYSTEM_TYPES.has(facts.type) ||
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
  const normalizedExpectedName = expectedName.normalize('NFC').toLowerCase();
  return (await readdir(directoryPath)).filter(
    (entry) => entry.normalize('NFC').toLowerCase() === normalizedExpectedName,
  );
}

export async function readSecureRegularFile(
  projectRoot: string,
  path: string,
  maximumBytes: number,
) {
  const segments = path.split('/');
  let inputPath = projectRoot;
  const projectFacts = await lstat(projectRoot, { bigint: true });
  const { mounts: linuxMounts, rootMountId } = await linuxMountContext(projectRoot);
  const traversedEntries: Array<{ path: string; device: bigint; inode: bigint }> = [];
  for (const [index, segment] of segments.entries()) {
    const aliases = await matchingDirectoryEntries(inputPath, segment);
    if (aliases.length !== 1 || aliases[0] !== segment) {
      throw new Error('Workflow Input path has an ambiguous case or Unicode alias.');
    }
    inputPath = join(inputPath, segment);
    assertSameLinuxMount(linuxMounts, rootMountId, inputPath);
    const facts = await lstat(inputPath, { bigint: true });
    const isFinalSegment = index === segments.length - 1;
    if (
      facts.isSymbolicLink() ||
      facts.dev !== projectFacts.dev ||
      (isFinalSegment ? !facts.isFile() || facts.nlink !== 1n : !facts.isDirectory())
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
      openedFactsBefore.nlink !== 1n ||
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
      identity: {
        device: openedFactsBefore.dev.toString(),
        inode: openedFactsBefore.ino.toString(),
        birthtime: openedFactsBefore.birthtimeNs.toString(),
      } satisfies SecureFileIdentity,
    };
  } finally {
    await handle.close();
  }
}

export async function readSecureDirectoryEntries(
  projectRoot: string,
  path: string,
  maximumEntries: number,
) {
  const segments = path.split('/');
  let directoryPath = projectRoot;
  const projectFacts = await lstat(projectRoot, { bigint: true });
  const { mounts: linuxMounts, rootMountId } = await linuxMountContext(projectRoot);
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
  }
  const entries = await readdir(directoryPath);
  if (entries.length > maximumEntries) {
    throw new ResourceLimitError('A secure directory exceeds its fixed entry limit.');
  }
  return entries;
}

export async function ensurePrivateDirectoryPath(projectRoot: string, segments: string[]) {
  let currentPath = projectRoot;
  const projectFacts = await lstat(projectRoot, { bigint: true });
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

export async function publishPrivateFileNoReplace(stagingPath: string, destinationPath: string) {
  await link(stagingPath, destinationPath);
  try {
    await unlink(stagingPath);
  } catch {
    // The complete destination is already committed. A leftover staging name is non-normative.
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

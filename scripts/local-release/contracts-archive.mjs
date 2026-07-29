import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

import { filesBelow, sha256 } from './filesystem.mjs';

const CONTRACT_CLASSIFICATIONS = {
  'LICENSE': { media_type: 'text/plain; charset=utf-8', role: 'license' },
  'NOTICE': { media_type: 'text/plain; charset=utf-8', role: 'notice' },
  'README.md': { media_type: 'text/markdown; charset=utf-8', role: 'contract-index' },
  'THIRD_PARTY_NOTICES.md': {
    media_type: 'text/markdown; charset=utf-8',
    role: 'third-party-notices',
  },
  'VERSION': { media_type: 'text/plain; charset=utf-8', role: 'version' },
};
const DIRECTORY_ROLES = {
  catalogs: 'catalog',
  conformance: 'conformance',
  examples: 'example',
  schemas: 'schema',
  specifications: 'specification',
};
const EXTENSION_MEDIA_TYPES = {
  '.base64': 'text/plain; charset=us-ascii',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.yaml': 'application/yaml',
};

function classifyContractEntry(path) {
  const exact = CONTRACT_CLASSIFICATIONS[path];
  if (exact !== undefined) return exact;
  const role = DIRECTORY_ROLES[path.split('/')[0]];
  const mediaType = EXTENSION_MEDIA_TYPES[extname(path)];
  if (role === undefined || mediaType === undefined) {
    throw new Error(`The contracts archive has no role or media type for ${path}.`);
  }
  return { media_type: mediaType, role };
}

export async function buildContractArtifacts({ contractsRoot, skillsRoot, releaseVersion }) {
  const legalFiles = new Map([
    ['LICENSE', await readFile(join(skillsRoot, 'setup-breakdown', 'LICENSE'), 'utf8')],
    [
      'NOTICE',
      `Breakdown Local Contracts
Copyright 2026 Adam Lamorre

This product includes specifications, schemas, catalogs, examples, and conformance material
developed for Breakdown Local.
`,
    ],
    [
      'THIRD_PARTY_NOTICES.md',
      `# Third-Party Notices

Document kind: License and notice material

Document version: ${releaseVersion}

No third-party material is incorporated into the Breakdown Local contracts archive. The archive
contains original specifications, schemas, catalogs, examples, and synthetic conformance assets.

JSON Schema identifiers and protocol names are compatibility references; no third-party
implementation, runtime, or library is copied into this archive.
`,
    ],
  ]);

  const payload = new Map();
  for (const absolutePath of await filesBelow(contractsRoot)) {
    const path = relative(contractsRoot, absolutePath).replaceAll('\\', '/');
    if (path === 'MANIFEST.json' || path.endsWith('.test.ts')) continue;
    payload.set(path, await readFile(absolutePath));
  }
  for (const [path, contents] of legalFiles) {
    payload.set(path, Buffer.from(contents));
  }
  const sortedPayload = new Map(
    [...payload].sort(([left], [right]) => left.localeCompare(right)),
  );
  const entries = [...sortedPayload].map(([path, bytes]) => ({
    path,
    ...classifyContractEntry(path),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  }));
  const manifestBytes = Buffer.from(
    `${JSON.stringify(
      {
        schema_version: 'breakdown.contracts-manifest.v1',
        release_version: releaseVersion,
        manifest_integrity:
          'Every payload entry is hashed here. MANIFEST.json is authenticated by the outer archive digest recorded in the release manifest and SHA256SUMS.',
        entries,
      },
      null,
      2,
    )}\n`,
  );
  return { legalFiles, manifestBytes, payload: sortedPayload };
}

function tarPathParts(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' };
  const separators = [...path.matchAll(/\//g)].map((match) => match.index);
  for (const index of separators.reverse()) {
    const prefix = path.slice(0, index);
    const name = path.slice(index + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`Archive path is too long for portable ustar: ${path}`);
}

function writeTarString(header, offset, length, value) {
  const bytes = Buffer.from(value);
  if (bytes.byteLength > length) throw new Error(`Tar field is too long: ${value}`);
  bytes.copy(header, offset);
}

function writeTarOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, '0');
  writeTarString(header, offset, length, `${encoded}\0`);
}

function tarHeader(path, size) {
  const header = Buffer.alloc(512);
  const { name, prefix } = tarPathParts(path);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, size);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  writeTarString(header, 156, 1, '0');
  writeTarString(header, 257, 6, 'ustar\0');
  writeTarString(header, 263, 2, '00');
  writeTarString(header, 345, 155, prefix);
  const checksum = header.reduce((total, byte) => total + byte, 0);
  writeTarString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

function buildTarGzip(entries) {
  const chunks = [];
  for (const [path, bytes] of entries) {
    chunks.push(tarHeader(path, bytes.byteLength), bytes);
    const padding = (512 - (bytes.byteLength % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  const archive = gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 });
  archive[9] = 255;
  return archive;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(entries) {
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;
  for (const [path, bytes] of entries) {
    const name = Buffer.from(path);
    const crc = crc32(bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(bytes.byteLength, 18);
    local.writeUInt32LE(bytes.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localChunks.push(local, name, bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(bytes.byteLength, 20);
    central.writeUInt32LE(bytes.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centralChunks.push(central, name);
    localOffset += local.byteLength + name.byteLength + bytes.byteLength;
  }
  const centralDirectory = Buffer.concat(centralChunks);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(localOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localChunks, centralDirectory, end]);
}

export async function writeContractsArchives({
  artifacts,
  outputPath,
  releaseVersion,
}) {
  const archiveRoot = `breakdown-contracts-${releaseVersion}`;
  const entries = [
    [`${archiveRoot}/MANIFEST.json`, artifacts.manifestBytes],
    ...[...artifacts.payload].map(([path, bytes]) => [`${archiveRoot}/${path}`, bytes]),
  ];
  await mkdir(outputPath, { recursive: true });
  await writeFile(join(outputPath, `${archiveRoot}.tar.gz`), buildTarGzip(entries));
  await writeFile(join(outputPath, `${archiveRoot}.zip`), buildZip(entries));
}

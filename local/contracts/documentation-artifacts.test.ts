import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const repositoryRoot = join(import.meta.dirname, '..', '..');
const documentationRoot = join(repositoryRoot, 'local', 'docs', '1.0.0');
const releaseVersion = '1.0.0';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function tarEntries(archive: Buffer): Map<string, Buffer> {
  const tar = gunzipSync(archive);
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start: number, length: number) => {
      const value = header.subarray(start, start + length).toString('utf8');
      const terminator = value.indexOf('\0');
      return terminator === -1 ? value : value.slice(0, terminator);
    };
    const name = text(0, 100);
    const prefix = text(345, 155);
    const path = prefix.length > 0 ? `${prefix}/${name}` : name;
    const size = Number.parseInt(text(124, 12).trim() || '0', 8);
    const contents = Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
    entries.set(path, contents);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function zipEntries(archive: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    expect(method).toBe(0);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const path = archive.subarray(nameStart, nameStart + fileNameLength).toString('utf8');
    entries.set(path, Buffer.from(archive.subarray(dataStart, dataStart + compressedSize)));
    offset = dataStart + compressedSize;
  }
  return entries;
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesBelow(path) : [path];
      }),
    )
  )
    .flat()
    .sort();
}

describe('Breakdown Local release documentation', () => {
  it('reproduces checked-in guidance and reference from named exact-version authorities', async () => {
    await expect(
      execFileAsync(
        process.execPath,
        [join(repositoryRoot, 'scripts', 'generate-local-documentation.mjs'), '--check'],
        { cwd: repositoryRoot },
      ),
    ).resolves.toMatchObject({ stderr: '' });

    const markdownPaths = [
      'README.md',
      'getting-started.md',
      'reference/automation.md',
      'reference/cli.md',
      'reference/mcp.md',
      'reference/packages.md',
      'reference/support.md',
    ];

    for (const path of markdownPaths) {
      const document = await readFile(join(documentationRoot, path), 'utf8');
      expect(document, path).toContain(`Document version: ${releaseVersion}`);
      expect(document, path).toMatch(
        /^Document kind: (?:Task-oriented guidance|Generated reference)$/m,
      );
    }
    const documentationIndex = await readFile(join(documentationRoot, 'README.md'), 'utf8');
    expect(documentationIndex).toContain(`# Breakdown Local ${releaseVersion}`);
    expect(documentationIndex).not.toContain('${releaseVersion}');

    const guide = await readFile(join(documentationRoot, 'getting-started.md'), 'utf8');
    const orderedHeadings = [
      '## 1. Install the exact release',
      '## 2. Author the Workflow Definition',
      '## 3. Validate',
      '## 4. Create a Run',
      '## 5. Inspect the exact Run',
      '## 6. Execute with guided Run Authority',
      '## 7. Summarize the exact Run',
    ];
    let previousHeading = -1;
    for (const heading of orderedHeadings) {
      const headingIndex = guide.indexOf(heading);
      expect(headingIndex, heading).toBeGreaterThan(previousHeading);
      previousHeading = headingIndex;
    }
    expect(guide).toContain('Local storage is not a promise of offline inference.');
    expect(guide).toContain('Run Authority');
    expect(guide).toContain('Model Neutrality');
    expect(guide).toContain('Git is not required');
    expect(guide).toContain('MCP is optional');
    expect(guide).toContain('Windows is not a maintained operating system');
    expect(guide).toContain('../contracts/specifications/');
    expect(guide).toContain(
      'https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0/',
    );
    const support = await readFile(join(documentationRoot, 'reference', 'support.md'), 'utf8');
    expect(support).toContain('Supported Host certification is deferred');
    expect(support).toContain('supported_hosts: []');
    expect(support).toContain('Compatible, not Supported');
    expect(support).toContain('Unsupported');
    expect(support).toContain('issue #188');

    for (const path of markdownPaths.filter((path) => path.startsWith('reference/'))) {
      const reference = await readFile(join(documentationRoot, path), 'utf8');
      expect(reference, path).toContain('## Generated from');
      expect(reference, path).toMatch(/`[a-z0-9./-]+` — SHA-256 `[0-9a-f]{64}`/);
      expect(reference, path).toContain('This reference is non-normative.');
    }
    const packageReference = await readFile(
      join(documentationRoot, 'reference', 'packages.md'),
      'utf8',
    );
    expect(packageReference.match(/matches every inspected expectation/g)).toHaveLength(3);

    const versionedIndex = await readFile(join(documentationRoot, 'llms.txt'), 'utf8');
    const repositoryIndex = await readFile(join(repositoryRoot, 'llms.txt'), 'utf8');
    expect(versionedIndex.split('\n').length).toBeLessThan(40);
    expect(repositoryIndex.split('\n').length).toBeLessThan(30);
    expect(versionedIndex).toContain('breakdown-local-v1.0.0');
    expect(repositoryIndex).toContain('breakdown-local-v1.0.0');
    expect(repositoryIndex).toContain('Discovery index only');
  });

  it('builds byte-reproducible offline contracts archives with a complete payload manifest', async () => {
    const firstOutput = await mkdtemp(join(tmpdir(), 'breakdown-contracts-first-'));
    const secondOutput = await mkdtemp(join(tmpdir(), 'breakdown-contracts-second-'));
    try {
      const script = join(repositoryRoot, 'scripts', 'generate-local-documentation.mjs');
      await execFileAsync(process.execPath, [script, '--archive', '--output', firstOutput], {
        cwd: repositoryRoot,
      });
      await execFileAsync(process.execPath, [script, '--archive', '--output', secondOutput], {
        cwd: repositoryRoot,
      });

      const archiveNames = [
        `breakdown-contracts-${releaseVersion}.tar.gz`,
        `breakdown-contracts-${releaseVersion}.zip`,
      ];
      for (const archiveName of archiveNames) {
        expect(await readFile(join(firstOutput, archiveName))).toEqual(
          await readFile(join(secondOutput, archiveName)),
        );
      }

      const tar = tarEntries(await readFile(join(firstOutput, archiveNames[0])));
      const zip = zipEntries(await readFile(join(firstOutput, archiveNames[1])));
      expect([...tar.keys()]).toEqual([...zip.keys()]);
      for (const [path, bytes] of tar) {
        expect(bytes, path).toEqual(zip.get(path));
      }

      const archiveRoot = `breakdown-contracts-${releaseVersion}`;
      const manifestPath = `${archiveRoot}/MANIFEST.json`;
      const manifest = JSON.parse(tar.get(manifestPath)!.toString('utf8')) as {
        schema_version: string;
        release_version: string;
        manifest_integrity: string;
        entries: Array<{
          path: string;
          media_type: string;
          role: string;
          bytes: number;
          sha256: string;
        }>;
      };
      expect(manifest).toMatchObject({
        schema_version: 'breakdown.contracts-manifest.v1',
        release_version: releaseVersion,
      });
      expect(manifest.manifest_integrity).toContain('outer archive digest');

      const payloadPaths = [...tar.keys()]
        .filter((path) => path !== manifestPath)
        .map((path) => path.slice(archiveRoot.length + 1));
      expect(manifest.entries.map((entry) => entry.path)).toEqual(payloadPaths);
      expect(new Set(manifest.entries.map((entry) => entry.role))).toEqual(
        new Set([
          'catalog',
          'conformance',
          'contract-index',
          'example',
          'license',
          'notice',
          'schema',
          'specification',
          'third-party-notices',
          'version',
        ]),
      );

      for (const entry of manifest.entries) {
        const bytes = tar.get(`${archiveRoot}/${entry.path}`);
        expect(bytes, entry.path).toBeDefined();
        expect(entry.media_type, entry.path).not.toBe('');
        expect(entry.bytes, entry.path).toBe(bytes!.byteLength);
        expect(entry.sha256, entry.path).toBe(sha256(bytes!));
      }
      expect(payloadPaths).not.toContain('contract-corpus.test.ts');
      expect(payloadPaths).toEqual(expect.arrayContaining(['LICENSE', 'NOTICE', 'VERSION']));
      expect(payloadPaths.some((path) => path.startsWith('specifications/'))).toBe(true);
      expect(payloadPaths.some((path) => path.startsWith('schemas/'))).toBe(true);
      expect(payloadPaths.some((path) => path.startsWith('catalogs/'))).toBe(true);
      expect(payloadPaths.some((path) => path.startsWith('examples/'))).toBe(true);
      expect(payloadPaths.some((path) => path.startsWith('conformance/'))).toBe(true);
    } finally {
      await rm(firstOutput, { recursive: true });
      await rm(secondOutput, { recursive: true });
    }
  }, 30_000);

  it('labels every released Markdown document with its authority layer and exact version', async () => {
    const releasedRoots = [
      join(repositoryRoot, 'local', 'contracts'),
      join(repositoryRoot, 'local', 'docs', releaseVersion),
      join(repositoryRoot, 'local', 'skills'),
    ];
    const markdownPaths = (await Promise.all(releasedRoots.map((root) => filesBelow(root))))
      .flat()
      .filter((path) => path.endsWith('.md') && !path.endsWith('.test.md'));

    expect(markdownPaths.length).toBeGreaterThan(20);
    for (const path of markdownPaths) {
      const document = await readFile(path, 'utf8');
      expect(document, path).toMatch(
        /^Document kind: (?:Authored normative contract|Contract index \(non-normative\)|Generated reference|License and notice material|Task-oriented guidance)$/m,
      );
      expect(document, path).toMatch(
        new RegExp(
          `^(?:Contract|Document) version: ${releaseVersion.replaceAll('.', '\\.')}$`,
          'm',
        ),
      );
    }
  });
});

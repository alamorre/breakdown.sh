import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildSkillsArtifacts } from '../../scripts/local-release/skills-archive.mjs';
import { tarGzipEntries, zipEntries } from '../../scripts/local-release/release-inspection.mjs';

const repositoryRoot = process.cwd();
const localSkillsRoot = join(repositoryRoot, 'local', 'skills');
const vendoredSkillsRoot = join(repositoryRoot, 'local', 'vendor', 'skills');
const releaseVersion = '1.0.1';
const vendoredSkillNames = [
  'ask-matt',
  'tdd',
  'code-review',
  'diagnosing-bugs',
  'prototype',
  'wayfinder',
  'grill-with-docs',
  'domain-modeling',
  'implement',
] as const;
const temporaryDirectories: string[] = [];

interface VendoredSkillsManifest {
  schema_version: string;
  upstream: {
    repository: string;
    revision: string;
    license: string;
    license_file: string;
  };
  skills: Array<{
    name: string;
    upstream_path: string;
    local_modifications: string[];
    files: Array<{
      path: string;
      status: 'verbatim' | 'adapted';
      sha256: string;
      upstream_sha256: string;
    }>;
  }>;
}

async function filesBelow(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await filesBelow(root, absolutePath)));
    } else {
      files.push(relative(root, absolutePath).replaceAll('\\', '/'));
    }
  }
  return files;
}

function sha256(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex');
}

function frontmatterName(source: string) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  expect(match, 'SKILL.md must begin with YAML frontmatter').not.toBeNull();
  const name = match![1]
    .split('\n')
    .find((line) => line.startsWith('name:'))
    ?.slice('name:'.length)
    .trim();
  return name;
}

async function readVendoredManifest() {
  return JSON.parse(
    await readFile(join(vendoredSkillsRoot, 'VENDORED_SKILLS.json'), 'utf8'),
  ) as VendoredSkillsManifest;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('vendored Matt Pocock skill pack', () => {
  it('pins provenance and authenticates every vendored skill file', async () => {
    const manifest = await readVendoredManifest();

    expect(manifest).toMatchObject({
      schema_version: 'breakdown.vendored-skills.v1',
      upstream: {
        repository: 'https://github.com/mattpocock/skills',
        revision: '6654f6b60cd9d5be8b54c6fafe44346dabeb3b76',
        license: 'MIT',
        license_file: 'LICENSE_MATTPOCOCK_SKILLS.txt',
      },
    });
    expect(manifest.skills.map((skill) => skill.name)).toEqual(vendoredSkillNames);
    expect(
      await readFile(join(vendoredSkillsRoot, manifest.upstream.license_file), 'utf8'),
    ).toContain('Copyright (c) 2026 Matt Pocock');

    for (const skill of manifest.skills) {
      const skillRoot = join(vendoredSkillsRoot, skill.name);
      expect(frontmatterName(await readFile(join(skillRoot, 'SKILL.md'), 'utf8'))).toBe(skill.name);
      expect(skill.upstream_path).toBe(`skills/engineering/${skill.name}`);
      expect(skill.files.map((file) => file.path).sort()).toEqual(
        (await filesBelow(skillRoot)).sort(),
      );
      expect(skill.files.length).toBeGreaterThan(0);
      expect(skill.local_modifications.length > 0).toBe(
        skill.files.some((file) => file.status === 'adapted'),
      );
      for (const file of skill.files) {
        expect(file.upstream_sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(file.sha256).toBe(sha256(await readFile(join(skillRoot, file.path))));
        expect(file.status).toBe(file.sha256 === file.upstream_sha256 ? 'verbatim' : 'adapted');
        const source = await readFile(join(skillRoot, file.path), 'utf8');
        expect(source).not.toMatch(/~\/\.(?:agents|codex)|\/Users\//);
      }
    }
  });

  it('routes ask-matt only to bundled skills and labels excluded upstream flows unavailable', async () => {
    const askMatt = await readFile(join(vendoredSkillsRoot, 'ask-matt', 'SKILL.md'), 'utf8');

    for (const skillName of vendoredSkillNames.filter((name) => name !== 'ask-matt')) {
      expect(askMatt).toContain(`/${skillName}`);
    }
    expect(askMatt).toContain('Not bundled');
    for (const unavailable of ['grilling', 'research', 'setup-matt-pocock-skills']) {
      expect(askMatt).toMatch(new RegExp(`Not bundled[\\s\\S]*${unavailable}`));
    }
  });

  it('includes every vendored skill in both deterministic standalone archives', async () => {
    const outputPath = await mkdtemp(join(tmpdir(), 'breakdown-vendored-skills-'));
    temporaryDirectories.push(outputPath);
    const result = await buildSkillsArtifacts({
      outputPath,
      releaseVersion,
      skillsRoot: localSkillsRoot,
      vendoredSkillsRoot: vendoredSkillsRoot,
    });
    const archiveRoot = `breakdown-skills-${releaseVersion}`;
    const tar = tarGzipEntries(await readFile(join(outputPath, result.tarName)));
    const zip = zipEntries(await readFile(join(outputPath, result.zipName)));

    expect([...tar.keys()]).toEqual([...zip.keys()]);
    for (const skillName of vendoredSkillNames) {
      const skillPath = `${archiveRoot}/${skillName}/SKILL.md`;
      expect(tar.has(skillPath), `${skillName} must be present in the tar archive`).toBe(true);
      expect(zip.has(skillPath), `${skillName} must be present in the zip archive`).toBe(true);
    }
    expect(tar.has(`${archiveRoot}/VENDORED_SKILLS.json`)).toBe(true);
    expect(tar.has(`${archiveRoot}/LICENSE_MATTPOCOCK_SKILLS.txt`)).toBe(true);

    const archiveManifest = JSON.parse(
      tar.get(`${archiveRoot}/MANIFEST.json`)!.toString('utf8'),
    ) as { entries: Array<{ path: string }> };
    for (const skillName of vendoredSkillNames) {
      expect(archiveManifest.entries.map((entry) => entry.path)).toContain(`${skillName}/SKILL.md`);
    }
  });
});

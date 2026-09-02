#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { filesBelow, sha256 } from './local-release/filesystem.mjs';

const execFileAsync = promisify(execFile);

export const upstreamRepository = 'https://github.com/mattpocock/skills';
export const upstreamRevision = '6654f6b60cd9d5be8b54c6fafe44346dabeb3b76';
export const vendoredSkillNames = [
  'ask-matt',
  'tdd',
  'code-review',
  'diagnosing-bugs',
  'prototype',
  'wayfinder',
  'grill-with-docs',
  'domain-modeling',
  'implement',
];

const localModifications = {
  'ask-matt': [
    'SKILL.md routes only among the nine skills shipped by Breakdown and marks excluded upstream flows unavailable.',
    'SKILL.md uses supported frontmatter while agents/openai.yaml retains explicit-only invocation.',
    'PHASE-BOUNDARIES.md explains that unbundled commands are host-native options only.',
  ],
  tdd: [
    'SKILL.md marks the upstream codebase-design dependency unavailable and provides a local fallback.',
  ],
  'code-review': [
    'SKILL.md removes the setup-skill precondition and supports sequential review passes when delegation is unavailable.',
  ],
  'diagnosing-bugs': [],
  prototype: [],
  wayfinder: [
    'SKILL.md replaces unbundled setup, research, and grilling dependencies with explicit host-native fallbacks.',
    'SKILL.md uses supported frontmatter while agents/openai.yaml retains explicit-only invocation.',
  ],
  'grill-with-docs': [
    'SKILL.md inlines the essential interview loop because the upstream grilling primitive is not bundled.',
    'SKILL.md uses supported frontmatter while agents/openai.yaml retains explicit-only invocation.',
  ],
  'domain-modeling': [],
  implement: [
    'SKILL.md uses supported frontmatter while agents/openai.yaml retains explicit-only invocation.',
  ],
};

function usage() {
  return 'Usage: node scripts/generate-vendored-skills-manifest.mjs --upstream PATH [--check]';
}

function argumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

function relativeFiles(root, files) {
  return files.map((path) => relative(root, path).replaceAll('\\', '/')).sort();
}

async function assertRevision(upstreamRoot) {
  const { stdout } = await execFileAsync('git', ['-C', upstreamRoot, 'rev-parse', 'HEAD']);
  const revision = stdout.trim();
  if (revision !== upstreamRevision) {
    throw new Error(`Expected upstream revision ${upstreamRevision}, received ${revision}.`);
  }
}

export async function buildVendoredSkillsManifest({ upstreamRoot, vendoredSkillsRoot }) {
  await assertRevision(upstreamRoot);
  const upstreamLicense = await readFile(join(upstreamRoot, 'LICENSE'));
  const localLicense = await readFile(join(vendoredSkillsRoot, 'LICENSE_MATTPOCOCK_SKILLS.txt'));
  if (!localLicense.equals(upstreamLicense)) {
    throw new Error('The vendored Matt Pocock license differs from the pinned upstream license.');
  }

  const skills = [];
  for (const name of vendoredSkillNames) {
    const upstreamPath = `skills/engineering/${name}`;
    const upstreamSkillRoot = join(upstreamRoot, upstreamPath);
    const localSkillRoot = join(vendoredSkillsRoot, name);
    const upstreamFiles = relativeFiles(upstreamSkillRoot, await filesBelow(upstreamSkillRoot));
    const localFiles = relativeFiles(localSkillRoot, await filesBelow(localSkillRoot));
    if (JSON.stringify(localFiles) !== JSON.stringify(upstreamFiles)) {
      throw new Error(`${name} local and upstream file inventories differ.`);
    }

    const files = [];
    for (const path of localFiles) {
      const upstreamBytes = await readFile(join(upstreamSkillRoot, path));
      const localBytes = await readFile(join(localSkillRoot, path));
      const upstreamHash = sha256(upstreamBytes);
      const localHash = sha256(localBytes);
      files.push({
        path,
        status: upstreamHash === localHash ? 'verbatim' : 'adapted',
        upstream_sha256: upstreamHash,
        sha256: localHash,
      });
    }
    skills.push({
      name,
      upstream_path: upstreamPath,
      local_modifications: localModifications[name],
      files,
    });
  }

  return {
    schema_version: 'breakdown.vendored-skills.v1',
    generated_by: 'scripts/generate-vendored-skills-manifest.mjs',
    upstream: {
      repository: upstreamRepository,
      revision: upstreamRevision,
      license: 'MIT',
      license_file: 'LICENSE_MATTPOCOCK_SKILLS.txt',
      license_sha256: sha256(upstreamLicense),
    },
    skills,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const upstream = argumentValue(argv, '--upstream');
  if (upstream === undefined) throw new Error(usage());
  const repositoryRoot = resolve(import.meta.dirname, '..');
  const vendoredSkillsRoot = join(repositoryRoot, 'plugins', 'breakdown', 'skills');
  const manifest = await buildVendoredSkillsManifest({
    upstreamRoot: resolve(upstream),
    vendoredSkillsRoot,
  });
  const expected = `${JSON.stringify(manifest, null, 2)}\n`;
  const manifestPath = join(vendoredSkillsRoot, 'VENDORED_SKILLS.json');

  if (argv.includes('--check')) {
    const current = await readFile(manifestPath, 'utf8');
    if (current !== expected) throw new Error(`${manifestPath} is stale.`);
    process.stdout.write(`${manifestPath} is current.\n`);
    return;
  }

  await writeFile(manifestPath, expected);
  process.stdout.write(`Updated ${manifestPath}.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}

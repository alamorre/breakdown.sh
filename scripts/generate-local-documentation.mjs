#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

import {
  buildContractArtifacts,
  writeContractsArchives,
} from './local-release/contracts-archive.mjs';
import {
  buildDocumentation,
  contractsRoot,
  documentationRoot,
  releaseVersion,
  repositoryRoot,
  skillsRoot,
} from './local-release/documentation.mjs';
import { skillManifestBytes } from './local-release/skill-manifest.mjs';

async function expectedReleaseFiles() {
  const expectedSkillManifestBytes = await skillManifestBytes({ skillsRoot, releaseVersion });
  const { documents, repositoryLlms } = await buildDocumentation(expectedSkillManifestBytes);
  const contractArtifacts = await buildContractArtifacts({
    contractsRoot,
    skillsRoot,
    releaseVersion,
  });
  const files = new Map([[join(repositoryRoot, 'llms.txt'), repositoryLlms]]);
  for (const [path, contents] of documents) {
    files.set(join(documentationRoot, path), contents);
  }
  for (const [path, contents] of contractArtifacts.legalFiles) {
    files.set(join(contractsRoot, path), contents);
  }
  files.set(
    join(skillsRoot, 'setup-breakdown', 'assets', 'skill-pack-manifest.json'),
    expectedSkillManifestBytes,
  );
  files.set(join(contractsRoot, 'MANIFEST.json'), contractArtifacts.manifestBytes);
  return { contractArtifacts, files };
}

async function writeExpectedFiles(files) {
  for (const [path, contents] of files) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
}

async function checkExpectedFiles(files) {
  const drift = [];
  for (const [path, contents] of files) {
    let actual;
    try {
      actual = await readFile(path);
    } catch {
      drift.push(relative(repositoryRoot, path));
      continue;
    }
    const expected = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    if (!actual.equals(expected)) drift.push(relative(repositoryRoot, path));
  }
  if (drift.length > 0) {
    throw new Error(
      `Generated documentation is missing or stale:\n${drift.map((path) => `- ${path}`).join('\n')}`,
    );
  }
}

const command = process.argv[2] ?? '--check';
const { contractArtifacts, files } = await expectedReleaseFiles();
if (command === '--write') {
  await writeExpectedFiles(files);
} else if (command === '--check') {
  await checkExpectedFiles(files);
} else if (command === '--archive') {
  await checkExpectedFiles(files);
  const outputIndex = process.argv.indexOf('--output');
  const outputPath = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];
  if (outputPath === undefined || outputPath.length === 0) {
    throw new Error('--archive requires --output PATH.');
  }
  await writeContractsArchives({
    artifacts: contractArtifacts,
    outputPath: resolve(outputPath),
    releaseVersion,
  });
} else {
  throw new Error(`Usage: ${process.argv[1]} [--check|--write|--archive --output PATH]`);
}

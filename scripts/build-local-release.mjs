#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  buildContractArtifacts,
  writeContractsArchives,
} from './local-release/contracts-archive.mjs';
import { requiredArgumentValue } from './local-release/command-line.mjs';
import { buildPackageArtifacts } from './local-release/package-artifacts.mjs';
import {
  assertCleanReleaseSource,
  writeChecksums,
  writeProvenanceInputs,
  writeReleaseManifest,
  writeSbom,
} from './local-release/release-metadata.mjs';
import { inspectReleaseCandidate } from './local-release/release-inspection.mjs';
import { buildSkillsArtifacts } from './local-release/skills-archive.mjs';

const execFileAsync = promisify(execFile);
const defaultRepositoryRoot = resolve(import.meta.dirname, '..');

export async function buildLocalRelease({ outputPath, repositoryRoot = defaultRepositoryRoot }) {
  const candidateDirectory = resolve(outputPath);
  const contractsRoot = join(repositoryRoot, 'local', 'contracts');
  const skillsRoot = join(repositoryRoot, 'local', 'skills');
  const vendoredSkillsRoot = join(repositoryRoot, 'plugins', 'breakdown', 'skills');

  await mkdir(candidateDirectory, { recursive: true });
  if ((await readdir(candidateDirectory)).length > 0) {
    throw new Error(`Candidate output directory must be empty: ${candidateDirectory}`);
  }
  await assertCleanReleaseSource(repositoryRoot);

  const releaseVersion = (await readFile(join(contractsRoot, 'VERSION'), 'utf8')).trim();
  await execFileAsync(
    process.execPath,
    [join(repositoryRoot, 'scripts', 'generate-local-documentation.mjs'), '--check'],
    { cwd: repositoryRoot },
  );

  const packageResults = await buildPackageArtifacts({
    outputPath: candidateDirectory,
    releaseVersion,
    repositoryRoot,
  });
  const contractArtifacts = await buildContractArtifacts({
    contractsRoot,
    skillsRoot,
    releaseVersion,
  });
  await writeContractsArchives({
    artifacts: contractArtifacts,
    outputPath: candidateDirectory,
    releaseVersion,
  });
  const skillsArtifacts = await buildSkillsArtifacts({
    outputPath: candidateDirectory,
    releaseVersion,
    skillsRoot,
    vendoredSkillsRoot,
  });
  const archiveNames = {
    contractsTar: `breakdown-contracts-${releaseVersion}.tar.gz`,
    contractsZip: `breakdown-contracts-${releaseVersion}.zip`,
    skillsTar: skillsArtifacts.tarName,
    skillsZip: skillsArtifacts.zipName,
  };
  const primaryArtifacts = [
    ...packageResults.map((result) => ({ file: result.artifactName })),
    ...Object.values(archiveNames).map((file) => ({ file })),
  ];
  const sbomName = await writeSbom({
    archiveNames,
    outputPath: candidateDirectory,
    packageResults,
    releaseVersion,
  });
  const provenance = await writeProvenanceInputs({
    outputPath: candidateDirectory,
    primaryArtifacts,
    releaseVersion,
    repositoryRoot,
  });
  const { fileName: releaseManifestName } = await writeReleaseManifest({
    archiveNames,
    outputPath: candidateDirectory,
    packageResults,
    platformConformance: provenance.platformConformance,
    provenanceName: provenance.fileName,
    releaseVersion,
    sbomName,
  });
  await writeChecksums({
    outputPath: candidateDirectory,
    fileNames: [
      ...primaryArtifacts.map((artifact) => artifact.file),
      sbomName,
      provenance.fileName,
      releaseManifestName,
    ],
  });

  return inspectReleaseCandidate({
    candidateDirectory,
    releaseVersion,
  });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  const outputPath = requiredArgumentValue(
    process.argv,
    '--output',
    'Usage: build-local-release.mjs --output PATH',
  );
  const inspection = await buildLocalRelease({ outputPath });
  process.stdout.write(`${JSON.stringify(inspection, null, 2)}\n`);
}

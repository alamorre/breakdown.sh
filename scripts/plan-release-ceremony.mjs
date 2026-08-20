#!/usr/bin/env node

import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { sha256 } from './local-release/filesystem.mjs';
import { createReleaseCeremonyPlan } from './local-release/release-ceremony.mjs';
import { readCandidate, validatePlatformIndex } from './local-release/publication.mjs';

function optionalArgumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? '' : (argv[index + 1] ?? '');
}

async function readJson(path, label) {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export async function main(argv = process.argv) {
  const usage =
    'Usage: plan-release-ceremony.mjs --candidate PATH --platform-index PATH --candidate-artifact PATH --platform-artifact PATH --qualification-run PATH --source-sha SHA --current-main-sha SHA --candidate-artifact-id ID --platform-index-artifact-id ID --execution-mode dry-run|execute|resume-publication --npm-publication-mode MODE --ceremony-run-id ID --ceremony-run-attempt 1 --actor LOGIN --triggering-actor LOGIN [--npm-bootstrap-artifact-id ID] [--npm-trusted-publishing-artifact-id ID] --output PATH';
  const candidate = await readCandidate(resolve(requiredArgumentValue(argv, '--candidate', usage)));
  const platformIndexPath = resolve(requiredArgumentValue(argv, '--platform-index', usage));
  const platformIndexBytes = await readFile(platformIndexPath);
  const platformIndex = JSON.parse(platformIndexBytes.toString('utf8'));
  validatePlatformIndex(platformIndex, candidate);
  const sourceSha = requiredArgumentValue(argv, '--source-sha', usage);
  const plan = createReleaseCeremonyPlan({
    candidate,
    candidateArtifact: await readJson(
      requiredArgumentValue(argv, '--candidate-artifact', usage),
      'Candidate artifact metadata',
    ),
    candidateArtifactId: requiredArgumentValue(argv, '--candidate-artifact-id', usage),
    ceremonyRun: {
      repository: process.env.GITHUB_REPOSITORY,
      ref: process.env.GITHUB_REF,
      sha: sourceSha,
      actor: requiredArgumentValue(argv, '--actor', usage),
      triggering_actor: requiredArgumentValue(argv, '--triggering-actor', usage),
      id: requiredArgumentValue(argv, '--ceremony-run-id', usage),
      attempt: Number(requiredArgumentValue(argv, '--ceremony-run-attempt', usage)),
    },
    currentMainSha: requiredArgumentValue(argv, '--current-main-sha', usage),
    executionMode: requiredArgumentValue(argv, '--execution-mode', usage),
    npmBootstrapArtifactId: optionalArgumentValue(argv, '--npm-bootstrap-artifact-id'),
    npmPublicationMode: requiredArgumentValue(argv, '--npm-publication-mode', usage),
    npmTrustedPublishingArtifactId: optionalArgumentValue(
      argv,
      '--npm-trusted-publishing-artifact-id',
    ),
    platformIndex,
    platformIndexArtifact: await readJson(
      requiredArgumentValue(argv, '--platform-artifact', usage),
      'Platform artifact metadata',
    ),
    platformIndexArtifactId: requiredArgumentValue(argv, '--platform-index-artifact-id', usage),
    platformIndexSha256: sha256(platformIndexBytes),
    qualificationRun: await readJson(
      requiredArgumentValue(argv, '--qualification-run', usage),
      'Qualification run metadata',
    ),
  });
  const outputPath = resolve(requiredArgumentValue(argv, '--output', usage));
  await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(await realpath(process.argv[1])).href
) {
  await main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

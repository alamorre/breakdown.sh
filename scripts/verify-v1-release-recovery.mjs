#!/usr/bin/env node

import { readFile, realpath, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { sha256 } from './local-release/filesystem.mjs';
import {
  planV1StablePublicationHandoff,
  validateReleaseRecoveryEvidence,
  V1_RELEASE_RECOVERY_POLICY,
} from './local-release/release-ceremony.mjs';
import { readCandidate } from './local-release/publication.mjs';

async function readJson(argv, name, usage) {
  const path = resolve(requiredArgumentValue(argv, name, usage));
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
}

export async function main(argv = process.argv) {
  if (argv.includes('--plan-handoff')) {
    const usage =
      'Usage: verify-v1-release-recovery.mjs --plan-handoff --runs PATH --publication-state PATH --output PATH';
    const plan = planV1StablePublicationHandoff({
      publicationState: await readJson(argv, '--publication-state', usage),
      workflowRuns: await readJson(argv, '--runs', usage),
    });
    const outputPath = resolve(requiredArgumentValue(argv, '--output', usage));
    await writeFile(outputPath, `${JSON.stringify(plan, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    return;
  }
  const usage =
    'Usage: verify-v1-release-recovery.mjs --candidate PATH --platform-index PATH --candidate-artifact PATH --platform-artifact PATH --qualification-run PATH --ceremony-run PATH --plan PATH --plan-artifact PATH --authorization PATH --authorization-artifact PATH --tag-ref PATH --tag-object PATH --signer PATH --gitsign-log PATH --output PATH';
  const planPath = resolve(requiredArgumentValue(argv, '--plan', usage));
  const authorizationPath = resolve(requiredArgumentValue(argv, '--authorization', usage));
  const platformIndexPath = resolve(requiredArgumentValue(argv, '--platform-index', usage));
  const planBytes = await readFile(planPath);
  const authorizationBytes = await readFile(authorizationPath);
  const platformIndexBytes = await readFile(platformIndexPath);
  const report = validateReleaseRecoveryEvidence({
    authorization: JSON.parse(authorizationBytes.toString('utf8')),
    authorizationArtifact: await readJson(argv, '--authorization-artifact', usage),
    authorizationBytes,
    candidate: await readCandidate(resolve(requiredArgumentValue(argv, '--candidate', usage))),
    candidateArtifact: await readJson(argv, '--candidate-artifact', usage),
    ceremonyRun: await readJson(argv, '--ceremony-run', usage),
    gitsignVerificationLog: await readFile(
      resolve(requiredArgumentValue(argv, '--gitsign-log', usage)),
    ),
    plan: JSON.parse(planBytes.toString('utf8')),
    planArtifact: await readJson(argv, '--plan-artifact', usage),
    planBytes,
    platformArtifact: await readJson(argv, '--platform-artifact', usage),
    platformIndex: JSON.parse(platformIndexBytes.toString('utf8')),
    platformIndexSha256: sha256(platformIndexBytes),
    qualificationRun: await readJson(argv, '--qualification-run', usage),
    signer: await readJson(argv, '--signer', usage),
    tagObject: await readJson(argv, '--tag-object', usage),
    tagRef: await readJson(argv, '--tag-ref', usage),
  });
  const outputPath = resolve(requiredArgumentValue(argv, '--output', usage));
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        ...report,
        confirmation: V1_RELEASE_RECOVERY_POLICY.confirmation,
      },
      null,
      2,
    )}\n`,
  );
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

#!/usr/bin/env node

import { readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { requiredArgumentValue } from './local-release/command-line.mjs';
import { prepareNpmPublicationControls } from './local-release/npm-publishing.mjs';

function optionalArgumentValue(argv, name) {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
}

async function optionalJson(argv, name) {
  const value = optionalArgumentValue(argv, name);
  return value === undefined ? undefined : JSON.parse(await readFile(resolve(value), 'utf8'));
}

export async function main(argv = process.argv) {
  const usage =
    'Usage: prepare-npm-publication.mjs --mode first-package-bootstrap|finalize-bootstrap|oidc-trusted-publishing --candidate PATH [--trusted-publishing PATH] [--bootstrap-evidence PATH] --output PATH';
  const evidence = await prepareNpmPublicationControls({
    bootstrapEvidence: await optionalJson(argv, '--bootstrap-evidence'),
    candidateDirectory: resolve(requiredArgumentValue(argv, '--candidate', usage)),
    mode: requiredArgumentValue(argv, '--mode', usage),
    outputPath: resolve(requiredArgumentValue(argv, '--output', usage)),
    trustedPublishingEvidence: await optionalJson(argv, '--trusted-publishing'),
  });
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
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

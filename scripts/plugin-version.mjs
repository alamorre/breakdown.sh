#!/usr/bin/env node
/* eslint-disable no-console */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BUMP_LEVELS, PLUGIN_MANIFEST_PATH, bumpSemver } from './plugin-version-utils.mjs';

function readFlag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

export function readBumpLevel(argv) {
  const explicitLevel = readFlag(argv, 'level');
  if (explicitLevel) return explicitLevel;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg.startsWith('--')) {
      index += 1;
      continue;
    }

    return arg;
  }

  return null;
}

function usage() {
  return `Usage: pnpm plugin:version -- ${BUMP_LEVELS.join('|')}`;
}

export async function updatePluginVersion({ level, manifestPath = PLUGIN_MANIFEST_PATH }) {
  if (!BUMP_LEVELS.includes(level)) {
    throw new Error(`${usage()}\nReceived: ${level ?? '(missing)'}`);
  }

  const absoluteManifestPath = resolve(manifestPath);
  const manifest = JSON.parse(await readFile(absoluteManifestPath, 'utf8'));
  const previousVersion = manifest.version;
  const nextVersion = bumpSemver(previousVersion, level);

  manifest.version = nextVersion;
  await writeFile(absoluteManifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  return {
    manifestPath,
    previousVersion,
    nextVersion,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const level = readBumpLevel(argv);
  const manifestPath = readFlag(argv, 'manifest') ?? PLUGIN_MANIFEST_PATH;
  const result = await updatePluginVersion({ level, manifestPath });

  console.log(
    `Updated ${result.manifestPath} from ${result.previousVersion} to ${result.nextVersion}.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}

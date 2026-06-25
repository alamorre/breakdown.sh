#!/usr/bin/env node
/* eslint-disable no-console */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  PLUGIN_MANIFEST_PATH,
  evaluatePluginVersionGuard,
} from './plugin-version-utils.mjs';

function readFlag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function readManifestVersion(text) {
  return JSON.parse(text).version;
}

function readCurrentPluginVersion() {
  return readManifestVersion(readFileSync(PLUGIN_MANIFEST_PATH, 'utf8'));
}

function readBasePluginVersion(baseRef) {
  return readManifestVersion(git(['show', `${baseRef}:${PLUGIN_MANIFEST_PATH}`]));
}

function readChangedFiles(baseRef) {
  const output = git(['diff', '--name-only', `${baseRef}...HEAD`]);
  return output ? output.split('\n').filter(Boolean) : [];
}

function defaultBaseRef() {
  if (process.env.GITHUB_BASE_REF) {
    return `origin/${process.env.GITHUB_BASE_REF}`;
  }

  return 'origin/main';
}

export function runPluginVersionGuard({ baseRef = defaultBaseRef() } = {}) {
  const changedFiles = readChangedFiles(baseRef);
  const baseVersion = readBasePluginVersion(baseRef);
  const currentVersion = readCurrentPluginVersion();

  return {
    baseRef,
    baseVersion,
    currentVersion,
    ...evaluatePluginVersionGuard({ changedFiles, baseVersion, currentVersion }),
  };
}

export function main(argv = process.argv.slice(2)) {
  const baseRef = readFlag(argv, 'base-ref') ?? defaultBaseRef();
  const result = runPluginVersionGuard({ baseRef });

  if (!result.ok) {
    console.error(result.message);
    if (result.pluginReleaseFiles.length > 0) {
      console.error('\nPlugin release files changed:');
      for (const filePath of result.pluginReleaseFiles) {
        console.error(`  - ${filePath}`);
      }
    }
    console.error('\nRun `pnpm plugin:version -- patch`, `minor`, or `major` on this branch.');
    process.exit(1);
  }

  console.log(result.message);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

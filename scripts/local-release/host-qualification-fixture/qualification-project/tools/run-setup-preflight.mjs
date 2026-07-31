#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const project = process.env.BREAKDOWN_QUALIFICATION_PROJECT;
const preflightProject = process.env.BREAKDOWN_QUALIFICATION_PREFLIGHT_PROJECT;
const preflight = process.env.BREAKDOWN_QUALIFICATION_PREFLIGHT;
const cli = process.env.BREAKDOWN_QUALIFICATION_REAL_CLI;
const hostVersion = process.env.BREAKDOWN_QUALIFICATION_COPILOT_VERSION;
const mode = process.env.BREAKDOWN_QUALIFICATION_PREFLIGHT_MODE;
const skill = process.env.BREAKDOWN_QUALIFICATION_PREFLIGHT_SKILL;
const audit = process.env.BREAKDOWN_QUALIFICATION_PREFLIGHT_LOG;
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const knownSkills = new Set([
  'author-breakdown',
  'critique-breakdown',
  'run-breakdown',
  'setup-breakdown',
  'summarize-breakdown-run',
]);

if (
  process.argv.length !== 2 ||
  project === undefined ||
  !isAbsolute(project) ||
  resolve(project) !== resolve(projectRoot) ||
  preflightProject === undefined ||
  !isAbsolute(preflightProject) ||
  preflightProject === project ||
  preflight === undefined ||
  !isAbsolute(preflight) ||
  !preflight.endsWith('/setup-breakdown/scripts/preflight.mjs') ||
  cli === undefined ||
  !isAbsolute(cli) ||
  !/^\d+\.\d+\.\d+$/.test(hostVersion ?? '') ||
  (mode !== 'full' && mode !== 'fast') ||
  (mode === 'full' ? skill !== '' : !knownSkills.has(skill)) ||
  audit === undefined ||
  !isAbsolute(audit)
) {
  throw new Error('exact qualification setup preflight boundary is unavailable');
}

const args = [
  preflight,
  '--mode',
  mode,
  ...(mode === 'fast' ? ['--skill', skill] : []),
  '--project',
  preflightProject,
  '--host',
  'GitHub Copilot CLI',
  '--host-version',
  hostVersion,
  '--cli-command',
  cli,
];
const result = spawnSync(process.execPath, args, {
  env: process.env,
  encoding: null,
  maxBuffer: 16 * 1024 * 1024,
});
const hash = (value) =>
  createHash('sha256')
    .update(value ?? Buffer.alloc(0))
    .digest('hex');
appendFileSync(
  audit,
  `${JSON.stringify({
    process: 'setup-preflight',
    mode,
    skill: skill || null,
    exit_status: result.status,
    stdout_sha256: hash(result.stdout),
    stderr_sha256: hash(result.stderr),
  })}\n`,
  { mode: 0o600 },
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exit(result.status === null ? 99 : result.status);

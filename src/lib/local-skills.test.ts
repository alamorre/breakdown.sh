import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const skillsRoot = join(workspaceRoot, 'local', 'skills');
const releaseVersion = '1.0.0-beta.1';
const skillNames = ['setup-breakdown', 'author-breakdown', 'critique-breakdown'] as const;
const temporaryDirectories: string[] = [];

interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(command: string, args: string[]): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (status) => resolveResult({ status, stdout, stderr }));
    child.stdin.end();
  });
}

async function listFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listFiles(root, absolutePath)));
    } else {
      paths.push(relative(root, absolutePath).replaceAll('\\', '/'));
    }
  }
  return paths;
}

function parseFrontmatter(source: string) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  expect(match, 'SKILL.md must begin with YAML frontmatter').not.toBeNull();
  const lines = match![1].split('\n');
  const fields: Record<string, string | Record<string, string>> = {};
  let metadata: Record<string, string> | undefined;
  for (const line of lines) {
    if (line === 'metadata:') {
      metadata = {};
      fields.metadata = metadata;
    } else if (line.startsWith('  ')) {
      const separator = line.indexOf(':', 2);
      expect(metadata, `unexpected nested frontmatter line: ${line}`).toBeDefined();
      metadata![line.slice(2, separator)] = line
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    } else {
      metadata = undefined;
      const separator = line.indexOf(':');
      fields[line.slice(0, separator)] = line
        .slice(separator + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
    }
  }
  return fields;
}

async function runPreflight(
  root: string,
  projectRoot: string,
  extraArgs: string[] = [],
): Promise<ProcessResult> {
  return run(process.execPath, [
    join(root, 'setup-breakdown', 'scripts', 'preflight.mjs'),
    '--project',
    projectRoot,
    '--host',
    'test-harness',
    '--host-version',
    '1.0.0',
    '--cli-command',
    process.execPath,
    '--cli-arg',
    join(workspaceRoot, 'packages', 'breakdown-cli', 'dist', 'index.js'),
    ...extraArgs,
  ]);
}

beforeAll(async () => {
  for (const packageName of ['@breakdown-sh/core', '@breakdown-sh/cli', '@breakdown-sh/mcp']) {
    const build = await run('pnpm', ['--filter', packageName, 'build']);
    expect(
      build,
      `${packageName}\nstdout:\n${build.stdout}\nstderr:\n${build.stderr}`,
    ).toMatchObject({ status: 0 });
  }
});

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('canonical portable skill artifacts', () => {
  it('uses only the strict common frontmatter profile and complete independent notices', async () => {
    for (const skillName of skillNames) {
      const skillRoot = join(skillsRoot, skillName);
      const fields = parseFrontmatter(await readFile(join(skillRoot, 'SKILL.md'), 'utf8'));
      expect(Object.keys(fields).sort()).toEqual([
        'compatibility',
        'description',
        'license',
        'metadata',
        'name',
      ]);
      expect(fields.name).toBe(skillName);
      expect(fields.license).toBe('Apache-2.0. See LICENSE.');
      expect(fields.metadata).toEqual({
        'breakdown-sh.pack': 'breakdown-local',
        'breakdown-sh.version': releaseVersion,
      });

      const license = await readFile(join(skillRoot, 'LICENSE'), 'utf8');
      const notice = await readFile(join(skillRoot, 'NOTICE'), 'utf8');
      const thirdPartyNotices = await readFile(join(skillRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
      expect(license).toContain('Apache License\n                           Version 2.0');
      expect(notice).toContain('Breakdown Local');
      expect(thirdPartyNotices).toContain('No third-party material');
    }
  });

  it('allows an executable script only in setup-breakdown', async () => {
    expect(
      (await listFiles(join(skillsRoot, 'setup-breakdown'))).some((path) =>
        path.startsWith('scripts/'),
      ),
    ).toBe(true);
    for (const skillName of ['author-breakdown', 'critique-breakdown'] as const) {
      expect(
        (await listFiles(join(skillsRoot, skillName))).some((path) => path.startsWith('scripts/')),
      ).toBe(false);
    }
  });

  it('matches every canonical payload byte against the embedded manifest', async () => {
    const manifestPath = join(skillsRoot, 'setup-breakdown', 'assets', 'skill-pack-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      release_version: string;
      skills: Array<{
        name: string;
        files: Array<{ path: string; sha256: string }>;
      }>;
    };
    expect(manifest.release_version).toBe(releaseVersion);
    expect(manifest.skills.map((skill) => skill.name)).toEqual(skillNames);
    for (const skill of manifest.skills) {
      const skillRoot = join(skillsRoot, skill.name);
      const actualFiles = (await listFiles(skillRoot)).filter(
        (path) => !(skill.name === 'setup-breakdown' && path === 'assets/skill-pack-manifest.json'),
      );
      expect(skill.files.map((file) => file.path)).toEqual(actualFiles);
      for (const file of skill.files) {
        const bytes = await readFile(join(skillRoot, file.path));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      }
    }
  });

  it('ships validator-accepted authoring examples', async () => {
    for (const fileName of ['minimal.yaml', 'fan-out-fan-in.yaml', 'verify-revise.yaml']) {
      const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-skill-example-'));
      temporaryDirectories.push(projectRoot);
      await cp(
        join(skillsRoot, 'author-breakdown', 'assets', fileName),
        join(projectRoot, 'breakdown.yaml'),
      );
      const result = await run(process.execPath, [
        join(workspaceRoot, 'packages', 'breakdown-cli', 'dist', 'index.js'),
        'workflow',
        'validate',
        '--project',
        projectRoot,
        '--json',
      ]);
      expect(
        result,
        `${fileName}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      ).toMatchObject({
        status: 0,
        stderr: '',
      });
    }
  });
});

describe('setup preflight executable', () => {
  it('verifies the release, CLI, optional MCP, filesystem, and disposable fixture', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-skill-preflight-'));
    temporaryDirectories.push(projectRoot);
    const before = await readdir(projectRoot);
    const result = await runPreflight(skillsRoot, projectRoot, [
      '--mode',
      'full',
      '--mcp-command',
      process.execPath,
      '--mcp-arg',
      join(workspaceRoot, 'packages', 'breakdown-mcp', 'dist', 'index.js'),
    ]);
    expect(result, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toMatchObject({
      status: 0,
      stderr: '',
    });
    const report = JSON.parse(result.stdout) as {
      classification: string;
      outcome: string;
      checks: Array<{ id: string; status: string }>;
    };
    expect(report.outcome).toBe('ready');
    expect(report.classification).toBe('Compatible Host');
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'skill_bytes', status: 'pass' }),
        expect.objectContaining({ id: 'node_version', status: 'pass' }),
        expect.objectContaining({ id: 'cli_version', status: 'pass' }),
        expect.objectContaining({ id: 'automation_schema', status: 'pass' }),
        expect.objectContaining({ id: 'mcp_version', status: 'pass' }),
        expect.objectContaining({ id: 'host_capability', status: 'pass' }),
        expect.objectContaining({ id: 'local_filesystem', status: 'pass' }),
        expect.objectContaining({ id: 'disposable_fixture', status: 'pass' }),
      ]),
    );
    expect(await readdir(projectRoot)).toEqual(before);
  });

  it('rejects a modified canonical skill byte', async () => {
    const copiedRoot = await mkdtemp(join(tmpdir(), 'breakdown-skill-pack-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-skill-project-'));
    temporaryDirectories.push(copiedRoot, projectRoot);
    for (const skillName of skillNames) {
      await cp(join(skillsRoot, skillName), join(copiedRoot, skillName), {
        recursive: true,
      });
    }
    const authorSkillPath = join(copiedRoot, 'author-breakdown', 'SKILL.md');
    await writeFile(
      authorSkillPath,
      `${await readFile(authorSkillPath, 'utf8')}\nmodified\n`,
      'utf8',
    );
    const result = await runPreflight(copiedRoot, projectRoot, ['--mode', 'full']);
    expect(result.status).toBe(3);
    const report = JSON.parse(result.stdout) as {
      classification: string | null;
      outcome: string;
      checks: Array<{ id: string; status: string }>;
    };
    expect(report.outcome).toBe('repair_required');
    expect(report.classification).toBeNull();
    expect(report.checks).toContainEqual(
      expect.objectContaining({ id: 'skill_bytes', status: 'fail' }),
    );
  });

  it('performs a read-only fast preflight for non-setup skills', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-skill-fast-'));
    temporaryDirectories.push(projectRoot);
    const before = await readdir(projectRoot);
    const result = await runPreflight(skillsRoot, projectRoot, [
      '--mode',
      'fast',
      '--skill',
      'author-breakdown',
    ]);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout) as {
      classification: string | null;
      outcome: string;
      checks: Array<{ id: string; status: string }>;
    };
    expect(report.outcome).toBe('ready');
    expect(report.classification).toBeNull();
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'skill_release', status: 'pass' }),
        expect.objectContaining({ id: 'node_version', status: 'pass' }),
        expect.objectContaining({ id: 'cli_version', status: 'pass' }),
        expect.objectContaining({ id: 'automation_schema', status: 'pass' }),
      ]),
    );
    expect(report.checks.map((check) => check.id)).not.toContain('host_capability');
    expect(report.checks.map((check) => check.id)).not.toContain('disposable_fixture');
    expect(await readdir(projectRoot)).toEqual(before);
  });
});

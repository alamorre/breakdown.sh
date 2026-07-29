import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { arch, platform, release, tmpdir, version } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const skillsRoot = join(workspaceRoot, 'local', 'skills');
const releaseVersion = '1.0.0-beta.1';
const skillNames = [
  'setup-breakdown',
  'author-breakdown',
  'critique-breakdown',
  'run-breakdown',
  'summarize-breakdown-run',
] as const;
const temporaryDirectories: string[] = [];

interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProcessResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      env: environment,
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
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProcessResult> {
  return run(
    process.execPath,
    [
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
    ],
    environment,
  );
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
    expect(
      (await readdir(skillsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort(),
    ).toEqual([...skillNames].sort());

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
    for (const skillName of skillNames.filter((name) => name !== 'setup-breakdown')) {
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

  it('pins the complete five-skill pack in every host installation command', async () => {
    const installation = await readFile(
      join(skillsRoot, 'setup-breakdown', 'references', 'installation.md'),
      'utf8',
    );
    const commands = installation
      .split('\n')
      .filter((line) => line.startsWith('npx --yes skills@'));
    expect(commands).toHaveLength(6);
    for (const command of commands) {
      for (const skillName of skillNames) {
        expect(command).toContain(`--skill ${skillName}`);
      }
    }
    expect(installation).toContain('five named skill directories');
  });

  it('defines guided execution and exact-Run summary behavior over versioned values', async () => {
    const runSkill = await readFile(join(skillsRoot, 'run-breakdown', 'SKILL.md'), 'utf8');
    const executionProtocol = await readFile(
      join(skillsRoot, 'run-breakdown', 'references', 'execution-protocol.md'),
      'utf8',
    );
    const summarySkill = await readFile(
      join(skillsRoot, 'summarize-breakdown-run', 'SKILL.md'),
      'utf8',
    );
    const summaryProtocol = await readFile(
      join(skillsRoot, 'summarize-breakdown-run', 'references', 'summary-protocol.md'),
      'utf8',
    );

    expect(runSkill).toContain('breakdown operate --project <absolute-root>');
    expect(runSkill).toContain('breakdown.operation-request.v1');
    expect(runSkill).toContain('breakdown.cli-output.v1');
    expect(runSkill).toContain('exact Run ID');
    expect(runSkill).toContain('Run Authority');
    expect(runSkill).toContain('fresh isolated');
    expect(runSkill).toContain('three');
    expect(runSkill).toContain('serialize');
    expect(runSkill).toContain('non-success');
    expect(runSkill).toContain('separate exact approval');
    expect(executionProtocol).toContain('validate_workflow');
    expect(executionProtocol).toContain('create_run');
    expect(executionProtocol).toContain('inspect_run');
    expect(executionProtocol).toContain('prepare_work');
    expect(executionProtocol).toContain('read_work_input');
    expect(executionProtocol).toContain('submit_candidate');
    expect(executionProtocol).toContain('lock_recovery');

    expect(summarySkill).toContain('exact Run ID');
    expect(summarySkill).toContain('terminal_results');
    expect(summarySkill).toContain('Re-inspect');
    expect(summarySkill).toContain('no durable');
    expect(summaryProtocol).toContain('Selected Terminal Results');
    expect(summaryProtocol).toContain('stale');
    expect(summaryProtocol).toContain('failed');
    expect(summaryProtocol).toContain('blocked');
    expect(summaryProtocol).toContain('cancelled');
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

  it('should call only the exact indexed host/version/OS/transport row Supported', async () => {
    const copiedRoot = await mkdtemp(join(tmpdir(), 'breakdown-supported-skill-pack-'));
    const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-supported-project-'));
    temporaryDirectories.push(copiedRoot, projectRoot);
    for (const skillName of skillNames) {
      await cp(join(skillsRoot, skillName), join(copiedRoot, skillName), {
        recursive: true,
      });
    }
    const candidateDirectory = await mkdtemp(join(tmpdir(), 'breakdown-supported-candidate-'));
    const fakeGhDirectory = await mkdtemp(join(tmpdir(), 'breakdown-supported-gh-'));
    temporaryDirectories.push(candidateDirectory, fakeGhDirectory);
    const artifactDefinitions = [
      {
        file: `breakdown-skills-${releaseVersion}.tar.gz`,
        role: 'skills-archive',
        bytes: Buffer.from('exact skill archive'),
      },
      {
        file: `breakdown-sh-core-${releaseVersion}.tgz`,
        role: 'core-library',
        bytes: Buffer.from('exact core package'),
      },
      {
        file: `breakdown-sh-cli-${releaseVersion}.tgz`,
        role: 'command-line-interface',
        bytes: Buffer.from('exact CLI package'),
      },
      {
        file: `breakdown-sh-mcp-${releaseVersion}.tgz`,
        role: 'mcp-adapter',
        bytes: Buffer.from('exact MCP package'),
      },
    ].map((artifact) => ({
      ...artifact,
      sha256: createHash('sha256').update(artifact.bytes).digest('hex'),
    }));
    for (const artifact of artifactDefinitions) {
      await writeFile(join(candidateDirectory, artifact.file), artifact.bytes);
    }
    const subjects = artifactDefinitions.map((artifact) => ({
      name: artifact.file,
      digest: { sha256: artifact.sha256 },
    }));
    const candidateDigest = createHash('sha256')
      .update(
        `${subjects
          .map((subject) => `${subject.digest.sha256}  ${subject.name}`)
          .sort()
          .join('\n')}\n`,
      )
      .digest('hex');
    const candidateIdentity = { algorithm: 'SHA-256', content: candidateDigest };
    const provenanceFile = `breakdown-provenance-inputs-${releaseVersion}.json`;
    const installedManifestPath = join(
      copiedRoot,
      'setup-breakdown',
      'assets',
      'skill-pack-manifest.json',
    );
    await writeFile(
      join(candidateDirectory, provenanceFile),
      `${JSON.stringify({
        schema_version: 'breakdown.provenance-inputs.v1',
        release_version: releaseVersion,
        source: {
          repository: 'https://github.com/alamorre/breakdown.sh',
          git_commit: '1'.repeat(40),
          source_inputs: [
            {
              path: 'local/skills/setup-breakdown/assets/skill-pack-manifest.json',
              sha256: createHash('sha256')
                .update(await readFile(installedManifestPath))
                .digest('hex'),
            },
          ],
        },
        builder: {
          environment: {
            candidate_digest: candidateIdentity,
          },
        },
        subjects,
      })}\n`,
    );
    const provenanceSha256 = createHash('sha256')
      .update(await readFile(join(candidateDirectory, provenanceFile)))
      .digest('hex');
    const candidate = {
      digest: candidateIdentity,
      provenance_inputs: {
        file: provenanceFile,
        sha256: provenanceSha256,
      },
      skill_archive: {
        file: artifactDefinitions[0].file,
        sha256: artifactDefinitions[0].sha256,
      },
      packages: artifactDefinitions.slice(1).map((artifact) => ({
        file: artifact.file,
        sha256: artifact.sha256,
      })),
    };
    await writeFile(
      join(candidateDirectory, `breakdown-release-${releaseVersion}.json`),
      `${JSON.stringify({
        schema_version: 'breakdown.release-manifest.v1',
        release_version: releaseVersion,
        artifacts: [
          ...artifactDefinitions.map((artifact) => ({
            file: artifact.file,
            role: artifact.role,
            hashes: { sha256: artifact.sha256 },
          })),
          {
            file: provenanceFile,
            role: 'provenance-inputs',
            hashes: { sha256: provenanceSha256 },
          },
        ],
        platform_conformance: {
          current_build: {
            candidate_digest: candidate.digest,
          },
        },
      })}\n`,
    );
    const operatingSystems = [
      {
        family: 'linux',
        platform: 'linux',
        name: 'Linux',
        release: platform() === 'linux' ? release() : '6.8.0',
        version: platform() === 'linux' ? version() : '#1 SMP',
        architecture: platform() === 'linux' ? arch() : 'x64',
      },
      {
        family: 'macos',
        platform: 'darwin',
        name: 'macOS',
        release: platform() === 'darwin' ? release() : '25.0.0',
        version: platform() === 'darwin' ? version() : 'Darwin Kernel Version 25.0.0',
        architecture: platform() === 'darwin' ? arch() : 'arm64',
      },
      {
        family: 'windows',
        platform: 'win32',
        name: 'Windows',
        release: platform() === 'win32' ? release() : '10.0.26100',
        version: platform() === 'win32' ? version() : 'Windows 11 Pro',
        architecture: platform() === 'win32' ? arch() : 'x64',
      },
    ];
    const rows = operatingSystems.map((operatingSystem, index) => ({
      host: {
        surface: 'test-harness',
        version: '1.0.0',
      },
      operating_system: operatingSystem,
      transport: 'cli',
      breakdown_version: releaseVersion,
      model: {
        provider_family: 'provider-a',
        model_family: index === 0 ? 'model-a' : 'model-b',
      },
      candidate,
      status: 'passed',
      evidence: {
        artifact_name: `breakdown-host-evidence-test-${index}`,
        mechanism: 'github-actions-artifact-v7',
        workflow_run_id: String(12345 + index),
        workflow_run_attempt: '1',
        file_sha256: String(index + 6).repeat(64),
      },
    }));
    const supportedHosts = rows.map((row) => ({
      surface: row.host.surface,
      version: row.host.version,
      os: row.operating_system.platform,
      os_name: row.operating_system.name,
      os_release: row.operating_system.release,
      os_version: row.operating_system.version,
      architecture: row.operating_system.architecture,
      transport: row.transport,
      breakdown_version: row.breakdown_version,
      status: 'pass',
      artifact_digests: {
        candidate: row.candidate.digest,
        provenance_inputs: row.candidate.provenance_inputs,
        skill_archive: row.candidate.skill_archive,
        packages: row.candidate.packages,
      },
      evidence: row.evidence,
    }));
    const indexPath = join(copiedRoot, 'breakdown-host-evidence-index.json');
    const hostEvidenceIndex = {
      schema_version: 'breakdown.guided-host-evidence-index.v1',
      release_version: releaseVersion,
      status: 'passed',
      candidate_digest: candidate.digest,
      source: {
        repository: 'https://github.com/alamorre/breakdown.sh',
        git_commit: '1'.repeat(40),
      },
      coverage: {
        guided_cli_operating_systems: ['linux', 'macos', 'windows'],
        model_families: ['model-a', 'model-b'],
        provider_families: ['provider-a'],
      },
      rows,
      supported_hosts: supportedHosts,
      gate: { satisfied: true },
    };
    await writeFile(indexPath, `${JSON.stringify(hostEvidenceIndex, null, 2)}\n`);
    const attestationBundlePath = join(copiedRoot, 'host-evidence-attestation.json');
    const ghArgumentsLog = join(copiedRoot, 'gh-arguments.json');
    await writeFile(attestationBundlePath, '{}\n');
    const fakeGhSource = `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.GH_ARGUMENTS_LOG, JSON.stringify(process.argv.slice(2)));
if (process.env.GH_ATTESTATION_FAIL === 'true') {
  process.stderr.write('synthetic attestation rejection\\n');
  process.exit(1);
}
process.stdout.write('[{"verificationResult":{}}]\\n');
`;
    await writeFile(join(fakeGhDirectory, 'gh'), fakeGhSource);
    await writeFile(join(fakeGhDirectory, 'gh.mjs'), fakeGhSource);
    await writeFile(join(fakeGhDirectory, 'gh.cmd'), '@node "%~dp0gh.mjs" %*\r\n');
    await chmod(join(fakeGhDirectory, 'gh'), 0o755);
    const preflightEnvironment = {
      ...process.env,
      GH_ARGUMENTS_LOG: ghArgumentsLog,
      PATH: `${fakeGhDirectory}${delimiter}${process.env.PATH ?? ''}`,
    };
    const hostEvidenceArguments = [
      '--host-evidence-index',
      indexPath,
      '--host-evidence-bundle',
      attestationBundlePath,
      '--candidate-directory',
      candidateDirectory,
    ];

    const supported = await runPreflight(
      copiedRoot,
      projectRoot,
      ['--mode', 'full', ...hostEvidenceArguments],
      preflightEnvironment,
    );
    expect(supported.status, supported.stderr).toBe(0);
    expect(JSON.parse(supported.stdout)).toMatchObject({
      classification: 'Supported Host',
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'host_evidence_attestation', status: 'pass' }),
        expect.objectContaining({ id: 'candidate_binding', status: 'pass' }),
        expect.objectContaining({ id: 'host_evidence_index', status: 'pass' }),
      ]),
      host: {
        os: platform(),
        os_release: release(),
        os_version: version(),
      },
    });
    expect(JSON.parse(await readFile(ghArgumentsLog, 'utf8'))).toEqual([
      'attestation',
      'verify',
      indexPath,
      '--bundle',
      attestationBundlePath,
      '--repo',
      'alamorre/breakdown.sh',
      '--signer-workflow',
      'alamorre/breakdown.sh/.github/workflows/local-host-support.yml',
      '--source-ref',
      `refs/tags/breakdown-local-v${releaseVersion}`,
      '--source-digest',
      '1'.repeat(40),
      '--format',
      'json',
    ]);

    const currentRowIndex = rows.findIndex((row) => row.operating_system.platform === platform());
    rows[currentRowIndex].operating_system.release = 'different-release';
    supportedHosts[currentRowIndex].os_release = 'different-release';
    await writeFile(indexPath, `${JSON.stringify(hostEvidenceIndex, null, 2)}\n`);
    const compatible = await runPreflight(
      copiedRoot,
      projectRoot,
      ['--mode', 'full', ...hostEvidenceArguments],
      preflightEnvironment,
    );
    expect(compatible.status, compatible.stderr).toBe(0);
    expect(JSON.parse(compatible.stdout)).toMatchObject({
      classification: 'Compatible Host',
    });

    const unauthenticated = await runPreflight(
      copiedRoot,
      projectRoot,
      ['--mode', 'full', ...hostEvidenceArguments],
      { ...preflightEnvironment, GH_ATTESTATION_FAIL: 'true' },
    );
    expect(unauthenticated.status).toBe(3);
    expect(JSON.parse(unauthenticated.stdout)).toMatchObject({
      outcome: 'repair_required',
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'host_evidence_attestation', status: 'fail' }),
      ]),
    });

    supportedHosts[currentRowIndex].os_release = 'hand-edited-release';
    await writeFile(indexPath, `${JSON.stringify(hostEvidenceIndex, null, 2)}\n`);
    const invalidIndex = await runPreflight(
      copiedRoot,
      projectRoot,
      ['--mode', 'full', ...hostEvidenceArguments],
      preflightEnvironment,
    );
    expect(invalidIndex.status).toBe(3);
    expect(JSON.parse(invalidIndex.stdout)).toMatchObject({
      outcome: 'repair_required',
      checks: expect.arrayContaining([
        {
          id: 'skill_bytes',
          status: 'pass',
          detail: 'Canonical payload digests and inventory match.',
        },
        {
          id: 'host_evidence_index',
          status: 'fail',
          detail: 'host evidence index is invalid, failing, or mismatched',
        },
      ]),
    });

    supportedHosts[currentRowIndex].os_release = rows[currentRowIndex].operating_system.release;
    await writeFile(indexPath, `${JSON.stringify(hostEvidenceIndex, null, 2)}\n`);
    await writeFile(
      join(candidateDirectory, artifactDefinitions[2].file),
      'different same-version CLI package',
    );
    const mismatchedCandidate = await runPreflight(
      copiedRoot,
      projectRoot,
      ['--mode', 'full', ...hostEvidenceArguments],
      preflightEnvironment,
    );
    expect(mismatchedCandidate.status).toBe(3);
    expect(JSON.parse(mismatchedCandidate.stdout)).toMatchObject({
      outcome: 'repair_required',
      checks: expect.arrayContaining([
        expect.objectContaining({ id: 'candidate_binding', status: 'fail' }),
      ]),
    });
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

  it('performs a read-only fast preflight for every non-setup skill', async () => {
    for (const skillName of skillNames.filter((name) => name !== 'setup-breakdown')) {
      const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-skill-fast-'));
      temporaryDirectories.push(projectRoot);
      const before = await readdir(projectRoot);
      const result = await runPreflight(skillsRoot, projectRoot, [
        '--mode',
        'fast',
        '--skill',
        skillName,
      ]);
      expect(result.status, `${skillName}\n${result.stdout}\n${result.stderr}`).toBe(0);
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
    }
  });
});

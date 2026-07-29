#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { arch, platform } from 'node:os';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_VERSION = '1.0.0-beta.1';
const AUTOMATION_SCHEMA_VERSION = 'breakdown.operation-request.v1';
const CLI_OUTPUT_SCHEMA_VERSION = 'breakdown.cli-output.v1';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SETUP_SKILL_ROOT = resolve(dirname(SCRIPT_PATH), '..');
const DEFAULT_SKILLS_ROOT = dirname(SETUP_SKILL_ROOT);
const MANIFEST_PATH = join(SETUP_SKILL_ROOT, 'assets', 'skill-pack-manifest.json');
const FIXTURE_PATH = join(SETUP_SKILL_ROOT, 'assets', 'preflight-project', 'breakdown.yaml');
const EXPECTED_SKILL_NAMES = [
  'setup-breakdown',
  'author-breakdown',
  'critique-breakdown',
  'run-breakdown',
  'summarize-breakdown-run',
];
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const PROCESS_TIMEOUT_MS = 10_000;
const USAGE = `Usage:
  node preflight.mjs --mode full --project ABSOLUTE_PATH --host SURFACE --host-version VERSION [--cli-command COMMAND] [--cli-arg ARG]... [--mcp-command COMMAND] [--mcp-arg ARG]...
  node preflight.mjs --mode fast --skill SKILL_NAME --project ABSOLUTE_PATH --host SURFACE --host-version VERSION [--cli-command COMMAND] [--cli-arg ARG]... [--mcp-command COMMAND] [--mcp-arg ARG]...
`;

function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  const values = {
    mode: undefined,
    skill: undefined,
    project: undefined,
    host: undefined,
    hostVersion: undefined,
    cliCommand: 'breakdown',
    cliArgs: [],
    mcpCommand: undefined,
    mcpArgs: [],
  };
  const scalarFlags = new Map([
    ['--mode', 'mode'],
    ['--skill', 'skill'],
    ['--project', 'project'],
    ['--host', 'host'],
    ['--host-version', 'hostVersion'],
    ['--cli-command', 'cliCommand'],
    ['--mcp-command', 'mcpCommand'],
  ]);
  const seen = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === '--cli-arg' || flag === '--mcp-arg') {
      if (value === undefined) return undefined;
      values[flag === '--cli-arg' ? 'cliArgs' : 'mcpArgs'].push(value);
      index += 1;
      continue;
    }
    const field = scalarFlags.get(flag);
    if (field === undefined || seen.has(flag) || value === undefined || value.length === 0) {
      return undefined;
    }
    values[field] = value;
    seen.add(flag);
    index += 1;
  }
  if (
    (values.mode !== 'full' && values.mode !== 'fast') ||
    values.project === undefined ||
    values.host === undefined ||
    values.hostVersion === undefined ||
    values.cliCommand.length === 0 ||
    !isAbsolute(values.project) ||
    (values.mode === 'fast' && values.skill === undefined) ||
    (values.mode === 'full' && values.skill !== undefined) ||
    (values.mcpCommand === undefined && values.mcpArgs.length > 0)
  ) {
    return undefined;
  }
  return values;
}

function resultCheck(id, status, detail) {
  return { id, status, detail };
}

function machineReport({ classification, outcome, host, checks, mode, transport }) {
  return {
    schema_version: 'breakdown.skill-preflight.v1',
    release_version: RELEASE_VERSION,
    mode,
    outcome,
    classification,
    host: {
      surface: host.host,
      version: host.hostVersion,
      os: platform(),
      architecture: arch(),
      transport,
    },
    checks,
  };
}

function writeReport(report, exitCode) {
  process.stdout.write(`${JSON.stringify(report)}\n`);
  process.exitCode = exitCode;
}

function runProcess(command, args, input) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(command, args, {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolveResult({
        status: null,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult({
        status: null,
        stdout,
        stderr,
        error: error.message,
      });
    });
    child.once('close', (status) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult({ status, stdout, stderr });
    });
    child.stdin.on('error', () => {
      // A failed process can close stdin before the request is written.
    });
    child.stdin.end(input);
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill();
      settled = true;
      resolveResult({
        status: null,
        stdout,
        stderr,
        error: `process timed out after ${PROCESS_TIMEOUT_MS}ms`,
      });
    }, PROCESS_TIMEOUT_MS);
  });
}

function initializeMcp(command, args) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(command, args, {
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (error) {
      resolveResult({
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.kill();
      resolveResult(value);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const lines = stdout.split('\n');
      for (const line of lines.slice(0, -1)) {
        try {
          const message = JSON.parse(line);
          if (message?.jsonrpc === '2.0' && message?.id === 1) {
            finish({ response: message, stderr });
            return;
          }
        } catch {
          finish({ error: 'MCP stdout contained a non-JSON message.', stderr });
          return;
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', (error) => finish({ error: error.message, stderr }));
    child.once('close', (status) => {
      finish({
        error: `MCP process exited before initialization completed (status ${String(status)}).`,
        stderr,
      });
    });
    child.stdin.on('error', () => {
      // Process termination is reported by error/close.
    });
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: {
            name: 'breakdown-setup-preflight',
            version: RELEASE_VERSION,
          },
        },
      })}\n`,
    );
    const timeout = setTimeout(
      () =>
        finish({ error: `MCP initialization timed out after ${PROCESS_TIMEOUT_MS}ms.`, stderr }),
      PROCESS_TIMEOUT_MS,
    );
  });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function listPayloadFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const paths = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(current, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await listPayloadFiles(root, absolutePath)));
    } else if (entry.isFile()) {
      paths.push(relative(root, absolutePath).split(sep).join('/'));
    } else {
      throw new Error(`non-regular skill payload entry: ${relative(root, absolutePath)}`);
    }
  }
  return paths;
}

function skillRelease(source) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  if (match === null) return undefined;
  const versionMatch = /^  breakdown-sh\.version: ["']([^"']+)["']$/m.exec(match[1]);
  return versionMatch?.[1];
}

async function readManifest() {
  const manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
  if (
    manifest?.schema_version !== 'breakdown.skill-pack-manifest.v1' ||
    manifest?.release_version !== RELEASE_VERSION ||
    !Array.isArray(manifest.skills) ||
    !Array.isArray(manifest.supported_hosts) ||
    manifest.skills.length !== EXPECTED_SKILL_NAMES.length ||
    manifest.skills.some((skill, index) => skill?.name !== EXPECTED_SKILL_NAMES[index])
  ) {
    throw new Error('embedded skill-pack manifest is invalid or mismatched');
  }
  return manifest;
}

async function verifySkillBytes(manifest) {
  for (const skill of manifest.skills) {
    if (
      typeof skill?.name !== 'string' ||
      !Array.isArray(skill.files) ||
      skill.files.some(
        (file) =>
          typeof file?.path !== 'string' ||
          typeof file?.sha256 !== 'string' ||
          !/^[a-f0-9]{64}$/.test(file.sha256),
      )
    ) {
      throw new Error('embedded skill file inventory is invalid');
    }
    const skillRoot = join(DEFAULT_SKILLS_ROOT, skill.name);
    const actualPaths = (await listPayloadFiles(skillRoot)).filter(
      (path) => !(skill.name === 'setup-breakdown' && path === 'assets/skill-pack-manifest.json'),
    );
    const expectedPaths = skill.files.map((file) => file.path);
    if (
      actualPaths.length !== expectedPaths.length ||
      actualPaths.some((path, index) => path !== expectedPaths[index])
    ) {
      throw new Error(`skill payload inventory mismatch: ${skill.name}`);
    }
    for (const file of skill.files) {
      const actualHash = sha256(await readFile(join(skillRoot, file.path)));
      if (actualHash !== file.sha256) {
        throw new Error(`skill payload digest mismatch: ${skill.name}/${file.path}`);
      }
    }
    const release = skillRelease(await readFile(join(skillRoot, 'SKILL.md'), 'utf8'));
    if (release !== RELEASE_VERSION) {
      throw new Error(`skill release mismatch: ${skill.name}`);
    }
  }
}

async function verifyFastSkill(skillName, manifest) {
  const skill = manifest.skills.find((entry) => entry.name === skillName);
  if (skill === undefined) throw new Error(`skill is not in this release: ${skillName}`);
  const skillPath = join(DEFAULT_SKILLS_ROOT, skillName, 'SKILL.md');
  const entry = await lstat(skillPath);
  if (!entry.isFile()) throw new Error(`skill entrypoint is not a regular file: ${skillName}`);
  const release = skillRelease(await readFile(skillPath, 'utf8'));
  if (release !== RELEASE_VERSION) throw new Error(`skill release mismatch: ${skillName}`);
}

async function checkCliVersion(cli) {
  const result = await runProcess(cli.command, [...cli.args, '--version']);
  const actual = result.stdout.trim();
  if (
    result.error !== undefined ||
    result.status !== 0 ||
    result.stderr.length !== 0 ||
    !SEMVER_PATTERN.test(actual) ||
    actual !== RELEASE_VERSION
  ) {
    throw new Error(
      result.error ??
        `expected CLI ${RELEASE_VERSION}; received status ${String(result.status)}, version ${JSON.stringify(actual)}`,
    );
  }
}

async function invokeAutomation(cli, projectRoot) {
  const result = await runProcess(
    cli.command,
    [...cli.args, 'operate', '--project', projectRoot],
    `${JSON.stringify({
      schema_version: AUTOMATION_SCHEMA_VERSION,
      operation: 'validate_workflow',
    })}\n`,
  );
  if (result.error !== undefined || result.stdout.length === 0) {
    throw new Error(result.error ?? 'CLI emitted no automation response');
  }
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    throw new Error('CLI automation stdout was not one JSON document');
  }
  if (
    envelope?.schema_version !== CLI_OUTPUT_SCHEMA_VERSION ||
    envelope?.operation !== 'validate_workflow' ||
    typeof envelope?.ok !== 'boolean'
  ) {
    throw new Error('CLI automation envelope schema did not match this release');
  }
  return envelope;
}

function matchingSupportedRow(manifest, options, transport) {
  return manifest.supported_hosts.some(
    (row) =>
      row?.surface === options.host &&
      row?.version === options.hostVersion &&
      row?.os === platform() &&
      row?.architecture === arch() &&
      row?.transport === transport &&
      row?.status === 'pass',
  );
}

async function validateProjectRoot(projectRoot) {
  const root = await realpath(projectRoot);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error('the selected project root is not a directory');
  if (root === parse(root).root) {
    throw new Error('a filesystem root cannot be selected as the project root');
  }
  return root;
}

async function runDisposableFixture(cli, selectedRoot) {
  let probeRoot;
  try {
    probeRoot = await mkdtemp(join(selectedRoot, '.breakdown-preflight-'));
    const canonicalProbeRoot = await realpath(probeRoot);
    if (
      dirname(canonicalProbeRoot) !== selectedRoot ||
      !canonicalProbeRoot.startsWith(`${selectedRoot}${sep}.breakdown-preflight-`)
    ) {
      throw new Error('the disposable probe directory escaped the selected project root');
    }
    await writeFile(join(canonicalProbeRoot, 'breakdown.yaml'), await readFile(FIXTURE_PATH), {
      mode: 0o600,
    });
    return await invokeAutomation(cli, canonicalProbeRoot);
  } finally {
    if (
      probeRoot !== undefined &&
      dirname(probeRoot) === selectedRoot &&
      probeRoot.startsWith(`${selectedRoot}${sep}.breakdown-preflight-`)
    ) {
      await rm(probeRoot, { recursive: true, force: true });
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options?.help === true) {
    process.stdout.write(USAGE);
    return;
  }
  if (options === undefined) {
    process.stderr.write(USAGE);
    process.exitCode = 2;
    return;
  }

  const checks = [];
  let unsupported = false;
  let repairRequired = false;
  let inconclusive = false;
  let manifest;
  let selectedRoot;
  const transport = options.mcpCommand === undefined ? 'cli' : 'mcp';
  const cli = {
    command: options.cliCommand,
    args: options.cliArgs,
  };

  try {
    selectedRoot = await validateProjectRoot(options.project);
    checks.push(
      resultCheck('project_root', 'pass', 'Explicit absolute project root is accessible.'),
    );
  } catch (error) {
    checks.push(
      resultCheck(
        'project_root',
        'inconclusive',
        error instanceof Error ? error.message : String(error),
      ),
    );
    inconclusive = true;
  }

  try {
    manifest = await readManifest();
    if (options.mode === 'full') {
      await verifySkillBytes(manifest);
      checks.push(
        resultCheck('skill_bytes', 'pass', 'Canonical payload digests and inventory match.'),
      );
    } else {
      await verifyFastSkill(options.skill, manifest);
      checks.push(resultCheck('skill_release', 'pass', 'Skill release marker matches.'));
    }
  } catch (error) {
    checks.push(
      resultCheck(
        options.mode === 'full' ? 'skill_bytes' : 'skill_release',
        'fail',
        error instanceof Error ? error.message : String(error),
      ),
    );
    repairRequired = true;
  }

  const nodeVersion = process.versions.node;
  if (SEMVER_PATTERN.test(nodeVersion) && Number(nodeVersion.split('.')[0]) === 24) {
    checks.push(resultCheck('node_version', 'pass', `Node ${nodeVersion}.`));
  } else {
    checks.push(resultCheck('node_version', 'fail', `Node 24 is required; found ${nodeVersion}.`));
    unsupported = true;
  }

  try {
    await checkCliVersion(cli);
    checks.push(resultCheck('cli_version', 'pass', `CLI ${RELEASE_VERSION}.`));
  } catch (error) {
    checks.push(
      resultCheck('cli_version', 'fail', error instanceof Error ? error.message : String(error)),
    );
    repairRequired = true;
  }

  if (selectedRoot !== undefined) {
    try {
      await invokeAutomation(cli, selectedRoot);
      checks.push(
        resultCheck(
          'automation_schema',
          'pass',
          `${AUTOMATION_SCHEMA_VERSION} request and ${CLI_OUTPUT_SCHEMA_VERSION} response.`,
        ),
      );
    } catch (error) {
      checks.push(
        resultCheck(
          'automation_schema',
          'fail',
          error instanceof Error ? error.message : String(error),
        ),
      );
      repairRequired = true;
    }
  } else {
    checks.push(resultCheck('automation_schema', 'inconclusive', 'Project root was unavailable.'));
  }

  if (options.mcpCommand !== undefined) {
    const initialized = await initializeMcp(options.mcpCommand, options.mcpArgs);
    const actualVersion = initialized.response?.result?.serverInfo?.version;
    if (
      initialized.error === undefined &&
      initialized.stderr.length === 0 &&
      SEMVER_PATTERN.test(actualVersion ?? '') &&
      actualVersion === RELEASE_VERSION
    ) {
      checks.push(resultCheck('mcp_version', 'pass', `MCP ${RELEASE_VERSION}.`));
    } else {
      checks.push(
        resultCheck(
          'mcp_version',
          'fail',
          initialized.error ??
            `expected MCP ${RELEASE_VERSION}; received ${JSON.stringify(actualVersion)}`,
        ),
      );
      repairRequired = true;
    }
  }

  if (options.mode === 'full') {
    if (selectedRoot === undefined) {
      checks.push(resultCheck('local_filesystem', 'inconclusive', 'Project root was unavailable.'));
      checks.push(
        resultCheck('disposable_fixture', 'inconclusive', 'Project root was unavailable.'),
      );
      inconclusive = true;
    } else {
      try {
        const envelope = await runDisposableFixture(cli, selectedRoot);
        if (
          envelope.ok === false &&
          envelope.error?.kind === 'unsupported' &&
          envelope.error?.code === 'unsupported_filesystem'
        ) {
          checks.push(
            resultCheck(
              'local_filesystem',
              'fail',
              'The core rejected the selected local filesystem.',
            ),
          );
          checks.push(
            resultCheck(
              'disposable_fixture',
              'fail',
              'The fixture could not run on an unsupported filesystem.',
            ),
          );
          unsupported = true;
        } else if (envelope.ok === true) {
          checks.push(
            resultCheck(
              'local_filesystem',
              'pass',
              'The core accepted the selected filesystem for the disposable fixture.',
            ),
          );
          checks.push(
            resultCheck(
              'disposable_fixture',
              'pass',
              'The bundled Workflow Definition validated and its probe directory was removed.',
            ),
          );
        } else {
          checks.push(
            resultCheck(
              'local_filesystem',
              'pass',
              'The core reached deterministic fixture validation on the selected filesystem.',
            ),
          );
          checks.push(
            resultCheck(
              'disposable_fixture',
              'fail',
              `Fixture validation failed with ${String(envelope.error?.code ?? 'unknown')}.`,
            ),
          );
          repairRequired = true;
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        checks.push(resultCheck('local_filesystem', 'inconclusive', detail));
        checks.push(resultCheck('disposable_fixture', 'inconclusive', detail));
        inconclusive = true;
      }
    }

    if (unsupported) {
      checks.push(
        resultCheck(
          'host_capability',
          'fail',
          'A mandatory runtime or filesystem capability failed.',
        ),
      );
    } else if (repairRequired || inconclusive) {
      checks.push(
        resultCheck(
          'host_capability',
          'inconclusive',
          repairRequired
            ? 'Host qualification requires one exact repaired release set.'
            : 'Host qualification could not establish every required capability.',
        ),
      );
    } else {
      checks.push(
        resultCheck(
          'host_capability',
          'pass',
          'The active setup skill and successful process, project, filesystem, fixture, and selected transport checks establish the guided-host capabilities.',
        ),
      );
    }
  }

  let classification = null;
  let outcome = 'inconclusive';
  let exitCode = 8;
  if (unsupported) {
    outcome = 'unsupported';
    if (options.mode === 'full') classification = 'Unsupported';
    exitCode = 5;
  } else if (repairRequired) {
    outcome = 'repair_required';
    exitCode = 3;
  } else if (!inconclusive && manifest !== undefined) {
    outcome = 'ready';
    if (options.mode === 'full') {
      classification = matchingSupportedRow(manifest, options, transport)
        ? 'Supported Host'
        : 'Compatible Host';
    }
    exitCode = 0;
  }
  writeReport(
    machineReport({
      classification,
      outcome,
      host: options,
      checks,
      mode: options.mode,
      transport,
    }),
    exitCode,
  );
}

await main();

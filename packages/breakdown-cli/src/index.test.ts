import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
const temporaryDirectories: string[] = [];
let breakdownExecutable: string;
let installationRoot: string;
let cliCoverageRoot: string;

interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(
  executable: string,
  args: string[],
  cwd = workspaceRoot,
  extraEnvironment: NodeJS.ProcessEnv = {},
  stdin?: string | Buffer,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: {
        ...process.env,
        ...extraEnvironment,
      },
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
    child.stdin.end(stdin);
    child.once('error', reject);
    child.once('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function runBreakdown(
  args: string[],
  cwd = workspaceRoot,
  stdin?: string | Buffer,
  extraEnvironment: NodeJS.ProcessEnv = {},
) {
  return run(
    breakdownExecutable,
    args,
    cwd,
    {
      NODE_V8_COVERAGE: cliCoverageRoot,
      ...extraEnvironment,
    },
    stdin,
  );
}

function runOperate(projectRoot: string, request: Record<string, unknown>) {
  return runBreakdown(
    ['operate', '--project', projectRoot],
    workspaceRoot,
    `${JSON.stringify({
      schema_version: 'breakdown.operation-request.v1',
      ...request,
    })}\n`,
  );
}

function runBreakdownInDarwinTerminal(
  projectRoot: string,
  extraEnvironment: NodeJS.ProcessEnv = {},
) {
  return run(
    '/usr/bin/expect',
    [
      '-c',
      'set timeout 30; spawn -noecho $env(BREAKDOWN_EXECUTABLE) workflow validate --project $env(BREAKDOWN_PROJECT); expect eof; catch wait result; exit [lindex $result 3]',
    ],
    workspaceRoot,
    {
      BREAKDOWN_EXECUTABLE: breakdownExecutable,
      BREAKDOWN_PROJECT: projectRoot,
      NODE_V8_COVERAGE: cliCoverageRoot,
      TERM: 'xterm-256color',
      ...extraEnvironment,
    },
  );
}

function runBreakdownAfterSignal(
  projectRoot: string,
  request: Record<string, unknown>,
  signal: NodeJS.Signals,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(breakdownExecutable, ['operate', '--project', projectRoot], {
      cwd: workspaceRoot,
      env: {
        ...process.env,
        NODE_V8_COVERAGE: cliCoverageRoot,
      },
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
    child.stdin.on('error', () => {
      // An implementation without signal handling may close stdin before the test writes.
    });
    child.once('error', reject);
    child.once('close', (status) => {
      resolve({ status, stdout, stderr });
    });
    setTimeout(() => {
      child.kill(signal);
      setTimeout(() => {
        child.stdin.end(
          JSON.stringify({
            schema_version: 'breakdown.operation-request.v1',
            ...request,
          }),
        );
      }, 10);
    }, 100);
  });
}

function expectSuccess(result: ProcessResult) {
  expect(result, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toMatchObject({
    status: 0,
    stderr: '',
  });
}

async function createProject(
  workflow = `schema_version: breakdown.workflow.v1
id: research
name: Research
nodes:
  - id: investigate
    name: Investigate
    prompt: Gather the relevant evidence.
`,
) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-cli-project-'));
  temporaryDirectories.push(projectRoot);
  await writeFile(join(projectRoot, 'breakdown.yaml'), workflow, 'utf8');
  return projectRoot;
}

interface V8CoverageRange {
  startOffset: number;
  endOffset: number;
  count: number;
}

interface V8CoverageFile {
  result: Array<{
    url: string;
    functions: Array<{
      ranges: V8CoverageRange[];
    }>;
  }>;
}

async function installedCliLineCoverage() {
  const installedCliPath = join(
    installationRoot,
    'node_modules',
    '@breakdown-sh',
    'cli',
    'dist',
    'index.js',
  );
  const canonicalInstalledCliPath = await realpath(installedCliPath);
  const installedCliUrl = pathToFileURL(canonicalInstalledCliPath).href;
  const source = await readFile(canonicalInstalledCliPath, 'utf8');
  const coveredCharacters = new Uint8Array(source.length);
  const observedUrls = new Set<string>();
  let matchedCoverage = false;

  for (const coverageFile of await readdir(cliCoverageRoot)) {
    const coverage = JSON.parse(
      await readFile(join(cliCoverageRoot, coverageFile), 'utf8'),
    ) as V8CoverageFile;
    coverage.result.forEach((entry) => observedUrls.add(entry.url));
    const script = coverage.result.find((entry) => entry.url === installedCliUrl);
    if (script === undefined) continue;
    matchedCoverage = true;

    const processCoverage = new Uint8Array(source.length);
    const ranges = script.functions
      .flatMap((fn) => fn.ranges)
      .sort(
        (left, right) => right.endOffset - right.startOffset - (left.endOffset - left.startOffset),
      );
    for (const range of ranges) {
      processCoverage.fill(range.count > 0 ? 1 : 0, range.startOffset, range.endOffset);
    }
    processCoverage.forEach((covered, index) => {
      if (covered === 1) coveredCharacters[index] = 1;
    });
  }

  if (!matchedCoverage) {
    const relevantUrls = [...observedUrls].filter((url) =>
      url.includes('@breakdown-sh/cli/dist/index.js'),
    );
    throw new Error(
      `No V8 coverage matched ${installedCliUrl}. Observed: ${relevantUrls.join(', ')}`,
    );
  }

  let offset = 0;
  let executableLines = 0;
  let coveredLines = 0;
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && !trimmed.startsWith('#!')) {
      executableLines += 1;
      const lineCoverage = coveredCharacters.slice(offset, offset + line.length);
      if (lineCoverage.includes(1)) coveredLines += 1;
    }
    offset += line.length + 1;
  }

  return coveredLines / executableLines;
}

beforeAll(async () => {
  installationRoot = await mkdtemp(join(tmpdir(), 'breakdown-cli-install-'));
  temporaryDirectories.push(installationRoot);
  const tarballRoot = join(installationRoot, 'tarballs');
  await mkdir(tarballRoot);
  cliCoverageRoot = join(installationRoot, 'coverage');
  await mkdir(cliCoverageRoot);

  const coreTarball = join(tarballRoot, 'core.tgz');
  const cliTarball = join(tarballRoot, 'cli.tgz');
  const yamlTarball = join(tarballRoot, 'yaml.tgz');
  const corePackageRoot = join(workspaceRoot, 'packages', 'breakdown-core');
  const cliPackageRoot = join(workspaceRoot, 'packages', 'breakdown-cli');
  const requireFromCore = createRequire(join(corePackageRoot, 'package.json'));
  const yamlPackageRoot = dirname(dirname(requireFromCore.resolve('yaml')));

  expectSuccess(await run('pnpm', ['pack', '--out', coreTarball], corePackageRoot));
  expectSuccess(await run('pnpm', ['pack', '--out', cliTarball], cliPackageRoot));
  expectSuccess(await run('pnpm', ['pack', '--out', yamlTarball], yamlPackageRoot));

  await writeFile(
    join(installationRoot, 'package.json'),
    JSON.stringify({ private: true }),
    'utf8',
  );
  expectSuccess(
    await run(
      'npm',
      [
        'install',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=false',
        yamlTarball,
        coreTarball,
        cliTarball,
      ],
      installationRoot,
    ),
  );

  breakdownExecutable = join(
    installationRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'breakdown.cmd' : 'breakdown',
  );
});

afterAll(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('breakdown', () => {
  it('should validate a project through the automation process contract', async () => {
    const projectRoot = await createProject();

    const result = await runOperate(projectRoot, { operation: 'validate_workflow' });

    expect(result).toEqual({
      status: 0,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'validate_workflow',
        ok: true,
        data: {
          definitionPath: 'breakdown.yaml',
          workflow: {
            schema_version: 'breakdown.workflow.v1',
            id: 'research',
            name: 'Research',
            nodes: [
              {
                id: 'investigate',
                name: 'Investigate',
                prompt: 'Gather the relevant evidence.',
              },
            ],
          },
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should create a new Run through the automation process contract', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: automation-run
name: Automation Run
inputs:
  brief: {}
nodes:
  - id: consume
    name: Consume
    prompt: Consume the brief.
    inputs:
      brief:
        workflow_input: brief
`);
    await mkdir(join(projectRoot, 'sources'));
    await writeFile(join(projectRoot, 'sources', 'brief.txt'), 'input bytes');

    const result = await runOperate(projectRoot, {
      operation: 'create_run',
      inputs: { brief: 'sources/brief.txt' },
    });

    expectSuccess(result);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 'breakdown.cli-output.v1',
      operation: 'create_run',
      ok: true,
      data: {
        inputs: {
          brief: {
            path: 'sources/brief.txt',
            sha256: 'f7c39aa7e478d51b7d49669703d94df49f158ea1d73b58760601f9c1857c4bdf',
          },
        },
        producer: {
          name: '@breakdown-sh/core',
          version: '1.0.0-beta.1',
        },
      },
    });
  });

  it('should inspect one exact Run through the automation process contract', async () => {
    const projectRoot = await createProject();
    const created = await runBreakdown(['run', 'create', '--project', projectRoot, '--json']);
    expectSuccess(created);
    const runId = (JSON.parse(created.stdout) as { data: { run_id: string } }).data.run_id;

    const result = await runOperate(projectRoot, {
      operation: 'inspect_run',
      run_id: runId,
    });

    expectSuccess(result);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 'breakdown.cli-output.v1',
      operation: 'inspect_run',
      ok: true,
      data: {
        run_id: runId,
        status: 'incomplete',
        nodes: [{ node_id: 'investigate', state: 'runnable' }],
      },
    });
  });

  it('should prepare bounded work through the automation process contract', async () => {
    const projectRoot = await createProject();
    const created = await runBreakdown(['run', 'create', '--project', projectRoot, '--json']);
    const runId = (JSON.parse(created.stdout) as { data: { run_id: string } }).data.run_id;

    const result = await runOperate(projectRoot, {
      operation: 'prepare_work',
      run_id: runId,
      mode: { kind: 'resume' },
      limit: 1,
    });

    expectSuccess(result);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 'breakdown.cli-output.v1',
      operation: 'prepare_work',
      ok: true,
      data: {
        schema_version: 'breakdown.work-packet-batch.v1',
        run_id: runId,
        intent: 'resume',
        packets: [
          {
            schema_version: 'breakdown.work-packet.v1',
            run_id: runId,
            intent: 'resume',
            node: { id: 'investigate' },
            expected_attempt: 1,
          },
        ],
      },
    });
  });

  it('should read exact Work Packet Input bytes through the automation process contract', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: read-input
name: Read Input
inputs:
  brief: {}
nodes:
  - id: consume
    name: Consume
    prompt: Consume the brief.
    inputs:
      brief:
        workflow_input: brief
`);
    await writeFile(join(projectRoot, 'brief.bin'), Buffer.from([0, 255, 65]));
    const created = await runOperate(projectRoot, {
      operation: 'create_run',
      inputs: { brief: 'brief.bin' },
    });
    const runId = (JSON.parse(created.stdout) as { data: { run_id: string } }).data.run_id;
    const prepared = await runOperate(projectRoot, {
      operation: 'prepare_work',
      run_id: runId,
      mode: { kind: 'resume' },
      limit: 1,
    });
    const packet = (
      JSON.parse(prepared.stdout) as {
        data: { packets: Array<Record<string, unknown>> };
      }
    ).data.packets[0];

    const result = await runOperate(projectRoot, {
      operation: 'read_work_input',
      packet,
      binding: 'brief',
    });

    expect(result).toEqual({
      status: 0,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'read_work_input',
        ok: true,
        data: {
          kind: 'workflow_input',
          bytes_base64: 'AP9B',
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should encode complete predecessor Result bytes as base64 fields', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: read-result
name: Read Result
nodes:
  - id: produce
    name: Produce
    prompt: Produce the source Result.
    data_contract:
      type: object
  - id: consume
    name: Consume
    prompt: Consume the source Result.
    inputs:
      source:
        node: produce
`);
    const created = await runOperate(projectRoot, { operation: 'create_run' });
    const runId = (JSON.parse(created.stdout) as { data: { run_id: string } }).data.run_id;
    const firstPrepared = await runOperate(projectRoot, {
      operation: 'prepare_work',
      run_id: runId,
      mode: { kind: 'resume' },
      limit: 1,
    });
    const firstPacket = (
      JSON.parse(firstPrepared.stdout) as {
        data: { packets: Array<{ submission: Record<string, unknown> }> };
      }
    ).data.packets[0]!;
    expectSuccess(
      await runOperate(projectRoot, {
        operation: 'submit_candidate',
        packet: firstPacket,
        candidate: {
          schema_version: 'breakdown.candidate.v1',
          submission: firstPacket.submission,
          status: 'succeeded',
          executor: { kind: 'program', name: 'Result byte test' },
          markdown: 'First.\n',
          json: { answer: 42 },
        },
      }),
    );
    const secondPrepared = await runOperate(projectRoot, {
      operation: 'prepare_work',
      run_id: runId,
      mode: { kind: 'resume' },
      limit: 1,
    });
    const secondPacket = (
      JSON.parse(secondPrepared.stdout) as {
        data: { packets: Array<Record<string, unknown>> };
      }
    ).data.packets[0]!;

    const result = await runOperate(projectRoot, {
      operation: 'read_work_input',
      packet: secondPacket,
      binding: 'source',
    });

    expectSuccess(result);
    const envelope = JSON.parse(result.stdout) as {
      data: {
        kind: string;
        markdown_bytes_base64: string;
        json_bytes_base64: string;
      };
    };
    expect(envelope.data).toMatchObject({
      kind: 'result',
      json_bytes_base64: 'eyJhbnN3ZXIiOjQyfQ==',
    });
    expect(Buffer.from(envelope.data.markdown_bytes_base64, 'base64').toString('utf8')).toMatch(
      /^---\n.*\n---\nFirst\.\n$/s,
    );
  });

  it('should submit a Candidate Outcome through the automation process contract', async () => {
    const projectRoot = await createProject();
    const created = await runOperate(projectRoot, { operation: 'create_run' });
    const runId = (JSON.parse(created.stdout) as { data: { run_id: string } }).data.run_id;
    const prepared = await runOperate(projectRoot, {
      operation: 'prepare_work',
      run_id: runId,
      mode: { kind: 'resume' },
      limit: 1,
    });
    const packet = (
      JSON.parse(prepared.stdout) as {
        data: { packets: Array<{ submission: Record<string, unknown> }> };
      }
    ).data.packets[0]!;

    const result = await runOperate(projectRoot, {
      operation: 'submit_candidate',
      packet,
      candidate: {
        schema_version: 'breakdown.candidate.v1',
        submission: packet.submission,
        status: 'succeeded',
        executor: {
          kind: 'program',
          name: 'CLI conformance test',
        },
        markdown: 'Complete result.\n',
      },
    });

    expectSuccess(result);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 'breakdown.cli-output.v1',
      operation: 'submit_candidate',
      ok: true,
      data: {
        run_id: runId,
        node_id: 'investigate',
        attempt: 1,
        status: 'succeeded',
        result: {
          markdown: {
            path: expect.stringMatching(
              new RegExp(`^outputs/${runId}/steps/.+--investigate--a1\\.md$`),
            ),
          },
          json: null,
        },
      },
    });

    const refresh = await runOperate(projectRoot, {
      operation: 'prepare_work',
      run_id: runId,
      mode: { kind: 'refresh', node_id: 'investigate' },
      limit: 1,
    });
    expectSuccess(refresh);
    expect(JSON.parse(refresh.stdout)).toMatchObject({
      operation: 'prepare_work',
      ok: true,
      data: {
        intent: 'refresh',
        packets: [
          {
            intent: 'refresh',
            node: { id: 'investigate' },
            refresh_base: { node_id: 'investigate', attempt: 1 },
          },
        ],
      },
    });
  });

  it('should reject unknown automation request fields with a machine failure', async () => {
    const projectRoot = await createProject();

    const result = await runOperate(projectRoot, {
      operation: 'validate_workflow',
      unexpected: true,
    });

    expect(result).toEqual({
      status: 3,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'validate_workflow',
        ok: false,
        error: {
          kind: 'invalid',
          code: 'invalid_operation_request',
          message: 'The automation operation request is invalid.',
          diagnostics: [
            {
              code: 'schema',
              path: '/unexpected',
              message: 'Unknown operation request field: unexpected.',
            },
          ],
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should encode malformed automation JSON as one expected machine failure', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown(
      ['operate', '--project', projectRoot],
      workspaceRoot,
      '{"schema_version":"breakdown.operation-request.v1",',
    );

    expect(result).toEqual({
      status: 3,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'unknown',
        ok: false,
        error: {
          kind: 'invalid',
          code: 'invalid_operation_request',
          message: 'The automation operation request is invalid.',
          diagnostics: [
            {
              code: 'parse',
              path: '',
              message: 'The automation request is not strict JSON.',
            },
          ],
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should reject an unsupported automation protocol version', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown(
      ['operate', '--project', projectRoot],
      workspaceRoot,
      JSON.stringify({
        schema_version: 'breakdown.operation-request.v2',
        operation: 'validate_workflow',
      }),
    );

    expect(result).toEqual({
      status: 5,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'validate_workflow',
        ok: false,
        error: {
          kind: 'unsupported',
          code: 'unsupported_version',
          message: 'The automation request uses an unsupported version.',
          diagnostics: [],
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should reject strict-schema near misses for every automation variant', async () => {
    const projectRoot = await createProject();
    const requests: Array<Record<string, unknown>> = [
      { operation: 'validate_workflow' },
      {
        schema_version: 'breakdown.operation-request.v1',
        operation: 'create_run',
        inputs: [],
      },
      {
        schema_version: 'breakdown.operation-request.v1',
        operation: 'inspect_run',
      },
      {
        schema_version: 'breakdown.operation-request.v1',
        operation: 'prepare_work',
        run_id: 'exact-run',
        mode: { kind: 'resume' },
        limit: 0,
      },
      {
        schema_version: 'breakdown.operation-request.v1',
        operation: 'read_work_input',
        packet: {},
      },
      {
        schema_version: 'breakdown.operation-request.v1',
        operation: 'submit_candidate',
        packet: {},
      },
    ];

    for (const request of requests) {
      const result = await runBreakdown(
        ['operate', '--project', projectRoot],
        workspaceRoot,
        JSON.stringify(request),
      );
      expect(result.status, JSON.stringify(request)).toBe(3);
      expect(result.stderr, JSON.stringify(request)).toBe('');
      expect(JSON.parse(result.stdout)).toMatchObject({
        schema_version: 'breakdown.cli-output.v1',
        operation: request.operation,
        ok: false,
        error: {
          kind: 'invalid',
          code: 'invalid_operation_request',
        },
      });
    }
  });

  it('should reject noncanonical automation command flags as usage errors', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown(
      ['operate', '--project', projectRoot, '--json'],
      workspaceRoot,
      JSON.stringify({
        schema_version: 'breakdown.operation-request.v1',
        operation: 'validate_workflow',
      }),
    );

    expect(result).toEqual({
      status: 2,
      stdout: '',
      stderr: `Usage:
  breakdown workflow validate --project PATH [--json]
  breakdown run create --project PATH [--input ID=PATH]... [--json]
  breakdown run inspect --project PATH --run RUN_ID [--json]
  breakdown operate --project PATH
`,
    });
  });

  it('should reject flattened preparation intent fields at the strict request boundary', async () => {
    const projectRoot = await createProject();

    const result = await runOperate(projectRoot, {
      operation: 'prepare_work',
      run_id: 'exact-run',
      intent: 'refresh',
      node_id: 'investigate',
      limit: 1,
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 'breakdown.cli-output.v1',
      operation: 'prepare_work',
      ok: false,
      error: {
        kind: 'invalid',
        code: 'invalid_operation_request',
      },
    });
  });

  it('should reject schema-invalid nested transport documents at the request boundary', async () => {
    const projectRoot = await createProject();
    const created = await runOperate(projectRoot, { operation: 'create_run' });
    const runId = (JSON.parse(created.stdout) as { data: { run_id: string } }).data.run_id;
    const prepared = await runOperate(projectRoot, {
      operation: 'prepare_work',
      run_id: runId,
      mode: { kind: 'resume' },
      limit: 1,
    });
    const invalidPacket = structuredClone(
      (
        JSON.parse(prepared.stdout) as {
          data: { packets: Array<Record<string, unknown>> };
        }
      ).data.packets[0]!,
    );
    (invalidPacket.node as Record<string, unknown>).inputs = { invalid: 1 };
    const requests = [
      {
        operation: 'read_work_input',
        packet: invalidPacket,
        binding: 'brief',
      },
      {
        operation: 'submit_candidate',
        packet: {},
        candidate: {},
      },
    ];

    for (const request of requests) {
      const result = await runOperate(projectRoot, request);
      expect(result.status, request.operation).toBe(3);
      expect(result.stderr, request.operation).toBe('');
      expect(JSON.parse(result.stdout), request.operation).toMatchObject({
        schema_version: 'breakdown.cli-output.v1',
        operation: request.operation,
        ok: false,
        error: {
          kind: 'invalid',
          code: 'invalid_operation_request',
        },
      });
    }
  });

  it('should cap adapter-generated diagnostics at the fixed limit', async () => {
    const projectRoot = await createProject();
    const request = Object.fromEntries(
      Array.from({ length: 1_100 }, (_, index) => [
        `unexpected_${index.toString().padStart(4, '0')}`,
        true,
      ]),
    );

    const result = await runOperate(projectRoot, {
      operation: 'validate_workflow',
      ...request,
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toBe('');
    const envelope = JSON.parse(result.stdout) as {
      error: { diagnostics: Array<{ path: string }> };
    };
    expect(envelope.error.diagnostics).toHaveLength(1_000);
    expect(envelope.error.diagnostics[0]?.path).toBe('/unexpected_0000');
    expect(envelope.error.diagnostics.at(-1)?.path).toBe('/unexpected_0999');
  });

  it('should reject an automation request above the fixed byte limit', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown(
      ['operate', '--project', projectRoot],
      workspaceRoot,
      Buffer.alloc(2_097_153, 0x20),
    );

    expect(result).toEqual({
      status: 7,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'unknown',
        ok: false,
        error: {
          kind: 'resource_limit',
          code: 'limit_exceeded',
          message: 'A fixed resource limit was exceeded.',
          diagnostics: [],
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should replace an oversized automation response with a resource-limit envelope', async () => {
    const projectRoot = await createProject();
    const preloadPath = join(projectRoot, 'force-response-limit.mjs');
    await writeFile(
      preloadPath,
      `const byteLength = Buffer.byteLength;
Buffer.byteLength = (value, encoding) =>
  typeof value === 'string' &&
  value.includes('"schema_version":"breakdown.cli-output.v1"') &&
  value.includes('"ok":true')
    ? 12_582_913
    : byteLength(value, encoding);
`,
      'utf8',
    );

    const result = await runBreakdown(
      ['operate', '--project', projectRoot],
      workspaceRoot,
      JSON.stringify({
        schema_version: 'breakdown.operation-request.v1',
        operation: 'validate_workflow',
      }),
      { NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}` },
    );

    expect(result).toEqual({
      status: 7,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'validate_workflow',
        ok: false,
        error: {
          kind: 'resource_limit',
          code: 'limit_exceeded',
          message: 'A fixed resource limit was exceeded.',
          diagnostics: [],
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should reject non-strict UTF-8 automation request encodings before dispatch', async () => {
    const projectRoot = await createProject();
    const prefix = Buffer.from(
      '{"schema_version":"breakdown.operation-request.v1","operation":"validate_workflow","unexpected":"',
    );
    const suffix = Buffer.from('"}');
    const validRequest = Buffer.from(
      '{"schema_version":"breakdown.operation-request.v1","operation":"validate_workflow"}',
    );

    for (const input of [
      Buffer.concat([prefix, Buffer.from([0xff]), suffix]),
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), validRequest]),
    ]) {
      const result = await runBreakdown(
        ['operate', '--project', projectRoot],
        workspaceRoot,
        input,
      );

      expect(result).toEqual({
        status: 3,
        stdout: `${JSON.stringify({
          schema_version: 'breakdown.cli-output.v1',
          operation: 'unknown',
          ok: false,
          error: {
            kind: 'invalid',
            code: 'invalid_operation_request',
            message: 'The automation operation request is invalid.',
            diagnostics: [
              {
                code: 'parse',
                path: '',
                message: 'The automation request is not strict JSON.',
              },
            ],
          },
        })}\n`,
        stderr: '',
      });
    }
  });

  it('should expose help and exact package version as process metadata', async () => {
    const help = await runBreakdown(['--help']);
    const version = await runBreakdown(['--version']);

    expect(help).toEqual({
      status: 0,
      stdout: `Usage:
  breakdown workflow validate --project PATH [--json]
  breakdown run create --project PATH [--input ID=PATH]... [--json]
  breakdown run inspect --project PATH --run RUN_ID [--json]
  breakdown operate --project PATH
`,
      stderr: '',
    });
    expect(version).toEqual({
      status: 0,
      stdout: '1.0.0-beta.1\n',
      stderr: '',
    });
  });

  it('should escape terminal controls and bound human failure output', async () => {
    const hostileKey = '\u001b]8;;https://example.invalid\u0007click\u001b]8;;\u0007';
    const unknownFields = [
      `${JSON.stringify(hostileKey)}: true`,
      ...Array.from(
        { length: 999 },
        (_, index) => `unknown-${String(index).padStart(4, '0')}-${'x'.repeat(48)}: true`,
      ),
    ].join('\n');
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: hostile-output
name: Hostile Output
${unknownFields}
nodes:
  - id: inspect
    name: Inspect
    prompt: Treat rich content as data.
`);

    const result = await runBreakdown(['workflow', 'validate', '--project', projectRoot]);

    expect(result.status).toBe(3);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('\u001b');
    expect(result.stderr).not.toContain('\u0007');
    expect(result.stderr).toContain('\\u001b');
    expect(Buffer.byteLength(result.stderr, 'utf8')).toBeLessThanOrEqual(65_536);
    expect(result.stderr).toMatch(/\[diagnostics truncated\]\n$/);
  });

  it.runIf(process.platform === 'darwin')(
    'should use terminal color only when NO_COLOR is absent',
    async () => {
      const projectRoot = await createProject();

      const colored = await runBreakdownInDarwinTerminal(projectRoot, { NO_COLOR: undefined });
      const plain = await runBreakdownInDarwinTerminal(projectRoot, { NO_COLOR: '1' });

      expect(colored, JSON.stringify(colored)).toMatchObject({ status: 0 });
      expect(colored.stdout).toContain('\u001b[32m');
      expect(plain, JSON.stringify(plain)).toMatchObject({ status: 0 });
      expect(plain.stdout).not.toContain('\u001b');
    },
  );

  it('should translate process signals into core invocation cancellation', async () => {
    const projectRoot = await createProject();

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const result = await runBreakdownAfterSignal(
        projectRoot,
        { operation: 'validate_workflow' },
        signal,
      );

      expect(result, signal).toEqual({
        status: 6,
        stdout: `${JSON.stringify({
          schema_version: 'breakdown.cli-output.v1',
          operation: 'validate_workflow',
          ok: false,
          error: {
            kind: 'cancelled',
            code: 'cancelled',
            message: 'The operation was cancelled.',
            diagnostics: [],
          },
        })}\n`,
        stderr: '',
      });
    }
  });

  it('should preserve I/O failures and exit 8 in machine mode', async () => {
    const missingProject = join(tmpdir(), `missing-breakdown-project-${process.pid}`);

    const result = await runOperate(missingProject, {
      operation: 'validate_workflow',
    });

    expect(result).toEqual({
      status: 8,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'validate_workflow',
        ok: false,
        error: {
          kind: 'io',
          code: 'io_error',
          message: 'Could not select the project root.',
          diagnostics: [],
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should map an early unencodable process failure to internal exit 70', async () => {
    const projectRoot = await createProject();
    const preloadPath = join(projectRoot, 'force-output-failure.mjs');
    await writeFile(
      preloadPath,
      `process.stdout.write = () => {
  throw new Error('injected output failure');
};
`,
      'utf8',
    );

    const result = await runBreakdown(
      ['operate', '--project', projectRoot],
      workspaceRoot,
      JSON.stringify({
        schema_version: 'breakdown.operation-request.v1',
        operation: 'validate_workflow',
      }),
      { NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}` },
    );

    expect(result).toEqual({
      status: 70,
      stdout: '',
      stderr: 'Internal CLI failure.\n',
    });
  });

  it('should preserve Run lock conflicts and exit 4 in machine mode', async () => {
    const projectRoot = await createProject();
    const created = await runOperate(projectRoot, { operation: 'create_run' });
    const runId = (JSON.parse(created.stdout) as { data: { run_id: string } }).data.run_id;
    const prepared = await runOperate(projectRoot, {
      operation: 'prepare_work',
      run_id: runId,
      mode: { kind: 'resume' },
      limit: 1,
    });
    const packet = (
      JSON.parse(prepared.stdout) as {
        data: { packets: Array<{ submission: Record<string, unknown> }> };
      }
    ).data.packets[0]!;
    const lockDirectory = join(projectRoot, '.breakdown', 'locks', 'runs');
    await mkdir(lockDirectory, { recursive: true });
    await writeFile(
      join(lockDirectory, `${runId}.lock`),
      JSON.stringify({
        lock_id: 'held-by-another-writer',
        run_id: runId,
        created_at: '2026-07-27T00:00:00.000Z',
        process_id: process.pid,
      }),
      { mode: 0o600 },
    );

    const result = await runOperate(projectRoot, {
      operation: 'submit_candidate',
      packet,
      candidate: {
        schema_version: 'breakdown.candidate.v1',
        submission: packet.submission,
        status: 'succeeded',
        executor: { kind: 'program', name: 'Conflict test' },
        markdown: 'Candidate.\n',
      },
    });

    expect(result).toEqual({
      status: 4,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'submit_candidate',
        ok: false,
        error: {
          kind: 'conflict',
          code: 'run_locked',
          message: 'Another writer currently holds the Run lock.',
          diagnostics: [],
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should operate without Git on PATH', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown(
      ['workflow', 'validate', '--project', projectRoot, '--json'],
      workspaceRoot,
      undefined,
      { PATH: dirname(process.execPath) },
    );

    expectSuccess(result);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 'breakdown.cli-output.v1',
      operation: 'validate_workflow',
      ok: true,
    });
  });

  it('should validate a project through the JSON command surface', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown(['workflow', 'validate', '--project', projectRoot, '--json']);

    expect(result).toEqual({
      status: 0,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'validate_workflow',
        ok: true,
        data: {
          definitionPath: 'breakdown.yaml',
          workflow: {
            schema_version: 'breakdown.workflow.v1',
            id: 'research',
            name: 'Research',
            nodes: [
              {
                id: 'investigate',
                name: 'Investigate',
                prompt: 'Gather the relevant evidence.',
              },
            ],
          },
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should serialize exact large JSON integers without converting them to strings', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: exact-integers
name: Exact Integers
extensions:
  com.example.metadata:
    serial: 9007199254740993
nodes:
  - id: inspect
    name: Inspect
    prompt: Preserve the exact integer.
`);

    const result = await runBreakdown(['workflow', 'validate', '--project', projectRoot, '--json']);

    expect(result).toMatchObject({
      status: 0,
      stderr: '',
    });
    expect(result.stdout).toContain('"serial":9007199254740993');
    expect(result.stdout).not.toContain('"serial":"9007199254740993"');
  });

  it('should serialize exact scientific integers and high-precision decimals', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: exact-numbers
name: Exact Numbers
extensions:
  com.example.metadata:
    scientific: 9.007199254740993e15
    decimal: 0.10000000000000001
nodes:
  - id: inspect
    name: Inspect
    prompt: Preserve exact JSON numbers.
`);

    const result = await runBreakdown(['workflow', 'validate', '--project', projectRoot, '--json']);

    expect(result).toMatchObject({
      status: 0,
      stderr: '',
    });
    expect(result.stdout).toContain('"scientific":9007199254740993');
    expect(result.stdout).toContain('"decimal":1.0000000000000001e-1');
  });

  it('should report a concise human success', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown(['workflow', 'validate', '--project', projectRoot]);

    expect(result).toEqual({
      status: 0,
      stdout: 'Validated breakdown.yaml (1 Node Definition).\n',
      stderr: '',
    });
  });

  it('should create a new Run with exact Workflow Input overrides through the JSON surface', async () => {
    const workflow = `schema_version: breakdown.workflow.v1
id: cli-run
name: CLI Run
inputs:
  brief: {}
nodes:
  - id: consume
    name: Consume
    prompt: Consume the brief.
    inputs:
      brief:
        workflow_input: brief
`;
    const projectRoot = await createProject(workflow);
    await mkdir(join(projectRoot, 'sources'));
    await writeFile(join(projectRoot, 'sources', 'brief.txt'), 'input bytes');

    const result = await runBreakdown([
      'run',
      'create',
      '--project',
      projectRoot,
      '--input',
      'brief=sources/brief.txt',
      '--json',
    ]);

    expectSuccess(result);
    const envelope = JSON.parse(result.stdout) as {
      schema_version: string;
      operation: string;
      ok: boolean;
      data: {
        run_id: string;
        path: string;
        inputs: Record<string, { path: string; sha256: string }>;
        producer: { name: string; version: string };
      };
    };
    expect(envelope).toMatchObject({
      schema_version: 'breakdown.cli-output.v1',
      operation: 'create_run',
      ok: true,
      data: {
        inputs: {
          brief: {
            path: 'sources/brief.txt',
            sha256: 'f7c39aa7e478d51b7d49669703d94df49f158ea1d73b58760601f9c1857c4bdf',
          },
        },
        producer: {
          name: '@breakdown-sh/core',
          version: '1.0.0-beta.1',
        },
      },
    });
    expect(envelope.data.run_id).toMatch(/^\d{8}T\d{6}\.\d{3}Z--cli-run--[a-z2-7]{12}$/);
    expect(envelope.data.path).toBe(`outputs/${envelope.data.run_id}`);
    expect(await readFile(join(projectRoot, envelope.data.path, 'breakdown.yaml'), 'utf8')).toBe(
      workflow,
    );
  });

  it('should report a concise human Run creation success', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown(['run', 'create', '--project', projectRoot]);

    expect(result).toMatchObject({
      status: 0,
      stderr: '',
    });
    expect(result.stdout).toMatch(/^Created Run \d{8}T\d{6}\.\d{3}Z--research--[a-z2-7]{12}\.\n$/);
  });

  it('should inspect one exact Run through the JSON command surface', async () => {
    const projectRoot = await createProject();
    const created = await runBreakdown(['run', 'create', '--project', projectRoot, '--json']);
    expectSuccess(created);
    const runId = (JSON.parse(created.stdout) as { data: { run_id: string } }).data.run_id;

    const result = await runBreakdown([
      'run',
      'inspect',
      '--project',
      projectRoot,
      '--run',
      runId,
      '--json',
    ]);

    expectSuccess(result);
    expect(JSON.parse(result.stdout)).toMatchObject({
      schema_version: 'breakdown.cli-output.v1',
      operation: 'inspect_run',
      ok: true,
      data: {
        run_id: runId,
        status: 'incomplete',
        resumable: true,
        nodes: [
          {
            node_id: 'investigate',
            state: 'runnable',
            next_attempt: 1,
          },
        ],
        attempts: [],
        terminal_results: [],
      },
    });
  });

  it('should report a concise human Run inspection success', async () => {
    const projectRoot = await createProject();
    const created = await runBreakdown(['run', 'create', '--project', projectRoot, '--json']);
    const runId = (JSON.parse(created.stdout) as { data: { run_id: string } }).data.run_id;

    const result = await runBreakdown(['run', 'inspect', '--project', projectRoot, '--run', runId]);

    expect(result).toEqual({
      status: 0,
      stdout: `Inspected Run ${runId}: incomplete (1 runnable, 0 complete, 0 blocked).\n`,
      stderr: '',
    });
  });

  it('should reject Run inspection without an exact --run argument', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown(['run', 'inspect', '--project', projectRoot, '--json']);

    expect(result).toEqual({
      status: 2,
      stdout: '',
      stderr: `Usage:
  breakdown workflow validate --project PATH [--json]
  breakdown run create --project PATH [--input ID=PATH]... [--json]
  breakdown run inspect --project PATH --run RUN_ID [--json]
  breakdown operate --project PATH
`,
    });
  });

  it('should reject duplicate Workflow Input overrides before publication', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown([
      'run',
      'create',
      '--project',
      projectRoot,
      '--input',
      'brief=first.txt',
      '--input',
      'brief=second.txt',
      '--json',
    ]);

    expect(result).toEqual({
      status: 2,
      stdout: '',
      stderr: `Usage:
  breakdown workflow validate --project PATH [--json]
  breakdown run create --project PATH [--input ID=PATH]... [--json]
  breakdown run inspect --project PATH --run RUN_ID [--json]
  breakdown operate --project PATH
`,
    });
    await expect(access(join(projectRoot, 'outputs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('should preserve structured validation failures and exit 3 in JSON mode', async () => {
    const projectRoot = await createProject(`schema_version: breakdown.workflow.v1
id: research
name: Research
nodes: []
`);

    const result = await runBreakdown(['workflow', 'validate', '--project', projectRoot, '--json']);

    expect(result).toEqual({
      status: 3,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'validate_workflow',
        ok: false,
        error: {
          kind: 'invalid',
          code: 'invalid_workflow',
          message: 'The Workflow Definition is invalid.',
          diagnostics: [
            {
              code: 'schema',
              path: '/nodes',
              message: 'nodes must be a non-empty array.',
              file: 'breakdown.yaml',
            },
          ],
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should preserve fixed resource-limit failures and exit 7 in JSON mode', async () => {
    const projectRoot = await createProject(' '.repeat(1_048_577));

    const result = await runBreakdown(['workflow', 'validate', '--project', projectRoot, '--json']);

    expect(result).toEqual({
      status: 7,
      stdout: `${JSON.stringify({
        schema_version: 'breakdown.cli-output.v1',
        operation: 'validate_workflow',
        ok: false,
        error: {
          kind: 'resource_limit',
          code: 'limit_exceeded',
          message: 'A fixed resource limit was exceeded.',
          diagnostics: [],
        },
      })}\n`,
      stderr: '',
    });
  });

  it('should treat a missing project root as CLI usage failure', async () => {
    const result = await runBreakdown(['workflow', 'validate', '--json']);

    expect(result).toEqual({
      status: 2,
      stdout: '',
      stderr: `Usage:
  breakdown workflow validate --project PATH [--json]
  breakdown run create --project PATH [--input ID=PATH]... [--json]
  breakdown run inspect --project PATH --run RUN_ID [--json]
  breakdown operate --project PATH
`,
    });
  });

  it('should reject forbidden human orchestration and side-effect commands', async () => {
    const projectRoot = await createProject();
    const commands = [
      ['run', 'prepare'],
      ['run', 'retry'],
      ['run', 'refresh'],
      ['run', 'finalize'],
      ['run', 'cancel'],
      ['run', 'unlock'],
      ['git'],
      ['publish'],
      ['executor'],
    ];

    for (const command of commands) {
      const result = await runBreakdown([...command, '--project', projectRoot]);
      expect(result, command.join(' ')).toEqual({
        status: 2,
        stdout: '',
        stderr: `Usage:
  breakdown workflow validate --project PATH [--json]
  breakdown run create --project PATH [--input ID=PATH]... [--json]
  breakdown run inspect --project PATH --run RUN_ID [--json]
  breakdown operate --project PATH
`,
      });
    }
  });

  it('should reject an empty project argument', async () => {
    const result = await runBreakdown(['workflow', 'validate', '--project', '']);

    expect(result).toEqual({
      status: 2,
      stdout: '',
      stderr: `Usage:
  breakdown workflow validate --project PATH [--json]
  breakdown run create --project PATH [--input ID=PATH]... [--json]
  breakdown run inspect --project PATH --run RUN_ID [--json]
  breakdown operate --project PATH
`,
    });
  });

  it('should install isolated lockstep Node 24 packages', async () => {
    const corePackage = JSON.parse(
      await readFile(
        join(installationRoot, 'node_modules', '@breakdown-sh', 'core', 'package.json'),
        'utf8',
      ),
    ) as {
      version: string;
      engines: { node: string };
      dependencies: Record<string, string>;
    };
    const cliPackage = JSON.parse(
      await readFile(
        join(installationRoot, 'node_modules', '@breakdown-sh', 'cli', 'package.json'),
        'utf8',
      ),
    ) as {
      version: string;
      engines: { node: string };
      dependencies: Record<string, string>;
    };

    expect(corePackage).toMatchObject({
      version: '1.0.0-beta.1',
      engines: { node: '^24.0.0' },
      dependencies: { yaml: '2.9.0' },
    });
    expect(Object.keys(corePackage.dependencies)).toEqual(['yaml']);
    expect(cliPackage).toMatchObject({
      version: corePackage.version,
      engines: { node: '^24.0.0' },
      dependencies: {
        '@breakdown-sh/core': corePackage.version,
      },
    });
    expect(Object.keys(cliPackage.dependencies)).toEqual(['@breakdown-sh/core']);
  });

  it('should match the normative CLI catalog and public machine schemas', async () => {
    const catalog = JSON.parse(
      await readFile(join(workspaceRoot, 'local', 'contracts', 'catalogs', 'cli.v1.json'), 'utf8'),
    ) as {
      schema_version: string;
      operations: string[];
      exit_codes: Record<string, number>;
      presentation: Record<string, unknown>;
    };
    const requestSchema = JSON.parse(
      await readFile(
        join(
          workspaceRoot,
          'local',
          'contracts',
          'schemas',
          'breakdown.operation-request.v1.schema.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const outputSchema = JSON.parse(
      await readFile(
        join(workspaceRoot, 'local', 'contracts', 'schemas', 'breakdown.cli-output.v1.schema.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const workPacketSchema = JSON.parse(
      await readFile(
        join(
          workspaceRoot,
          'local',
          'contracts',
          'schemas',
          'breakdown.work-packet.v1.schema.json',
        ),
        'utf8',
      ),
    ) as Record<string, unknown>;
    const candidateSchema = JSON.parse(
      await readFile(
        join(workspaceRoot, 'local', 'contracts', 'schemas', 'breakdown.candidate.v1.schema.json'),
        'utf8',
      ),
    ) as Record<string, unknown>;

    expect(catalog).toMatchObject({
      schema_version: 'breakdown.cli-catalog.v1',
      operations: [
        'validate_workflow',
        'create_run',
        'inspect_run',
        'prepare_work',
        'read_work_input',
        'submit_candidate',
      ],
      exit_codes: {
        success: 0,
        usage: 2,
        invalid: 3,
        conflict: 4,
        unsupported: 5,
        cancelled: 6,
        resource_limit: 7,
        io: 8,
        internal: 70,
      },
      presentation: {
        human_stderr_bytes: 65_536,
        terminal_control_encoding: 'lowercase \\uXXXX',
        color: 'tty-only',
        no_color: 'any present NO_COLOR value disables color',
      },
    });
    const schemaValidator = new Ajv2020({
      allErrors: true,
      strict: true,
      strictRequired: false,
    });
    schemaValidator.addSchema(workPacketSchema);
    schemaValidator.addSchema(candidateSchema);
    const validateRequest = schemaValidator.compile(requestSchema);
    const validateOutput = schemaValidator.compile(outputSchema);

    const publicRequest = {
      schema_version: 'breakdown.operation-request.v1',
      operation: 'prepare_work',
      run_id: 'exact-run',
      mode: { kind: 'resume' },
      limit: 3,
    };
    expect(validateRequest(publicRequest), JSON.stringify(validateRequest.errors)).toBe(true);
    expect(
      validateRequest({
        ...publicRequest,
        mode: undefined,
        intent: 'resume',
      }),
    ).toBe(false);

    const projectRoot = await createProject();
    const success = await runOperate(projectRoot, { operation: 'validate_workflow' });
    const failure = await runOperate(projectRoot, {
      operation: 'inspect_run',
      run_id: 'missing-run',
    });
    expect(validateOutput(JSON.parse(success.stdout)), JSON.stringify(validateOutput.errors)).toBe(
      true,
    );
    expect(validateOutput(JSON.parse(failure.stdout)), JSON.stringify(validateOutput.errors)).toBe(
      true,
    );
  });

  it('should cover at least 80% of the installed CLI executable', async () => {
    expect(await installedCliLineCoverage()).toBeGreaterThanOrEqual(0.8);
  });
});

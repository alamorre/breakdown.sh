import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: {
        ...process.env,
        NO_COLOR: '1',
        ...extraEnvironment,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
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
    child.once('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

function runBreakdown(args: string[], cwd = workspaceRoot) {
  return run(breakdownExecutable, args, cwd, {
    NODE_V8_COVERAGE: cliCoverageRoot,
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
      stderr: 'Usage: breakdown workflow validate --project PATH [--json]\n',
    });
  });

  it('should reject commands outside the validation surface', async () => {
    const projectRoot = await createProject();

    const result = await runBreakdown(['run', 'validate', '--project', projectRoot]);

    expect(result).toEqual({
      status: 2,
      stdout: '',
      stderr: 'Usage: breakdown workflow validate --project PATH [--json]\n',
    });
  });

  it('should reject an empty project argument', async () => {
    const result = await runBreakdown(['workflow', 'validate', '--project', '']);

    expect(result).toEqual({
      status: 2,
      stdout: '',
      stderr: 'Usage: breakdown workflow validate --project PATH [--json]\n',
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

  it('should cover at least 80% of the installed CLI executable', async () => {
    expect(await installedCliLineCoverage()).toBeGreaterThanOrEqual(0.8);
  });
});

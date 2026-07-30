import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, statfs, writeFile } from 'node:fs/promises';
import {
  arch as osArchitecture,
  release as osRelease,
  tmpdir,
  version as osVersion,
} from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import { sha256 } from './filesystem.mjs';
import {
  MAINTAINED_PLATFORM_TUPLES,
  PLATFORM_QUALIFICATION_POLICY,
  readCandidateProvenance,
  readCandidateRelease,
} from './platform-evidence.mjs';
import { runPackageArtifactCommand } from './package-artifacts.mjs';
import { inspectReleaseCandidate, tarGzipEntries } from './release-inspection.mjs';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function tupleKey(tuple) {
  return `${tuple.os}/${tuple.architecture}`;
}

function platformOs() {
  if (process.platform === 'linux') {
    const report = process.report?.getReport();
    const glibc = report?.header?.glibcVersionRuntime;
    invariant(
      typeof glibc === 'string' && glibc.length > 0,
      'Maintained Linux qualification requires native glibc.',
    );
    return 'linux-glibc';
  }
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  throw new Error(`Unsupported qualification operating system: ${process.platform}.`);
}

function currentPlatformTuple() {
  const architecture = osArchitecture();
  invariant(
    architecture === 'x64' || architecture === 'arm64',
    `Unsupported qualification architecture: ${architecture}.`,
  );
  return { os: platformOs(), architecture };
}

function unescapeMountPath(path) {
  return path
    .replaceAll('\\040', ' ')
    .replaceAll('\\011', '\t')
    .replaceAll('\\012', '\n')
    .replaceAll('\\134', '\\');
}

async function linuxFilesystemName(path) {
  const mountInfo = await readFile('/proc/self/mountinfo', 'utf8');
  const absolutePath = resolve(path);
  let best;
  for (const line of mountInfo.split('\n')) {
    const separator = line.indexOf(' - ');
    if (separator < 0) continue;
    const left = line.slice(0, separator).split(' ');
    const right = line.slice(separator + 3).split(' ');
    const mountPoint = unescapeMountPath(left[4] ?? '');
    if (
      absolutePath !== mountPoint &&
      !absolutePath.startsWith(mountPoint.endsWith('/') ? mountPoint : `${mountPoint}/`)
    ) {
      continue;
    }
    if (best === undefined || mountPoint.length > best.mountPoint.length) {
      best = { mountPoint, type: right[0] };
    }
  }
  return best?.type ?? 'unknown-linux-filesystem';
}

async function filesystemIdentity(path) {
  const facts = await statfs(path, { bigint: true });
  const type = `0x${BigInt.asUintN(64, facts.type).toString(16)}`;
  let name;
  if (process.platform === 'linux') {
    name = await linuxFilesystemName(path);
  } else if (process.platform === 'darwin') {
    name =
      {
        '0x11': 'hfs',
        '0x1a': 'apfs',
      }[type] ?? `darwin-filesystem-${type}`;
  } else {
    const drive = resolve(path).slice(0, 1);
    const script = `(Get-Volume -DriveLetter '${drive}').FileSystem`;
    const result = await execFileAsync('powershell.exe', [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      script,
    ]);
    name = result.stdout.trim();
  }
  invariant(name.length > 0, 'Qualification could not identify the native filesystem.');
  return {
    name,
    type,
    block_size: facts.bsize.toString(),
    exercised_path_kind: 'os-temporary-directory',
  };
}

async function extractCandidateContracts({ candidateDirectory, destination, releaseVersion }) {
  const archiveName = `breakdown-contracts-${releaseVersion}.tar.gz`;
  const archiveRoot = `breakdown-contracts-${releaseVersion}/`;
  const entries = tarGzipEntries(await readFile(join(candidateDirectory, archiveName)));
  for (const [archivePath, bytes] of entries) {
    invariant(
      archivePath.startsWith(archiveRoot),
      `Contracts archive contains path outside ${archiveRoot}.`,
    );
    const relativePath = archivePath.slice(archiveRoot.length);
    invariant(
      relativePath.length > 0 &&
        !relativePath.startsWith('/') &&
        !relativePath.split('/').includes('..'),
      `Contracts archive contains unsafe path ${archivePath}.`,
    );
    const path = join(destination, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { mode: 0o600 });
  }
}

async function installCandidatePackages({ candidateDirectory, qualificationRoot, releaseVersion }) {
  await writeFile(
    join(qualificationRoot, 'package.json'),
    `${JSON.stringify({
      name: 'breakdown-platform-qualification',
      private: true,
      type: 'module',
    })}\n`,
    { mode: 0o600 },
  );
  const tarballs = ['core', 'cli', 'mcp'].map((name) =>
    join(candidateDirectory, `breakdown-sh-${name}-${releaseVersion}.tgz`),
  );
  const npmArguments = [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--package-lock=false',
    ...tarballs,
  ];
  return runPackageArtifactCommand('npm', npmArguments, {
    cwd: qualificationRoot,
    env: { ...process.env, npm_config_engine_strict: 'true' },
    windowsHide: true,
  });
}

async function stageQualificationWorkspace({ candidateDirectory, releaseVersion, repositoryRoot }) {
  const qualificationRoot = await mkdtemp(
    join(repositoryRoot, '.breakdown-platform-qualification-'),
  );
  try {
    const installation = await installCandidatePackages({
      candidateDirectory,
      qualificationRoot,
      releaseVersion,
    });
    const contractsRoot = join(qualificationRoot, 'local', 'contracts');
    await extractCandidateContracts({
      candidateDirectory,
      destination: contractsRoot,
      releaseVersion,
    });
    await cp(
      join(repositoryRoot, 'local', 'contracts', 'contract-corpus.test.ts'),
      join(contractsRoot, 'contract-corpus.test.ts'),
    );

    const stagedCoreSource = join(qualificationRoot, 'packages', 'breakdown-core', 'src');
    await cp(
      join(qualificationRoot, 'node_modules', '@breakdown-sh', 'core', 'dist'),
      stagedCoreSource,
      { recursive: true },
    );
    const coreTestNames = (await readdir(join(repositoryRoot, 'packages', 'breakdown-core', 'src')))
      .filter((name) => name.endsWith('.test.ts'))
      .sort();
    for (const name of coreTestNames) {
      await cp(
        join(repositoryRoot, 'packages', 'breakdown-core', 'src', name),
        join(stagedCoreSource, name),
      );
    }
    await cp(
      join(repositoryRoot, 'packages', 'breakdown-core', 'src', 'publication-child.mjs'),
      join(stagedCoreSource, 'publication-child.mjs'),
    );
    return {
      qualificationRoot,
      installation,
      contractTestPath: join(contractsRoot, 'contract-corpus.test.ts'),
      coreTestPaths: coreTestNames.map((name) => join(stagedCoreSource, name)),
      cliExecutable: join(
        qualificationRoot,
        'node_modules',
        '@breakdown-sh',
        'cli',
        'dist',
        'index.js',
      ),
      mcpExecutable: join(
        qualificationRoot,
        'node_modules',
        '@breakdown-sh',
        'mcp',
        'dist',
        'index.js',
      ),
    };
  } catch (error) {
    await rm(qualificationRoot, { force: true, recursive: true });
    throw error;
  }
}

async function writeTaskLog(path, task) {
  let report;
  try {
    const value = await task();
    report = {
      success: true,
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 0,
      value,
    };
  } catch (error) {
    report = {
      success: false,
      numTotalTests: 1,
      numPassedTests: 0,
      numFailedTests: 1,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
    };
  }
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

export async function runVitestLog({ environment, logPath, repositoryRoot, testPaths }) {
  const vitestPath = join(dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  const testFilters = testPaths.map((path) => {
    const filter = relative(repositoryRoot, path);
    invariant(
      filter.length > 0 &&
        filter !== '..' &&
        !filter.startsWith('../') &&
        !filter.startsWith('..\\'),
      `Qualification test path is outside the repository root: ${path}`,
    );
    return filter.replaceAll('\\', '/');
  });
  const childEnvironment = { ...process.env, ...environment };
  delete childEnvironment.VITEST_POOL_ID;
  delete childEnvironment.VITEST_WORKER_ID;
  delete childEnvironment.VITEST_VM_POOL;
  let processFacts;
  try {
    const result = await execFileAsync(
      process.execPath,
      [
        vitestPath,
        'run',
        ...testFilters,
        '--config',
        join(repositoryRoot, 'scripts', 'local-release', 'qualification-vitest.config.mjs'),
        '--reporter=json',
        '--reporter=default',
        `--outputFile=${logPath}`,
      ],
      {
        cwd: repositoryRoot,
        env: childEnvironment,
        maxBuffer: 50 * 1024 * 1024,
      },
    );
    processFacts = { exit_code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    processFacts = {
      exit_code: typeof error === 'object' && error !== null && 'code' in error ? error.code : null,
      stdout:
        typeof error === 'object' && error !== null && 'stdout' in error
          ? String(error.stdout)
          : '',
      stderr:
        typeof error === 'object' && error !== null && 'stderr' in error
          ? String(error.stderr)
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }

  let report;
  try {
    report = parseJson(await readFile(logPath), `Vitest report ${basename(logPath)}`);
  } catch {
    report = {
      success: false,
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 1,
      testResults: [],
    };
  }
  report.qualification_process = processFacts;
  if (processFacts.exit_code !== 0) report.success = false;
  await writeFile(logPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return report;
}

async function suiteRecord(id, categories, logPath, report) {
  const bytes = await readFile(logPath);
  return {
    id,
    categories,
    status: report.success === true ? 'passed' : 'failed',
    tests: report.numTotalTests ?? 0,
    failures: report.numFailedTests ?? (report.success === true ? 0 : 1),
    skipped: (report.numPendingTests ?? 0) + (report.numTodoTests ?? 0),
    log: {
      path: basename(logPath),
      sha256: sha256(bytes),
    },
  };
}

function suitesPassed(suites, ids) {
  return ids.every((id) => suites.find((suite) => suite.id === id)?.status === 'passed');
}

function compatibilityEvidence(suites) {
  return {
    policy:
      'Validate the current disk family and every supported current/prior protocol family; inspect any prior stable disk family not exercised by this candidate.',
    disk_families: PLATFORM_QUALIFICATION_POLICY.diskFamilies.map((definition) => ({
      ...definition,
      result: suitesPassed(suites, definition.suites) ? 'validated' : 'failed',
    })),
    protocol_families: PLATFORM_QUALIFICATION_POLICY.protocolFamilies.map((definition) => ({
      ...definition,
      result: suitesPassed(suites, definition.suites) ? 'validated' : 'failed',
    })),
    prior_stable_disk_families: [],
  };
}

function normativeEvidence(suites) {
  return PLATFORM_QUALIFICATION_POLICY.normativeDimensions.map((definition) => ({
    ...definition,
    result: suitesPassed(suites, definition.suites) ? 'validated' : 'failed',
  }));
}

function raceCampaignEvidence(suites) {
  const result = suites.find((suite) => suite.id === 'core')?.status ?? 'failed';
  return PLATFORM_QUALIFICATION_POLICY.raceCampaigns.map((campaign) => ({
    ...campaign,
    result,
  }));
}

export async function qualifyLocalRelease({
  candidateDirectory,
  evidenceDirectory,
  expectedArchitecture,
  expectedOs,
  repositoryRoot,
}) {
  const candidatePath = resolve(candidateDirectory);
  const evidencePath = resolve(evidenceDirectory);
  const sourceRoot = resolve(repositoryRoot);
  await mkdir(evidencePath, { recursive: true });
  invariant(
    (await readdir(evidencePath)).length === 0,
    `Qualification evidence directory must be empty: ${evidencePath}`,
  );
  invariant(
    /^v24\.\d+\.\d+$/.test(process.version),
    `Qualification requires an exact Node 24 patch, received ${process.version}.`,
  );
  const tuple = currentPlatformTuple();
  invariant(tuple.os === expectedOs, `Expected ${expectedOs}, running on ${tuple.os}.`);
  invariant(
    tuple.architecture === expectedArchitecture,
    `Expected ${expectedArchitecture}, running on ${tuple.architecture}.`,
  );
  invariant(
    MAINTAINED_PLATFORM_TUPLES.some((maintained) => tupleKey(maintained) === tupleKey(tuple)),
    `Tuple ${tupleKey(tuple)} is not maintained.`,
  );

  const { manifest, digest } = await readCandidateRelease(candidatePath);
  const provenance = await readCandidateProvenance(candidatePath, manifest.release_version);
  const suites = [];
  const inspectionLogPath = join(evidencePath, 'candidate-inspection.json');
  const inspection = await writeTaskLog(inspectionLogPath, () =>
    inspectReleaseCandidate({
      candidateDirectory: candidatePath,
      releaseVersion: manifest.release_version,
    }),
  );
  suites.push(
    await suiteRecord(
      'candidate-inspection',
      ['package', 'archive', 'license', 'security'],
      inspectionLogPath,
      inspection,
    ),
  );

  let staged;
  const installationLogPath = join(evidencePath, 'candidate-installation.json');
  const installation = await writeTaskLog(installationLogPath, async () => {
    staged = await stageQualificationWorkspace({
      candidateDirectory: candidatePath,
      releaseVersion: manifest.release_version,
      repositoryRoot: sourceRoot,
    });
    return {
      stdout: staged.installation.stdout,
      stderr: staged.installation.stderr,
    };
  });
  suites.push(
    await suiteRecord(
      'candidate-installation',
      ['package', 'disk'],
      installationLogPath,
      installation,
    ),
  );

  try {
    if (staged !== undefined) {
      const environment = {
        BREAKDOWN_TEST_CANDIDATE: 'true',
        BREAKDOWN_TEST_REPOSITORY_ROOT: staged.qualificationRoot,
        BREAKDOWN_TEST_INSTALLATION_ROOT: staged.qualificationRoot,
        BREAKDOWN_TEST_CLI_EXECUTABLE: staged.cliExecutable,
        BREAKDOWN_TEST_MCP_EXECUTABLE: staged.mcpExecutable,
      };
      for (const definition of [
        {
          id: 'contract-corpus',
          categories: ['core', 'package'],
          testPaths: [staged.contractTestPath],
        },
        {
          id: 'core',
          categories: ['core', 'disk', 'crash', 'concurrency', 'security'],
          testPaths: staged.coreTestPaths,
        },
        {
          id: 'cli',
          categories: ['cli', 'transport', 'signal', 'git'],
          testPaths: [join(sourceRoot, 'packages', 'breakdown-cli', 'src', 'index.test.ts')],
        },
        {
          id: 'mcp',
          categories: ['transport', 'cancellation', 'signal', 'protocol'],
          testPaths: [join(sourceRoot, 'packages', 'breakdown-mcp', 'src', 'index.test.ts')],
        },
      ]) {
        const logPath = join(evidencePath, `${definition.id}.json`);
        const report = await runVitestLog({
          environment,
          logPath,
          repositoryRoot: sourceRoot,
          testPaths: definition.testPaths,
        });
        suites.push(await suiteRecord(definition.id, definition.categories, logPath, report));
      }
    }

    const corpusBytes =
      staged === undefined
        ? await readFile(join(sourceRoot, 'local', 'contracts', 'MANIFEST.json'))
        : await readFile(join(staged.qualificationRoot, 'local', 'contracts', 'MANIFEST.json'));
    const allPassed =
      suites.length === PLATFORM_QUALIFICATION_POLICY.suites.length &&
      suites.every((suite) => suite.status === 'passed');
    const immutable = process.env.GITHUB_ACTIONS === 'true';
    const evidence = {
      schema_version: 'breakdown.platform-qualification-evidence.v1',
      release_version: manifest.release_version,
      status: allPassed ? 'passed' : 'failed',
      tuple,
      environment: {
        os: {
          platform: process.platform,
          release: osRelease(),
          version: osVersion(),
        },
        architecture: tuple.architecture,
        node: process.version,
        filesystem: await filesystemIdentity(tmpdir()),
        runner: {
          provider: immutable ? 'github-actions' : 'local',
          name: process.env.RUNNER_NAME ?? 'local-process',
          label: process.env.BREAKDOWN_QUALIFICATION_RUNNER_LABEL ?? 'local',
          os: process.env.RUNNER_OS ?? tuple.os,
          architecture: process.env.RUNNER_ARCH ?? tuple.architecture,
          image: process.env.ImageOS ?? 'local',
          image_version: process.env.ImageVersion ?? 'local',
        },
        corpus_revision: {
          file: 'local/contracts/MANIFEST.json',
          sha256: sha256(corpusBytes),
        },
        candidate_digest: digest,
      },
      source: {
        repository: provenance.source.repository,
        git_commit: provenance.source.git_commit,
      },
      compatibility: compatibilityEvidence(suites),
      normative_dimensions: normativeEvidence(suites),
      race_campaigns: raceCampaignEvidence(suites),
      suites,
      git_modes: {
        present: suites.find((suite) => suite.id === 'cli')?.status ?? 'failed',
        absent: suites.find((suite) => suite.id === 'cli')?.status ?? 'failed',
        comparison:
          suites.find((suite) => suite.id === 'cli')?.status === 'passed' ? 'identical' : 'failed',
        suite: 'cli',
        test: PLATFORM_QUALIFICATION_POLICY.gitModeTest,
      },
      immutability: {
        mechanism: immutable ? 'github-actions-artifact-v7' : 'local-unindexed',
        workflow_run_id: process.env.GITHUB_RUN_ID ?? 'local',
        workflow_run_attempt: process.env.GITHUB_RUN_ATTEMPT ?? 'local',
        artifact_name: `breakdown-platform-evidence-${tuple.os}-${tuple.architecture}`,
      },
      gate: {
        satisfied: false,
        reason: allPassed
          ? 'This row must be collected with every maintained tuple in the immutable platform evidence index.'
          : 'One or more required suites failed.',
      },
    };
    const evidenceFile = join(evidencePath, 'platform-evidence.json');
    await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, {
      mode: 0o600,
    });
    if (!allPassed) {
      const failedSuites = suites
        .filter((suite) => suite.status !== 'passed')
        .map((suite) => suite.id)
        .join(', ');
      throw new Error(
        `Platform qualification failed in ${failedSuites || 'the required suite set'}; retained evidence at ${evidenceFile}.`,
      );
    }
    return evidence;
  } finally {
    if (staged !== undefined) {
      await rm(staged.qualificationRoot, { force: true, recursive: true });
    }
  }
}

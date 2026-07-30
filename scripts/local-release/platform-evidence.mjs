import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import { sha256 } from './filesystem.mjs';

function frozenRows(rows) {
  return Object.freeze(
    rows.map((row) => Object.freeze({ ...row, suites: Object.freeze(row.suites) })),
  );
}

export const PLATFORM_QUALIFICATION_POLICY = Object.freeze({
  suites: Object.freeze([
    'candidate-inspection',
    'candidate-installation',
    'contract-corpus',
    'core',
    'cli',
    'mcp',
  ]),
  diskFamilies: frozenRows([{ family: 'breakdown.run.v1', suites: ['core'] }]),
  protocolFamilies: frozenRows([
    {
      family: 'breakdown.operation-request.v1',
      suites: ['core', 'cli', 'mcp'],
    },
    { family: 'breakdown.cli-output.v1', suites: ['cli'] },
    { family: 'mcp-2025-06-18', suites: ['mcp'] },
    { family: 'mcp-2025-11-25', suites: ['mcp'] },
  ]),
  normativeDimensions: frozenRows([
    { id: 'exact-bytes', suites: ['contract-corpus', 'core', 'cli', 'mcp'] },
    { id: 'stable-ordering', suites: ['core', 'cli', 'mcp'] },
    { id: 'portable-paths', suites: ['core', 'cli'] },
    { id: 'permissions', suites: ['core'] },
    { id: 'atomic-publication', suites: ['core'] },
    { id: 'cancellation', suites: ['mcp'] },
    { id: 'signals', suites: ['cli', 'mcp'] },
    { id: 'transport', suites: ['cli', 'mcp'] },
  ]),
  raceCampaigns: Object.freeze([
    Object.freeze({
      id: 'same-opportunity',
      iterations: 100,
      suite: 'core',
      test: 'should elect one winner in 100 seeded same-opportunity races',
    }),
    Object.freeze({
      id: 'independent-submission',
      iterations: 100,
      suite: 'core',
      test: 'should retain both valid Results in 100 seeded independent-submission races',
    }),
  ]),
  gitModeTest: 'should produce the same six-operation trace with and without Git',
});

export const MAINTAINED_PLATFORM_TUPLES = Object.freeze([
  Object.freeze({ os: 'linux-glibc', architecture: 'x64' }),
  Object.freeze({ os: 'linux-glibc', architecture: 'arm64' }),
  Object.freeze({ os: 'macos', architecture: 'x64' }),
  Object.freeze({ os: 'macos', architecture: 'arm64' }),
]);

export const MAINTAINED_PLATFORM_RUNNERS = Object.freeze({
  'linux-glibc/x64': 'ubuntu-24.04',
  'linux-glibc/arm64': 'ubuntu-24.04-arm',
  'macos/x64': 'macos-15-intel',
  'macos/arm64': 'macos-15',
});

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

export async function readCandidateRelease(candidateDirectory) {
  const names = (await readdir(candidateDirectory)).filter((name) =>
    /^breakdown-release-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?\.json$/.test(name),
  );
  invariant(names.length === 1, 'Candidate must contain exactly one release manifest.');
  const path = join(candidateDirectory, names[0]);
  const manifest = parseJson(await readFile(path), 'Candidate release manifest');
  invariant(
    manifest.schema_version === 'breakdown.release-manifest.v1',
    'Candidate release manifest has the wrong schema.',
  );
  invariant(
    Array.isArray(manifest.platform_conformance?.maintained_tuples) &&
      JSON.stringify(manifest.platform_conformance.maintained_tuples) ===
        JSON.stringify(MAINTAINED_PLATFORM_TUPLES),
    'Candidate release manifest does not name the exact maintained platform tuples.',
  );
  const digest = manifest.platform_conformance?.current_build?.candidate_digest;
  invariant(
    digest?.algorithm === 'SHA-256' && /^[0-9a-f]{64}$/.test(digest.content),
    'Candidate release manifest has no valid candidate digest.',
  );
  const corpusRevision = manifest.platform_conformance?.current_build?.corpus_revision;
  invariant(
    corpusRevision?.file === 'local/contracts/MANIFEST.json' &&
      /^[0-9a-f]{64}$/.test(corpusRevision.sha256),
    'Candidate release manifest has no valid corpus revision.',
  );
  return { manifest, digest, corpusRevision };
}

export async function readCandidateProvenance(candidateDirectory, releaseVersion) {
  const path = join(candidateDirectory, `breakdown-provenance-inputs-${releaseVersion}.json`);
  const provenance = parseJson(await readFile(path), 'Candidate provenance inputs');
  invariant(
    provenance.schema_version === 'breakdown.provenance-inputs.v1' &&
      provenance.release_version === releaseVersion,
    'Candidate provenance inputs are not release lockstep.',
  );
  invariant(
    typeof provenance.source?.repository === 'string' &&
      provenance.source.repository.length > 0 &&
      /^[0-9a-f]{40}$/.test(provenance.source?.git_commit ?? ''),
    'Candidate provenance inputs have no exact source revision.',
  );
  return provenance;
}

function validateCompatibility(evidence, label) {
  for (const [familyName, expectedDefinitions] of [
    ['disk_families', PLATFORM_QUALIFICATION_POLICY.diskFamilies],
    ['protocol_families', PLATFORM_QUALIFICATION_POLICY.protocolFamilies],
  ]) {
    const families = evidence.compatibility?.[familyName];
    invariant(
      Array.isArray(families) &&
        JSON.stringify(
          families.map(({ family, suites }) => ({
            family,
            suites,
          })),
        ) === JSON.stringify(expectedDefinitions) &&
        families.every((family) => family.result === 'validated' || family.result === 'inspected'),
      `${label} does not cover the exact ${familyName.replace('_', ' ')} compatibility set.`,
    );
  }
}

function validateNormativeCoverage(evidence, label) {
  const dimensions = evidence.normative_dimensions;
  invariant(
    Array.isArray(dimensions) &&
      JSON.stringify(dimensions.map(({ id, suites }) => ({ id, suites }))) ===
        JSON.stringify(PLATFORM_QUALIFICATION_POLICY.normativeDimensions) &&
      dimensions.every((dimension) => dimension.result === 'validated'),
    `${label} does not validate every normative cross-platform dimension.`,
  );

  const campaigns = evidence.race_campaigns;
  invariant(
    Array.isArray(campaigns) &&
      JSON.stringify(
        campaigns.map(({ id, iterations, suite, test }) => ({
          id,
          iterations,
          suite,
          test,
        })),
      ) === JSON.stringify(PLATFORM_QUALIFICATION_POLICY.raceCampaigns) &&
      campaigns.every((campaign) => campaign.result === 'passed'),
    `${label} does not contain both required 100-iteration race campaigns.`,
  );
}

function assertionsIn(report) {
  return (report.testResults ?? []).flatMap((result) => result.assertionResults ?? []);
}

async function validateRetainedLogs(evidence, evidencePath, label) {
  const reports = new Map();
  for (const suite of evidence.suites) {
    invariant(
      basename(suite.log.path) === suite.log.path,
      `${label} suite ${suite.id} has an unsafe log path.`,
    );
    const logPath = join(dirname(evidencePath), suite.log.path);
    let bytes;
    try {
      bytes = await readFile(logPath);
    } catch {
      throw new Error(`${label} suite ${suite.id} has no retained log.`);
    }
    invariant(
      sha256(bytes) === suite.log.sha256,
      `${label} suite ${suite.id} retained-log digest does not match.`,
    );
    const report = parseJson(bytes, `${label} suite ${suite.id} retained log`);
    invariant(
      report.success === true &&
        report.numTotalTests === suite.tests &&
        report.numFailedTests === suite.failures,
      `${label} suite ${suite.id} retained log does not prove its result.`,
    );
    reports.set(suite.id, report);
  }

  const coreAssertions = assertionsIn(reports.get('core'));
  for (const campaign of PLATFORM_QUALIFICATION_POLICY.raceCampaigns) {
    invariant(
      coreAssertions.some(
        (assertion) => assertion.title === campaign.test && assertion.status === 'passed',
      ),
      `${label} retained core log does not prove race campaign ${campaign.id}.`,
    );
  }
  const cliAssertions = assertionsIn(reports.get('cli'));
  invariant(
    cliAssertions.some(
      (assertion) =>
        assertion.title === PLATFORM_QUALIFICATION_POLICY.gitModeTest &&
        assertion.status === 'passed',
    ),
    `${label} retained CLI log does not prove Git-independent operation behavior.`,
  );
}

async function validateEvidence(evidence, evidencePath, label, releaseVersion, candidateDigest) {
  invariant(
    evidence.schema_version === 'breakdown.platform-qualification-evidence.v1',
    `${label} has the wrong schema.`,
  );
  invariant(evidence.release_version === releaseVersion, `${label} is not release lockstep.`);
  invariant(evidence.status === 'passed', `${label} did not pass qualification.`);
  const expectedPlatform =
    evidence.tuple?.os === 'linux-glibc'
      ? 'linux'
      : evidence.tuple?.os === 'macos'
        ? 'darwin'
        : undefined;
  invariant(
    evidence.environment?.os?.platform === expectedPlatform &&
      evidence.environment?.architecture === evidence.tuple?.architecture,
    `${label} environment does not match its platform tuple.`,
  );
  invariant(
    typeof evidence.environment?.os?.release === 'string' &&
      evidence.environment.os.release.length > 0 &&
      typeof evidence.environment?.os?.version === 'string' &&
      evidence.environment.os.version.length > 0,
    `${label} has no exact OS identity.`,
  );
  invariant(
    evidence.environment?.candidate_digest?.algorithm === 'SHA-256' &&
      evidence.environment.candidate_digest.content === candidateDigest.content,
    `${label} names a different candidate digest.`,
  );
  invariant(
    evidence.environment?.corpus_revision?.file === 'local/contracts/MANIFEST.json' &&
      /^[0-9a-f]{64}$/.test(evidence.environment.corpus_revision.sha256),
    `${label} has no valid corpus revision.`,
  );
  invariant(
    /^v24\.\d+\.\d+$/.test(evidence.environment?.node ?? ''),
    `${label} did not use an exact Node 24 patch.`,
  );
  invariant(
    typeof evidence.environment?.filesystem?.name === 'string' &&
      evidence.environment.filesystem.name.length > 0 &&
      typeof evidence.environment?.filesystem?.type === 'string' &&
      evidence.environment.filesystem.type.length > 0,
    `${label} has no filesystem identity.`,
  );
  invariant(
    evidence.environment?.runner?.provider === 'github-actions' &&
      typeof evidence.environment.runner.name === 'string' &&
      evidence.environment.runner.name.length > 0 &&
      typeof evidence.environment.runner.os === 'string' &&
      evidence.environment.runner.os.length > 0 &&
      typeof evidence.environment.runner.architecture === 'string' &&
      evidence.environment.runner.architecture.toLowerCase() === evidence.tuple.architecture &&
      typeof evidence.environment.runner.image === 'string' &&
      evidence.environment.runner.image.length > 0 &&
      typeof evidence.environment.runner.image_version === 'string' &&
      evidence.environment.runner.image_version.length > 0,
    `${label} has no exact GitHub Actions runner identity.`,
  );
  invariant(
    evidence.environment.runner.label === MAINTAINED_PLATFORM_RUNNERS[tupleKey(evidence.tuple)],
    `${label} did not use the required native runner.`,
  );
  invariant(
    Array.isArray(evidence.suites) &&
      JSON.stringify(evidence.suites.map((suite) => suite.id)) ===
        JSON.stringify(PLATFORM_QUALIFICATION_POLICY.suites) &&
      evidence.suites.every(
        (suite) =>
          suite.status === 'passed' &&
          Number.isInteger(suite.tests) &&
          suite.tests > 0 &&
          suite.failures === 0 &&
          typeof suite.log?.path === 'string' &&
          /^[0-9a-f]{64}$/.test(suite.log?.sha256 ?? ''),
      ),
    `${label} contains an incomplete or failing suite.`,
  );
  invariant(
    evidence.git_modes?.present === 'passed' &&
      evidence.git_modes?.absent === 'passed' &&
      evidence.git_modes?.comparison === 'identical' &&
      evidence.git_modes?.suite === 'cli' &&
      evidence.git_modes?.test === PLATFORM_QUALIFICATION_POLICY.gitModeTest,
    `${label} did not qualify both Git modes.`,
  );
  validateCompatibility(evidence, label);
  validateNormativeCoverage(evidence, label);
  await validateRetainedLogs(evidence, evidencePath, label);
  invariant(
    evidence.immutability?.mechanism === 'github-actions-artifact-v7' &&
      typeof evidence.immutability.workflow_run_id === 'string' &&
      evidence.immutability.workflow_run_id.length > 0 &&
      typeof evidence.immutability.workflow_run_attempt === 'string' &&
      evidence.immutability.workflow_run_attempt.length > 0 &&
      typeof evidence.immutability.artifact_name === 'string' &&
      evidence.immutability.artifact_name.length > 0,
    `${label} is not bound to immutable GitHub Actions artifact storage.`,
  );
  invariant(
    typeof evidence.source?.repository === 'string' &&
      evidence.source.repository.length > 0 &&
      typeof evidence.source?.git_commit === 'string' &&
      /^[0-9a-f]{40}$/.test(evidence.source.git_commit),
    `${label} has no exact Git commit.`,
  );
}

export async function indexPlatformEvidence({ candidateDirectory, evidencePaths, outputPath }) {
  const { manifest, digest, corpusRevision } = await readCandidateRelease(candidateDirectory);
  const provenance = await readCandidateProvenance(candidateDirectory, manifest.release_version);
  invariant(
    evidencePaths.length === MAINTAINED_PLATFORM_TUPLES.length,
    `Expected ${MAINTAINED_PLATFORM_TUPLES.length} platform evidence rows.`,
  );

  const byTuple = new Map();
  for (const path of evidencePaths) {
    const bytes = await readFile(path);
    const label = `Platform evidence ${basename(path)}`;
    const evidence = parseJson(bytes, label);
    await validateEvidence(evidence, path, label, manifest.release_version, digest);
    const key = tupleKey(evidence.tuple ?? {});
    invariant(
      MAINTAINED_PLATFORM_TUPLES.some((tuple) => tupleKey(tuple) === key),
      `${label} names unmaintained tuple ${key}.`,
    );
    invariant(!byTuple.has(key), `Platform tuple ${key} appears more than once.`);
    byTuple.set(key, { bytes, evidence });
  }

  const ordered = MAINTAINED_PLATFORM_TUPLES.map((tuple) => {
    const row = byTuple.get(tupleKey(tuple));
    invariant(row !== undefined, `Platform tuple ${tupleKey(tuple)} has no evidence.`);
    return row;
  });
  const corpusDigest = ordered[0].evidence.environment.corpus_revision.sha256;
  const gitCommit = ordered[0].evidence.source.git_commit;
  const sourceRepository = ordered[0].evidence.source.repository;
  invariant(
    corpusDigest === corpusRevision.sha256,
    'Platform evidence does not use the candidate corpus revision.',
  );
  invariant(
    gitCommit === provenance.source.git_commit && sourceRepository === provenance.source.repository,
    'Platform evidence does not use the candidate source revision.',
  );
  for (const row of ordered) {
    invariant(
      row.evidence.environment.corpus_revision.sha256 === corpusDigest,
      'Platform evidence rows use different corpus revisions.',
    );
    invariant(
      row.evidence.source.git_commit === gitCommit,
      'Platform evidence rows use different Git commits.',
    );
    invariant(
      row.evidence.source.repository === sourceRepository,
      'Platform evidence rows use different source repositories.',
    );
  }

  const index = {
    schema_version: 'breakdown.platform-qualification-index.v1',
    release_version: manifest.release_version,
    status: 'passed',
    candidate_digest: digest,
    corpus_revision: {
      file: 'local/contracts/MANIFEST.json',
      sha256: corpusDigest,
    },
    source: {
      repository: sourceRepository,
      git_commit: gitCommit,
    },
    rows: ordered.map(({ bytes, evidence }) => ({
      tuple: evidence.tuple,
      status: evidence.status,
      evidence: {
        artifact_name: evidence.immutability.artifact_name,
        mechanism: evidence.immutability.mechanism,
        workflow_run_id: evidence.immutability.workflow_run_id,
        workflow_run_attempt: evidence.immutability.workflow_run_attempt,
        file_sha256: sha256(bytes),
      },
    })),
    gate: {
      requirement: 'Only passing, indexed, immutable evidence satisfies platform qualification.',
      satisfied: true,
    },
  };
  await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o600 });
  return index;
}

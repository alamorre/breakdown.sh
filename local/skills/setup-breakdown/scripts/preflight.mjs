#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { arch, platform, release, version } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_VERSION = '1.0.1';
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
const ATTESTATION_TIMEOUT_MS = 30_000;
const HOST_EVIDENCE_REPOSITORY = 'alamorre/breakdown.sh';
const HOST_EVIDENCE_SIGNER_WORKFLOW =
  'alamorre/breakdown.sh/.github/workflows/local-host-support.yml';
const USAGE = `Usage:
  node preflight.mjs --mode full --project ABSOLUTE_PATH --host SURFACE --host-version VERSION [--host-evidence-index ABSOLUTE_PATH --host-evidence-bundle ABSOLUTE_PATH --candidate-directory ABSOLUTE_PATH] [--cli-command COMMAND] [--cli-arg ARG]... [--mcp-command COMMAND] [--mcp-arg ARG]...
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
    hostEvidenceIndex: undefined,
    hostEvidenceBundle: undefined,
    candidateDirectory: undefined,
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
    ['--host-evidence-index', 'hostEvidenceIndex'],
    ['--host-evidence-bundle', 'hostEvidenceBundle'],
    ['--candidate-directory', 'candidateDirectory'],
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
  const hostEvidenceInputs = [
    values.hostEvidenceIndex,
    values.hostEvidenceBundle,
    values.candidateDirectory,
  ];
  const hostEvidenceInputCount = hostEvidenceInputs.filter((value) => value !== undefined).length;
  if (
    (values.mode !== 'full' && values.mode !== 'fast') ||
    values.project === undefined ||
    values.host === undefined ||
    values.hostVersion === undefined ||
    values.cliCommand.length === 0 ||
    !isAbsolute(values.project) ||
    (values.mode === 'fast' && values.skill === undefined) ||
    (values.mode === 'full' && values.skill !== undefined) ||
    (hostEvidenceInputCount !== 0 && hostEvidenceInputCount !== hostEvidenceInputs.length) ||
    (hostEvidenceInputCount > 0 &&
      (values.mode !== 'full' || hostEvidenceInputs.some((value) => !isAbsolute(value)))) ||
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
      os_release: release(),
      os_version: version(),
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

function runProcess(command, args, input, timeoutMs = PROCESS_TIMEOUT_MS) {
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
        error: `process timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
  });
}

async function verifyHostEvidenceAttestation(indexPath, bundlePath) {
  for (const [path, label] of [
    [indexPath, 'host evidence index'],
    [bundlePath, 'host evidence attestation bundle'],
  ]) {
    const facts = await lstat(path);
    if (!facts.isFile()) throw new Error(`${label} is not a regular file`);
  }
  const claimedIndex = JSON.parse(await readFile(indexPath, 'utf8'));
  if (!/^[0-9a-f]{40}$/.test(claimedIndex?.source?.git_commit ?? '')) {
    throw new Error('host evidence index has no exact source digest');
  }
  const result = await runProcess(
    'gh',
    [
      'attestation',
      'verify',
      indexPath,
      '--bundle',
      bundlePath,
      '--repo',
      HOST_EVIDENCE_REPOSITORY,
      '--signer-workflow',
      HOST_EVIDENCE_SIGNER_WORKFLOW,
      '--source-ref',
      `refs/tags/breakdown-local-v${RELEASE_VERSION}`,
      '--source-digest',
      claimedIndex.source.git_commit,
      '--format',
      'json',
    ],
    undefined,
    ATTESTATION_TIMEOUT_MS,
  );
  let attestations;
  try {
    attestations = JSON.parse(result.stdout);
  } catch {
    attestations = undefined;
  }
  if (
    result.error !== undefined ||
    result.status !== 0 ||
    !Array.isArray(attestations) ||
    attestations.length === 0
  ) {
    throw new Error(
      result.error ||
        result.stderr.trim() ||
        'GitHub could not authenticate the host evidence index attestation',
    );
  }
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
    manifest.supported_hosts.length !== 0 ||
    manifest.skills.length !== EXPECTED_SKILL_NAMES.length ||
    manifest.skills.some((skill, index) => skill?.name !== EXPECTED_SKILL_NAMES[index])
  ) {
    throw new Error('embedded skill-pack manifest is invalid or mismatched');
  }
  return manifest;
}

function releaseArtifact(manifest, role, filePattern) {
  const matches =
    manifest.artifacts?.filter(
      (artifact) =>
        artifact?.role === role &&
        (filePattern === undefined || filePattern.test(artifact?.file ?? '')),
    ) ?? [];
  if (matches.length !== 1) throw new Error(`candidate has no exact ${role} artifact`);
  return matches[0];
}

async function verifyCandidateArtifact(candidateDirectory, artifact, label) {
  if (
    typeof artifact?.file !== 'string' ||
    basename(artifact.file) !== artifact.file ||
    !sha256Digest(artifact.hashes?.sha256)
  ) {
    throw new Error(`candidate ${label} inventory is invalid`);
  }
  const path = join(candidateDirectory, artifact.file);
  const facts = await lstat(path);
  if (!facts.isFile()) throw new Error(`candidate ${label} is not a regular file`);
  const digest = sha256(await readFile(path));
  if (digest !== artifact.hashes.sha256) throw new Error(`candidate ${label} digest differs`);
  return { file: artifact.file, sha256: digest };
}

async function readCandidateBinding(candidateDirectory) {
  const directoryFacts = await lstat(candidateDirectory);
  if (!directoryFacts.isDirectory()) throw new Error('candidate directory is not a directory');
  const releaseManifestPath = join(candidateDirectory, `breakdown-release-${RELEASE_VERSION}.json`);
  const releaseManifestFacts = await lstat(releaseManifestPath);
  if (!releaseManifestFacts.isFile()) {
    throw new Error('candidate release manifest is not a regular file');
  }
  const releaseManifest = JSON.parse(await readFile(releaseManifestPath, 'utf8'));
  const declaredDigest = releaseManifest.platform_conformance?.current_build?.candidate_digest;
  if (
    releaseManifest.schema_version !== 'breakdown.release-manifest.v1' ||
    releaseManifest.release_version !== RELEASE_VERSION ||
    declaredDigest?.algorithm !== 'SHA-256' ||
    !sha256Digest(declaredDigest.content)
  ) {
    throw new Error('candidate release manifest is invalid or mismatched');
  }

  const provenanceArtifact = releaseArtifact(releaseManifest, 'provenance-inputs');
  await verifyCandidateArtifact(candidateDirectory, provenanceArtifact, 'provenance inputs');
  const provenance = JSON.parse(
    await readFile(join(candidateDirectory, provenanceArtifact.file), 'utf8'),
  );
  if (
    provenance.schema_version !== 'breakdown.provenance-inputs.v1' ||
    provenance.release_version !== RELEASE_VERSION ||
    !Array.isArray(provenance.subjects) ||
    provenance.source?.repository !== 'https://github.com/alamorre/breakdown.sh' ||
    !/^[0-9a-f]{40}$/.test(provenance.source?.git_commit ?? '')
  ) {
    throw new Error('candidate provenance inputs are invalid or mismatched');
  }
  const subjectNames = new Set();
  const subjectInventory = [];
  for (const subject of provenance.subjects) {
    if (
      typeof subject?.name !== 'string' ||
      basename(subject.name) !== subject.name ||
      subjectNames.has(subject.name) ||
      !sha256Digest(subject.digest?.sha256)
    ) {
      throw new Error('candidate provenance subject inventory is invalid');
    }
    subjectNames.add(subject.name);
    const path = join(candidateDirectory, subject.name);
    const facts = await lstat(path);
    if (!facts.isFile())
      throw new Error(`candidate subject is not a regular file: ${subject.name}`);
    const digest = sha256(await readFile(path));
    if (digest !== subject.digest.sha256) {
      throw new Error(`candidate subject digest differs: ${subject.name}`);
    }
    subjectInventory.push(`${digest}  ${subject.name}`);
  }
  const computedDigest = sha256(Buffer.from(`${subjectInventory.sort().join('\n')}\n`));
  if (
    computedDigest !== declaredDigest.content ||
    provenance.builder?.environment?.candidate_digest?.content !== computedDigest
  ) {
    throw new Error('candidate digest is not derived from its exact primary artifacts');
  }

  const installedSkillManifestDigest = sha256(await readFile(MANIFEST_PATH));
  const skillManifestInput = provenance.source?.source_inputs?.find(
    (input) => input?.path === 'local/skills/setup-breakdown/assets/skill-pack-manifest.json',
  );
  if (skillManifestInput?.sha256 !== installedSkillManifestDigest) {
    throw new Error('installed canonical skills do not match the selected candidate');
  }

  const skillArchive = await verifyCandidateArtifact(
    candidateDirectory,
    releaseArtifact(releaseManifest, 'skills-archive', /\.tar\.gz$/),
    'skills archive',
  );
  const packages = [];
  for (const role of ['core-library', 'command-line-interface', 'mcp-adapter']) {
    packages.push(
      await verifyCandidateArtifact(
        candidateDirectory,
        releaseArtifact(releaseManifest, role),
        `${role} package`,
      ),
    );
  }
  return {
    digest: { algorithm: 'SHA-256', content: computedDigest },
    source: {
      repository: provenance.source.repository,
      git_commit: provenance.source.git_commit,
    },
    provenanceInputs: {
      file: provenanceArtifact.file,
      sha256: provenanceArtifact.hashes.sha256,
    },
    skillArchive,
    packages,
  };
}

async function readHostEvidenceIndex(path, candidateBinding) {
  const facts = await lstat(path);
  if (!facts.isFile()) throw new Error('host evidence index is not a regular file');
  const index = JSON.parse(await readFile(path, 'utf8'));
  if (index?.schema_version === 'breakdown.host-support-index.v1') {
    const expectedPolicy = {
      state: 'deferred',
      certification_issue: 188,
      supported_host_claims: 0,
      evidence_rows: 0,
      capture_workflow: {
        file: '.github/workflows/local-host-evidence-capture.yml',
        workflow_id: 324133712,
        required_state: 'disabled_manually',
      },
    };
    const expectedClassifications = {
      supported:
        'No Agent Host is Supported by Breakdown Local 1.0 while certification is deferred.',
      compatible:
        'A capable Agent Host without an exact passing indexed row is Compatible, not Supported.',
      unsupported:
        'A host on a non-maintained operating system, bare model, or unprovisioned cloud surface is Unsupported for this release.',
    };
    const expectedDisclaimers = [
      'ui',
      'wording',
      'approval-mechanics',
      'latency',
      'model-prose',
      'quality',
      'cost',
      'provider-privacy',
    ];
    if (
      index.release_version !== RELEASE_VERSION ||
      index.tag !== `breakdown-local-v${RELEASE_VERSION}` ||
      index.status !== 'deferred' ||
      index.gate?.satisfied !== true ||
      JSON.stringify(index.policy) !== JSON.stringify(expectedPolicy) ||
      index.candidate_digest?.algorithm !== 'SHA-256' ||
      index.candidate_digest?.content !== candidateBinding.digest.content ||
      JSON.stringify(index.source) !== JSON.stringify(candidateBinding.source) ||
      JSON.stringify(index.coverage) !==
        JSON.stringify({
          guided_cli_operating_systems: [],
          model_families: [],
          provider_families: [],
        }) ||
      !Array.isArray(index.rows) ||
      index.rows.length !== 0 ||
      !Array.isArray(index.supported_hosts) ||
      index.supported_hosts.length !== 0 ||
      JSON.stringify(index.classifications) !== JSON.stringify(expectedClassifications) ||
      index.outcome_parity?.assessed !== false ||
      JSON.stringify(index.outcome_parity?.disclaimed_dimensions) !==
        JSON.stringify(expectedDisclaimers)
    ) {
      throw new Error('host evidence index is invalid, failing, or mismatched');
    }
    return [];
  }
  const indexedOperatingSystems = ['linux', 'macos'].filter((family) =>
    index.rows?.some((row) => row.transport === 'cli' && row.operating_system?.family === family),
  );
  const indexedModelFamilies = [
    ...new Set((index.rows ?? []).map((row) => row.model?.model_family)),
  ].sort();
  const indexedProviderFamilies = [
    ...new Set((index.rows ?? []).map((row) => row.model?.provider_family)),
  ].sort();
  const supportedHosts = (index.rows ?? []).map(supportedHostRow);
  if (
    index?.schema_version !== 'breakdown.guided-host-evidence-index.v1' ||
    index?.release_version !== RELEASE_VERSION ||
    index?.status !== 'passed' ||
    index?.gate?.satisfied !== true ||
    index?.candidate_digest?.algorithm !== 'SHA-256' ||
    index?.candidate_digest?.content !== candidateBinding.digest.content ||
    JSON.stringify(index?.source) !== JSON.stringify(candidateBinding.source) ||
    !Array.isArray(index.rows) ||
    !Array.isArray(index.supported_hosts) ||
    index.rows.length !== index.supported_hosts.length ||
    index.supported_hosts.length < 2 ||
    index.rows.some((row) => !validIndexedHostRow(row, candidateBinding)) ||
    index.supported_hosts.some((row) => !validSupportedHostRow(row)) ||
    JSON.stringify(index.coverage?.guided_cli_operating_systems) !==
      JSON.stringify(['linux', 'macos']) ||
    !Array.isArray(index.coverage?.model_families) ||
    !Array.isArray(index.coverage?.provider_families) ||
    (index.coverage.model_families.length < 2 && index.coverage.provider_families.length < 2) ||
    JSON.stringify(indexedOperatingSystems) !==
      JSON.stringify(index.coverage.guided_cli_operating_systems) ||
    JSON.stringify(indexedModelFamilies) !== JSON.stringify(index.coverage.model_families) ||
    JSON.stringify(indexedProviderFamilies) !== JSON.stringify(index.coverage.provider_families) ||
    new Set(index.rows.map(hostRowIdentity)).size !== index.rows.length ||
    JSON.stringify(index.supported_hosts) !== JSON.stringify(supportedHosts)
  ) {
    throw new Error('host evidence index is invalid, failing, or mismatched');
  }
  return index.supported_hosts;
}

function sha256Digest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function exactArtifact(value) {
  return typeof value?.file === 'string' && value.file.length > 0 && sha256Digest(value.sha256);
}

function validIndexedHostRow(row, candidateBinding) {
  const expectedPlatform = {
    linux: 'linux',
    macos: 'darwin',
  }[row?.operating_system?.family];
  return (
    typeof row?.host?.surface === 'string' &&
    row.host.surface.length > 0 &&
    typeof row.host.version === 'string' &&
    row.host.version.length > 0 &&
    ['linux', 'macos'].includes(row.operating_system?.family) &&
    row.operating_system.platform === expectedPlatform &&
    typeof row.operating_system.name === 'string' &&
    row.operating_system.name.length > 0 &&
    typeof row.operating_system.release === 'string' &&
    row.operating_system.release.length > 0 &&
    typeof row.operating_system.version === 'string' &&
    row.operating_system.version.length > 0 &&
    (row.operating_system.architecture === 'x64' ||
      row.operating_system.architecture === 'arm64') &&
    (row.transport === 'cli' || row.transport === 'mcp') &&
    row.breakdown_version === RELEASE_VERSION &&
    /^[a-z][a-z0-9-]{0,63}$/.test(row.model?.provider_family ?? '') &&
    /^[a-z][a-z0-9.-]{0,127}$/.test(row.model?.model_family ?? '') &&
    row.candidate?.digest?.algorithm === 'SHA-256' &&
    row.candidate.digest.content === candidateBinding.digest.content &&
    JSON.stringify(row.candidate.provenance_inputs) ===
      JSON.stringify(candidateBinding.provenanceInputs) &&
    JSON.stringify(row.candidate.skill_archive) === JSON.stringify(candidateBinding.skillArchive) &&
    JSON.stringify(row.candidate.packages) === JSON.stringify(candidateBinding.packages) &&
    exactArtifact(row.candidate.skill_archive) &&
    Array.isArray(row.candidate.packages) &&
    row.candidate.packages.length === 3 &&
    row.candidate.packages.every(exactArtifact) &&
    row.status === 'passed' &&
    row.evidence?.mechanism === 'github-actions-artifact-v7' &&
    /^[1-9]\d*$/.test(row.evidence.workflow_run_id) &&
    /^[1-9]\d*$/.test(row.evidence.workflow_run_attempt) &&
    typeof row.evidence.artifact_name === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(row.evidence.artifact_name) &&
    sha256Digest(row.evidence.file_sha256)
  );
}

function hostRowIdentity(row) {
  return [
    row.host.surface,
    row.host.version,
    row.operating_system.platform,
    row.operating_system.release,
    row.operating_system.version,
    row.operating_system.architecture,
    row.transport,
  ].join('\u0000');
}

function supportedHostRow(row) {
  return {
    surface: row.host?.surface,
    version: row.host?.version,
    os: row.operating_system?.platform,
    os_name: row.operating_system?.name,
    os_release: row.operating_system?.release,
    os_version: row.operating_system?.version,
    architecture: row.operating_system?.architecture,
    transport: row.transport,
    breakdown_version: row.breakdown_version,
    status: 'pass',
    artifact_digests: {
      candidate: row.candidate?.digest,
      provenance_inputs: row.candidate?.provenance_inputs,
      skill_archive: row.candidate?.skill_archive,
      packages: row.candidate?.packages,
    },
    evidence: row.evidence,
  };
}

function validSupportedHostRow(row) {
  return (
    typeof row?.surface === 'string' &&
    row.surface.length > 0 &&
    typeof row?.version === 'string' &&
    row.version.length > 0 &&
    ['linux', 'darwin'].includes(row.os) &&
    typeof row.os_name === 'string' &&
    row.os_name.length > 0 &&
    typeof row.os_release === 'string' &&
    row.os_release.length > 0 &&
    typeof row.os_version === 'string' &&
    row.os_version.length > 0 &&
    (row.architecture === 'x64' || row.architecture === 'arm64') &&
    (row.transport === 'cli' || row.transport === 'mcp') &&
    row.breakdown_version === RELEASE_VERSION &&
    row.status === 'pass' &&
    row.artifact_digests?.candidate?.algorithm === 'SHA-256' &&
    sha256Digest(row.artifact_digests.candidate.content) &&
    exactArtifact(row.artifact_digests.provenance_inputs) &&
    exactArtifact(row.artifact_digests.skill_archive) &&
    Array.isArray(row.artifact_digests.packages) &&
    row.artifact_digests.packages.length === 3 &&
    row.artifact_digests.packages.every(exactArtifact) &&
    row.evidence?.mechanism === 'github-actions-artifact-v7' &&
    /^[1-9]\d*$/.test(row.evidence.workflow_run_id) &&
    /^[1-9]\d*$/.test(row.evidence.workflow_run_attempt) &&
    typeof row.evidence.artifact_name === 'string' &&
    row.evidence.artifact_name.length > 0 &&
    sha256Digest(row.evidence.file_sha256)
  );
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

function matchingSupportedRow(supportedHosts, options, transport) {
  return supportedHosts.some(
    (row) =>
      row?.surface === options.host &&
      row?.version === options.hostVersion &&
      row?.os === platform() &&
      row?.os_release === release() &&
      row?.os_version === version() &&
      row?.architecture === arch() &&
      row?.transport === transport &&
      row?.breakdown_version === RELEASE_VERSION &&
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
  let supportedHosts = [];
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

  if (options.mode === 'full' && options.hostEvidenceIndex !== undefined) {
    try {
      await verifyHostEvidenceAttestation(options.hostEvidenceIndex, options.hostEvidenceBundle);
      checks.push(
        resultCheck(
          'host_evidence_attestation',
          'pass',
          'GitHub authenticated the index, signer workflow, repository, and immutable release tag.',
        ),
      );
    } catch (error) {
      checks.push(
        resultCheck(
          'host_evidence_attestation',
          'fail',
          error instanceof Error ? error.message : String(error),
        ),
      );
      repairRequired = true;
    }
    let candidateBinding;
    if (!repairRequired) {
      try {
        candidateBinding = await readCandidateBinding(options.candidateDirectory);
        checks.push(
          resultCheck(
            'candidate_binding',
            'pass',
            'Installed canonical skills and selected candidate artifacts share one exact digest set.',
          ),
        );
      } catch (error) {
        checks.push(
          resultCheck(
            'candidate_binding',
            'fail',
            error instanceof Error ? error.message : String(error),
          ),
        );
        repairRequired = true;
      }
    }
    if (!repairRequired && candidateBinding !== undefined) {
      try {
        supportedHosts = await readHostEvidenceIndex(options.hostEvidenceIndex, candidateBinding);
        checks.push(
          resultCheck(
            'host_evidence_index',
            'pass',
            'Exact passing immutable host evidence index matches this candidate release.',
          ),
        );
      } catch (error) {
        checks.push(
          resultCheck(
            'host_evidence_index',
            'fail',
            error instanceof Error ? error.message : String(error),
          ),
        );
        repairRequired = true;
      }
    }
  } else if (options.mode === 'full') {
    checks.push(
      resultCheck(
        'host_evidence',
        'not_provided',
        'No authenticated external host evidence set was selected; classification cannot exceed Compatible Host.',
      ),
    );
  }

  const nodeVersion = process.versions.node;
  if (SEMVER_PATTERN.test(nodeVersion) && Number(nodeVersion.split('.')[0]) === 24) {
    checks.push(resultCheck('node_version', 'pass', `Node ${nodeVersion}.`));
  } else {
    checks.push(resultCheck('node_version', 'fail', `Node 24 is required; found ${nodeVersion}.`));
    unsupported = true;
  }

  const currentPlatform = platform();
  if (currentPlatform === 'linux' || currentPlatform === 'darwin') {
    checks.push(resultCheck('platform', 'pass', 'Breakdown Local 1.0 maintains Linux and macOS.'));
  } else {
    checks.push(
      resultCheck(
        'platform',
        'fail',
        `Breakdown Local 1.0 does not maintain ${currentPlatform}; Windows and other operating systems are Unsupported.`,
      ),
    );
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
          'A mandatory runtime, platform, or filesystem capability failed.',
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
      classification = matchingSupportedRow(supportedHosts, options, transport)
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

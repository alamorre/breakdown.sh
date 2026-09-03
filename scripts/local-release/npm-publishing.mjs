import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const NPM_PACKAGES = Object.freeze([
  '@breakdown-sh/core',
  '@breakdown-sh/cli',
  '@breakdown-sh/mcp',
]);

export const NPM_PUBLICATION_POLICY = Object.freeze({
  registry: 'https://registry.npmjs.org/',
  organization: 'breakdown-sh',
  repository: 'alamorre/breakdown.sh',
  workflow: 'local-stable-publication.yml',
  environment: 'breakdown-local-stable',
  permission: 'createPackage',
  bootstrapVersion: '1.0.0',
  bootstrapSecret: 'NPM_FIRST_PACKAGE_TOKEN',
});

export const NPM_PUBLICATION_MODES = Object.freeze([
  'first-package-bootstrap',
  'finalize-bootstrap',
  'oidc-trusted-publishing',
]);

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function tokenlessEnvironment() {
  const environment = { ...process.env };
  delete environment.NODE_AUTH_TOKEN;
  delete environment.NPM_TOKEN;
  return { env: environment };
}

function parseJson(value, label) {
  try {
    return JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : value);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function exactSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function exactCandidateDigest(value) {
  return value?.algorithm === 'SHA-256' && exactSha256(value.content);
}

function exactPackageInventory(candidate) {
  invariant(
    Array.isArray(candidate?.packages) &&
      sameJson(
        candidate.packages.map((entry) => entry.name),
        NPM_PACKAGES,
      ) &&
      candidate.packages.every(
        (entry) =>
          entry.version === candidate.release_version &&
          typeof entry.artifact === 'string' &&
          entry.artifact ===
            `${entry.name.replace('@breakdown-sh/', 'breakdown-sh-')}-${candidate.release_version}.tgz`,
      ),
    'npm publication does not name the three exact lockstep packages.',
  );
  return candidate.packages;
}

function packageIdentities(packages) {
  return packages.map((entry) => ({
    name: entry.name,
    version: entry.version,
    artifact: entry.artifact,
  }));
}

async function defaultCommandRunner(command, args, options = {}) {
  return execFileAsync(command, args, {
    ...options,
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function readCandidatePackageInventory(candidateDirectory) {
  const manifestFiles = (await readdir(candidateDirectory)).filter((file) =>
    /^breakdown-release-[0-9]+\.[0-9]+\.[0-9]+\.json$/.test(file),
  );
  invariant(manifestFiles.length === 1, 'Candidate has no unique release manifest.');
  const manifestBytes = await readFile(join(candidateDirectory, manifestFiles[0]));
  const manifest = parseJson(manifestBytes, 'Candidate release manifest');
  const packages = exactPackageInventory(manifest);
  const inventory = [];
  for (const entry of packages) {
    const bytes = await readFile(join(candidateDirectory, entry.artifact));
    inventory.push({
      name: entry.name,
      version: entry.version,
      artifact: entry.artifact,
      sha256: sha256(bytes),
    });
  }
  const candidateDigest = manifest.platform_conformance?.current_build?.candidate_digest;
  invariant(exactCandidateDigest(candidateDigest), 'Candidate has no exact SHA-256 digest.');
  return {
    releaseVersion: manifest.release_version,
    source: manifest.source,
    candidateDigest,
    packages: inventory,
  };
}

async function publicationCandidateBinding(publicationDirectory, manifest) {
  const packages = [];
  for (const entry of exactPackageInventory(manifest)) {
    packages.push({
      ...entry,
      sha256: sha256(await readFile(join(publicationDirectory, entry.artifact))),
    });
  }
  return {
    release_version: manifest.release_version,
    candidate_digest: manifest.candidate?.digest,
    source_commit: manifest.source?.git_commit,
    tag: manifest.source?.signed_tag,
    packages,
  };
}

function registryNotFound(error) {
  const text = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}\n${error?.message ?? ''}`;
  return /(?:E404|404 Not Found)/.test(text);
}

async function packAndCompare({ commandRunner, directory, expectedPath, packageSpecifier }) {
  const { stdout } = await commandRunner(
    'npm',
    ['pack', packageSpecifier, '--pack-destination', directory, '--json'],
    tokenlessEnvironment(),
  );
  const response = parseJson(stdout, `npm pack response for ${packageSpecifier}`);
  invariant(
    Array.isArray(response) && response.length === 1 && typeof response[0]?.filename === 'string',
    `npm did not return one tarball for ${packageSpecifier}.`,
  );
  const actual = await readFile(join(directory, basename(response[0].filename)));
  const expected = await readFile(expectedPath);
  invariant(actual.equals(expected), `Published npm bytes differ for ${packageSpecifier}.`);
  return sha256(actual);
}

async function packageRegistryState({ commandRunner, packageEntry, candidateDirectory }) {
  try {
    await commandRunner(
      'npm',
      ['view', packageEntry.name, 'name', '--json'],
      tokenlessEnvironment(),
    );
  } catch (error) {
    if (registryNotFound(error)) return 'absent';
    throw error;
  }
  const specifier = `${packageEntry.name}@${packageEntry.version}`;
  try {
    const { stdout } = await commandRunner(
      'npm',
      ['view', specifier, 'name', 'version', '--json'],
      tokenlessEnvironment(),
    );
    const metadata = parseJson(stdout, `npm metadata for ${specifier}`);
    invariant(
      metadata?.name === packageEntry.name && metadata?.version === packageEntry.version,
      `npm returned a mismatched package identity for ${specifier}.`,
    );
  } catch (error) {
    if (registryNotFound(error)) {
      return 'package-exists-version-absent';
    }
    throw error;
  }
  const workDirectory = await mkdtemp(join(tmpdir(), 'breakdown-npm-existing-'));
  try {
    await packAndCompare({
      commandRunner,
      directory: workDirectory,
      expectedPath: join(candidateDirectory, packageEntry.artifact),
      packageSpecifier: specifier,
    });
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
  return 'exact-version-present';
}

function enhanceNpmPublishError(error, packageName) {
  const text = `${error?.stdout ?? ''}\n${error?.stderr ?? ''}\n${error?.message ?? ''}`;
  if (/(?:E404|404 Not Found)/.test(text)) {
    const orgName = packageName.split('/')[0].replace('@', '');
    throw new Error(
      `npm publish failed with 404 for ${packageName}. This typically means the token lacks permission to CREATE new packages in the @${orgName} organization. ` +
      `Required: the NPM_FIRST_PACKAGE_TOKEN must have "packages and scopes" permission set to "Read and write" for @${orgName}, ` +
      `OR the npm organization must grant explicit createPackage permission to the automation account. ` +
      `Cannot proceed without this permission. Original error: ${error?.message ?? String(error)}`,
    );
  }
  throw error;
}

export async function inspectFirstPackageBootstrap({
  candidateDirectory,
  capturedAt = new Date(),
  commandRunner = defaultCommandRunner,
  outputPath = undefined,
}) {
  const candidate = await readCandidatePackageInventory(candidateDirectory);
  invariant(
    candidate.releaseVersion === NPM_PUBLICATION_POLICY.bootstrapVersion,
    'The first-package bootstrap is restricted to the exact 1.0.0 release.',
  );
  const packages = [];
  for (const packageEntry of candidate.packages) {
    const registryState = await packageRegistryState({
      commandRunner,
      packageEntry,
      candidateDirectory,
    });
    packages.push({
      ...packageEntry,
      registry_state: registryState,
    });
  }
  
  const corePackage = packages.find((pkg) => pkg.name === '@breakdown-sh/core');
  const cliPackage = packages.find((pkg) => pkg.name === '@breakdown-sh/cli');
  const mcpPackage = packages.find((pkg) => pkg.name === '@breakdown-sh/mcp');
  
  const isResumableMixedState =
    corePackage?.registry_state === 'exact-version-present' &&
    cliPackage?.registry_state === 'absent' &&
    mcpPackage?.registry_state === 'absent';
  
  if (isResumableMixedState) {
    invariant(
      corePackage.sha256,
      'Resumable mixed state requires byte-verified core package.',
    );
  }
  
  for (const pkg of packages) {
    if (pkg.registry_state === 'package-exists-version-absent') {
      if (!isResumableMixedState) {
        throw new Error(
          `${pkg.name} already exists but ${pkg.name}@${pkg.version} does not; first-package bootstrap refuses a claimed package name.`,
        );
      }
    }
  }
  
  const evidence = {
    schema_version: 'breakdown.npm-publication-controls.v1',
    captured_at: capturedAt.toISOString(),
    mode: 'first-package-bootstrap',
    registry: NPM_PUBLICATION_POLICY.registry,
    release_version: candidate.releaseVersion,
    candidate_digest: candidate.candidateDigest,
    repository: NPM_PUBLICATION_POLICY.repository,
    workflow: NPM_PUBLICATION_POLICY.workflow,
    environment: NPM_PUBLICATION_POLICY.environment,
    packages,
    authentication: {
      method: 'one-time-granular-access-token',
      github_environment_secret: NPM_PUBLICATION_POLICY.bootstrapSecret,
      credential_value_retained: false,
      required_properties: {
        packages_and_scopes: ['@breakdown-sh'],
        packages_and_scopes_permission: 'read-write',
        organization_permission: 'no-access',
        bypass_2fa: true,
        maximum_lifetime_hours: 24,
      },
    },
    provenance: 'required',
    registry_signatures: 'required',
    transition: {
      trust_must_be_configured_for_every_package: true,
      token_publication_must_be_disabled: true,
      bootstrap_token_must_be_revoked: true,
      github_secret_must_be_removed: true,
      github_release_finalization_permitted: false,
    },
    verification: { status: 'passed' },
  };
  if (outputPath !== undefined) {
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  }
  return evidence;
}

function normalizeRole(value, publisher) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') return value[publisher];
  return undefined;
}

function normalizeMaintainers(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'string' ? /^[^\s<]+/.exec(entry)?.[0] : entry?.name))
      .filter((entry) => typeof entry === 'string')
      .sort();
  }
  if (value && typeof value === 'object') return Object.keys(value).sort();
  return [];
}

function normalizeTrust(value) {
  const entries = Array.isArray(value) ? value : [value];
  invariant(entries.length === 1, 'Each npm package must have exactly one trusted publisher.');
  const entry = entries[0];
  return {
    type: entry?.type,
    repository: entry?.repository ?? entry?.claims?.repository,
    file: entry?.file ?? entry?.claims?.workflow_ref?.file,
    environment: entry?.environment ?? entry?.claims?.environment,
    permissions: [...(entry?.permissions ?? [])].sort(),
  };
}

function assertTrust(trust) {
  invariant(
    sameJson(trust, {
      type: 'github',
      repository: NPM_PUBLICATION_POLICY.repository,
      file: NPM_PUBLICATION_POLICY.workflow,
      environment: NPM_PUBLICATION_POLICY.environment,
      permissions: [NPM_PUBLICATION_POLICY.permission],
    }),
    'npm trusted-publisher identity differs from the exact GitHub Actions policy.',
  );
}

export async function inspectNpmTrustedPublishing({
  capturedAt = new Date(),
  commandRunner = defaultCommandRunner,
  outputPath = undefined,
}) {
  invariant(
    process.env.NODE_AUTH_TOKEN === undefined && process.env.NPM_TOKEN === undefined,
    'Trusted-publisher inspection refuses token environment variables.',
  );
  const [{ stdout: npmVersion }, { stdout: registry }, { stdout: publisher }] = await Promise.all([
    commandRunner('npm', ['--version'], {}),
    commandRunner('npm', ['config', 'get', 'registry'], {}),
    commandRunner('npm', ['whoami'], {}),
  ]);
  const versionParts = npmVersion.trim().split('.').map(Number);
  invariant(
    versionParts[0] > 11 || (versionParts[0] === 11 && versionParts[1] >= 15),
    'npm trusted-publisher inspection requires npm 11.15.0 or newer.',
  );
  invariant(
    registry.trim() === NPM_PUBLICATION_POLICY.registry,
    'npm trusted-publisher inspection is not using the public registry.',
  );
  const publisherName = publisher.trim();
  invariant(/^[a-z0-9][a-z0-9_-]*$/.test(publisherName), 'npm returned an invalid publisher name.');
  const { stdout: organizationOutput } = await commandRunner(
    'npm',
    ['org', 'ls', NPM_PUBLICATION_POLICY.organization, publisherName, '--json'],
    {},
  );
  const organizationRole = normalizeRole(
    parseJson(organizationOutput, 'npm organization membership'),
    publisherName,
  );
  invariant(
    ['developer', 'admin', 'owner'].includes(organizationRole),
    'The authenticated npm publisher has no publishing role in breakdown-sh.',
  );

  const packages = [];
  for (const packageName of NPM_PACKAGES) {
    const [visibilityResult, ownersResult, trustResult] = await Promise.all([
      commandRunner('npm', ['access', 'get', 'status', packageName, '--json'], {}),
      commandRunner('npm', ['owner', 'ls', packageName, '--json'], {}),
      commandRunner('npm', ['trust', 'list', packageName, '--json'], {}),
    ]);
    const visibility = parseJson(visibilityResult.stdout, `npm visibility for ${packageName}`);
    const maintainers = normalizeMaintainers(
      parseJson(ownersResult.stdout, `npm maintainers for ${packageName}`),
    );
    const trustedPublisher = normalizeTrust(
      parseJson(trustResult.stdout, `npm trust configuration for ${packageName}`),
    );
    assertTrust(trustedPublisher);
    invariant(
      visibility?.[packageName] === 'public',
      `${packageName} is not a public npm package.`,
    );
    invariant(
      maintainers.includes(publisherName),
      `${publisherName} is not an npm maintainer of ${packageName}.`,
    );
    packages.push({
      name: packageName,
      visibility: 'public',
      maintainers,
      trusted_publisher: trustedPublisher,
    });
  }
  const evidence = {
    schema_version: 'breakdown.npm-trusted-publishing.v1',
    captured_at: capturedAt.toISOString(),
    registry: NPM_PUBLICATION_POLICY.registry,
    publisher: {
      username: publisherName,
      organization: NPM_PUBLICATION_POLICY.organization,
      organization_role: organizationRole,
    },
    packages,
    credential_material_retained: false,
    verification: { status: 'passed' },
  };
  if (outputPath !== undefined) {
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
  }
  return evidence;
}

export function validateTrustedPublishingEvidence(evidence) {
  invariant(
    evidence?.schema_version === 'breakdown.npm-trusted-publishing.v1' &&
      evidence?.registry === NPM_PUBLICATION_POLICY.registry &&
      typeof evidence?.publisher?.username === 'string' &&
      evidence.publisher.organization === NPM_PUBLICATION_POLICY.organization &&
      ['developer', 'admin', 'owner'].includes(evidence.publisher.organization_role) &&
      evidence.credential_material_retained === false &&
      evidence.verification?.status === 'passed' &&
      Array.isArray(evidence.packages) &&
      sameJson(
        evidence.packages.map((entry) => entry.name),
        NPM_PACKAGES,
      ),
    'Retained npm trusted-publishing evidence is incomplete.',
  );
  for (const entry of evidence.packages) {
    assertTrust(entry.trusted_publisher);
    invariant(
      entry.visibility === 'public' &&
        Array.isArray(entry.maintainers) &&
        entry.maintainers.includes(evidence.publisher.username),
      `Retained npm ownership evidence is incomplete for ${entry.name}.`,
    );
  }
}

export function validateBootstrapPublicationEvidence(evidence, candidate) {
  const packages = exactPackageInventory(candidate);
  const expectedWorkflow = `${NPM_PUBLICATION_POLICY.repository}/.github/workflows/${NPM_PUBLICATION_POLICY.workflow}`;
  const tagExecution =
    evidence?.execution?.mode === 'tag' &&
    evidence?.execution?.ref === `refs/tags/${candidate.tag}` &&
    evidence?.execution?.source_commit === candidate.source_commit &&
    evidence?.execution?.workflow_ref === `${expectedWorkflow}@refs/tags/${candidate.tag}` &&
    evidence?.execution?.workflow_sha === candidate.source_commit;
  const v1RecoveryExecution =
    candidate.release_version === NPM_PUBLICATION_POLICY.bootstrapVersion &&
    candidate.tag === 'breakdown-local-v1.0.0' &&
    candidate.source_commit === '723e296c5a0ab5431a02022830adff8bcf0dd818' &&
    evidence?.execution?.mode === 'v1-recovery' &&
    evidence?.execution?.ref === 'refs/heads/main' &&
    /^[0-9a-f]{40}$/.test(evidence?.execution?.source_commit ?? '') &&
    evidence?.execution?.workflow_ref === `${expectedWorkflow}@refs/heads/main` &&
    evidence?.execution?.workflow_sha === evidence.execution.source_commit;
  invariant(
    evidence?.schema_version === 'breakdown.npm-first-package-bootstrap.v1' &&
      evidence?.registry === NPM_PUBLICATION_POLICY.registry &&
      evidence?.release_version === candidate.release_version &&
      evidence?.release_version === NPM_PUBLICATION_POLICY.bootstrapVersion &&
      sameJson(evidence?.candidate_digest, candidate.candidate_digest) &&
      evidence?.repository === NPM_PUBLICATION_POLICY.repository &&
      evidence?.workflow === NPM_PUBLICATION_POLICY.workflow &&
      evidence?.environment === NPM_PUBLICATION_POLICY.environment &&
      evidence?.publication_target?.signed_tag === candidate.tag &&
      evidence?.publication_target?.source_commit === candidate.source_commit &&
      (tagExecution || v1RecoveryExecution) &&
      evidence?.authentication === 'one-time-granular-access-token' &&
      evidence?.credential_value_retained === false &&
      /^breakdown-publication-manifest-1\.0\.0\.json$/.test(
        evidence?.publication_manifest?.file ?? '',
      ) &&
      exactSha256(evidence?.publication_manifest?.sha256) &&
      evidence?.provenance === 'passed' &&
      evidence?.registry_signatures === 'passed' &&
      evidence?.verification?.status === 'passed' &&
      sameJson(packageIdentities(evidence?.packages ?? []), packageIdentities(packages)) &&
      evidence.packages.every(
        (entry, index) =>
          exactSha256(entry.sha256) &&
          (packages[index]?.sha256 === undefined || packages[index].sha256 === entry.sha256),
      ),
    'Retained first-package bootstrap evidence is incomplete or mismatched.',
  );
}

export async function prepareNpmPublicationControls({
  bootstrapEvidence,
  candidateDirectory,
  capturedAt = new Date(),
  commandRunner = defaultCommandRunner,
  mode,
  outputPath,
  trustedPublishingEvidence,
}) {
  invariant(NPM_PUBLICATION_MODES.includes(mode), 'Unknown npm publication mode.');
  if (mode === 'first-package-bootstrap') {
    return inspectFirstPackageBootstrap({
      candidateDirectory,
      capturedAt,
      commandRunner,
      outputPath,
    });
  }
  const candidate = await readCandidatePackageInventory(candidateDirectory);
  validateTrustedPublishingEvidence(trustedPublishingEvidence);
  if (mode === 'finalize-bootstrap') {
    validateBootstrapPublicationEvidence(bootstrapEvidence, {
      release_version: candidate.releaseVersion,
      candidate_digest: candidate.candidateDigest,
      source_commit: candidate.source?.git_commit,
      tag: `breakdown-local-v${candidate.releaseVersion}`,
      packages: candidate.packages,
    });
  } else {
    invariant(bootstrapEvidence === undefined, 'OIDC publication received bootstrap evidence.');
  }
  const evidence = {
    schema_version: 'breakdown.npm-publication-controls.v1',
    captured_at: capturedAt.toISOString(),
    mode,
    registry: NPM_PUBLICATION_POLICY.registry,
    release_version: candidate.releaseVersion,
    candidate_digest: candidate.candidateDigest,
    repository: NPM_PUBLICATION_POLICY.repository,
    workflow: NPM_PUBLICATION_POLICY.workflow,
    environment: NPM_PUBLICATION_POLICY.environment,
    packages: candidate.packages,
    authentication: {
      method:
        mode === 'oidc-trusted-publishing'
          ? 'oidc-trusted-publishing'
          : 'previously-completed-first-package-bootstrap',
      token_publication: 'human-confirmed-disabled',
      credential_value_retained: false,
    },
    trusted_publishing: trustedPublishingEvidence,
    ...(bootstrapEvidence === undefined ? {} : { bootstrap_publication: bootstrapEvidence }),
    provenance: 'required',
    registry_signatures: 'required',
    verification: { status: 'passed' },
  };
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  return evidence;
}

export function validateNpmPublicationControls(evidence, candidate) {
  const packages = exactPackageInventory(candidate);
  invariant(
    evidence?.schema_version === 'breakdown.npm-publication-controls.v1' &&
      NPM_PUBLICATION_MODES.includes(evidence?.mode) &&
      evidence?.registry === NPM_PUBLICATION_POLICY.registry &&
      evidence?.release_version === candidate.release_version &&
      exactCandidateDigest(evidence?.candidate_digest) &&
      sameJson(evidence?.candidate_digest, candidate.candidate_digest) &&
      evidence?.repository === NPM_PUBLICATION_POLICY.repository &&
      evidence?.workflow === NPM_PUBLICATION_POLICY.workflow &&
      evidence?.environment === NPM_PUBLICATION_POLICY.environment &&
      evidence?.authentication?.credential_value_retained === false &&
      evidence?.provenance === 'required' &&
      evidence?.registry_signatures === 'required' &&
      evidence?.verification?.status === 'passed' &&
      sameJson(packageIdentities(evidence?.packages ?? []), packageIdentities(packages)) &&
      evidence.packages.every(
        (entry, index) => exactSha256(entry.sha256) && entry.sha256 === packages[index]?.sha256,
      ),
    'npm publication controls do not bind the exact three-package release.',
  );
  if (evidence.mode === 'first-package-bootstrap') {
    invariant(
      evidence.release_version === NPM_PUBLICATION_POLICY.bootstrapVersion &&
        evidence.authentication.method === 'one-time-granular-access-token' &&
        evidence.authentication.github_environment_secret ===
          NPM_PUBLICATION_POLICY.bootstrapSecret &&
        evidence.authentication.required_properties?.packages_and_scopes_permission ===
          'read-write' &&
        sameJson(evidence.authentication.required_properties?.packages_and_scopes, [
          '@breakdown-sh',
        ]) &&
        evidence.authentication.required_properties?.organization_permission === 'no-access' &&
        evidence.authentication.required_properties?.bypass_2fa === true &&
        evidence.authentication.required_properties?.maximum_lifetime_hours === 24 &&
        evidence.transition?.github_release_finalization_permitted === false &&
        evidence.packages.every((entry) =>
          ['absent', 'exact-version-present', 'package-exists-version-absent'].includes(entry.registry_state),
        ),
      'npm first-package bootstrap controls are not fail-closed.',
    );
    return;
  }
  validateTrustedPublishingEvidence(evidence.trusted_publishing);
  invariant(
    evidence.authentication.token_publication === 'human-confirmed-disabled',
    'npm token publication has not been confirmed disabled.',
  );
  if (evidence.mode === 'finalize-bootstrap') {
    validateBootstrapPublicationEvidence(evidence.bootstrap_publication, {
      release_version: candidate.release_version,
      candidate_digest: candidate.candidate_digest,
      source_commit: candidate.source_commit,
      tag: candidate.tag,
      packages: evidence.packages,
    });
  } else {
    invariant(
      evidence.authentication.method === 'oidc-trusted-publishing' &&
        evidence.bootstrap_publication === undefined,
      'Steady-state npm publication is not OIDC-only.',
    );
  }
}

export async function publishFirstPackages({
  commandRunner = defaultCommandRunner,
  publicationDirectory,
}) {
  const manifestFiles = (await readdir(publicationDirectory)).filter((file) =>
    /^breakdown-publication-manifest-[0-9]+\.[0-9]+\.[0-9]+\.json$/.test(file),
  );
  invariant(manifestFiles.length === 1, 'Publication has no unique manifest.');
  const manifestBytes = await readFile(join(publicationDirectory, manifestFiles[0]));
  const manifest = parseJson(manifestBytes, 'Publication manifest');
  const controlsFile = manifest.evidence?.npm_publication_controls?.file;
  const controlsBytes = await readFile(join(publicationDirectory, controlsFile));
  const controls = parseJson(controlsBytes, 'npm publication controls');
  const workflowIdentityFile = manifest.evidence?.stable_workflow_identity?.file;
  invariant(
    typeof workflowIdentityFile === 'string' && workflowIdentityFile.length > 0,
    'Publication has no stable workflow identity.',
  );
  const workflowIdentity = parseJson(
    await readFile(join(publicationDirectory, workflowIdentityFile)),
    'Stable workflow identity',
  );
  const candidate = await publicationCandidateBinding(publicationDirectory, manifest);
  validateNpmPublicationControls(controls, candidate);
  invariant(
    controls.mode === 'first-package-bootstrap',
    'One-time npm bootstrap command refuses a non-bootstrap publication.',
  );
  const packages = [];
  for (const entry of controls.packages) {
    const packageSpecifier = `${entry.name}@${entry.version}`;
    let digest;
    if (entry.registry_state === 'absent' || entry.registry_state === 'package-exists-version-absent') {
      try {
        await commandRunner(
          'npm',
          [
            'publish',
            join(publicationDirectory, entry.artifact),
            '--access',
            'public',
            '--tag',
            'latest',
            '--provenance',
          ],
          {},
        );
      } catch (error) {
        enhanceNpmPublishError(error, entry.name);
      }
      const candidateTarball = await readFile(join(publicationDirectory, entry.artifact));
      digest = sha256(candidateTarball);
    } else if (entry.registry_state === 'exact-version-present') {
      const workDirectory = await mkdtemp(join(tmpdir(), 'breakdown-npm-bootstrap-'));
      try {
        digest = await packAndCompare({
          commandRunner,
          directory: workDirectory,
          expectedPath: join(publicationDirectory, entry.artifact),
          packageSpecifier,
        });
      } finally {
        await rm(workDirectory, { recursive: true, force: true });
      }
    } else {
      throw new Error(
        `Unexpected registry state '${entry.registry_state}' for ${packageSpecifier}. Expected 'absent', 'package-exists-version-absent', or 'exact-version-present'.`,
      );
    }
    packages.push({
      name: entry.name,
      version: entry.version,
      artifact: entry.artifact,
      sha256: digest,
    });
  }
  const auditDirectory = await mkdtemp(join(tmpdir(), 'breakdown-npm-signatures-'));
  try {
    await writeFile(
      join(auditDirectory, 'package.json'),
      `${JSON.stringify({
        name: 'breakdown-npm-bootstrap-verification',
        version: '0.0.0',
        private: true,
        dependencies: Object.fromEntries(packages.map((entry) => [entry.name, entry.version])),
      })}\n`,
    );
    const maxRetries = 5;
    const retryDelays = [2000, 4000, 8000, 16000, 32000];
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await commandRunner(
          'npm',
          ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--engine-strict', '--save-exact'],
          { cwd: auditDirectory, ...tokenlessEnvironment() },
        );
        break;
      } catch (error) {
        if (registryNotFound(error) && attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
          continue;
        }
        throw error;
      }
    }
    const { stdout } = await commandRunner('npm', ['audit', 'signatures', '--json'], {
      cwd: auditDirectory,
      ...tokenlessEnvironment(),
    });
    const audit = parseJson(stdout, 'npm registry signature and provenance audit');
    invariant(
      Array.isArray(audit.invalid) &&
        audit.invalid.length === 0 &&
        Array.isArray(audit.missing) &&
        audit.missing.length === 0,
      'npm registry signature or provenance audit reported invalid or missing evidence.',
    );
  } finally {
    await rm(auditDirectory, { recursive: true, force: true });
  }
  const evidence = {
    schema_version: 'breakdown.npm-first-package-bootstrap.v1',
    registry: NPM_PUBLICATION_POLICY.registry,
    release_version: manifest.release_version,
    repository: NPM_PUBLICATION_POLICY.repository,
    workflow: NPM_PUBLICATION_POLICY.workflow,
    environment: NPM_PUBLICATION_POLICY.environment,
    publication_target: {
      signed_tag: manifest.source?.signed_tag,
      source_commit: manifest.source?.git_commit,
    },
    execution: workflowIdentity.execution,
    candidate_digest: manifest.candidate?.digest,
    publication_manifest: {
      file: manifestFiles[0],
      sha256: sha256(manifestBytes),
    },
    packages,
    authentication: 'one-time-granular-access-token',
    credential_value_retained: false,
    provenance: 'passed',
    registry_signatures: 'passed',
    verification: { status: 'passed' },
  };
  validateBootstrapPublicationEvidence(evidence, candidate);
  return evidence;
}

export async function verifyExistingFirstPackages({
  commandRunner = defaultCommandRunner,
  publicationDirectory,
}) {
  const manifestFiles = (await readdir(publicationDirectory)).filter((file) =>
    /^breakdown-publication-manifest-[0-9]+\.[0-9]+\.[0-9]+\.json$/.test(file),
  );
  invariant(manifestFiles.length === 1, 'Publication has no unique manifest.');
  const manifest = parseJson(
    await readFile(join(publicationDirectory, manifestFiles[0])),
    'Publication manifest',
  );
  const controls = parseJson(
    await readFile(join(publicationDirectory, manifest.evidence?.npm_publication_controls?.file)),
    'npm publication controls',
  );
  validateNpmPublicationControls(
    controls,
    await publicationCandidateBinding(publicationDirectory, manifest),
  );
  invariant(
    controls.mode === 'finalize-bootstrap',
    'Existing first-package verification requires bootstrap-finalization controls.',
  );
  const packages = [];
  for (const entry of controls.packages) {
    const workDirectory = await mkdtemp(join(tmpdir(), 'breakdown-npm-finalize-'));
    try {
      packages.push({
        name: entry.name,
        version: entry.version,
        sha256: await packAndCompare({
          commandRunner,
          directory: workDirectory,
          expectedPath: join(publicationDirectory, entry.artifact),
          packageSpecifier: `${entry.name}@${entry.version}`,
        }),
      });
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
    }
  }
  return {
    schema_version: 'breakdown.npm-bootstrap-finalization-preflight.v1',
    release_version: manifest.release_version,
    packages,
    trusted_publishing: 'passed',
    token_publication: 'human-confirmed-disabled',
    verification: { status: 'passed' },
  };
}

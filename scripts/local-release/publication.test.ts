import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  HUMAN_RELEASE_ATTESTATIONS,
  inspectLocalPublication,
  prepareLocalPublication,
  readCandidate,
  verifyPublishedLocalRelease,
  writeHumanReleaseApprovalTemplate,
} from './publication.mjs';
import { indexDeferredHostSupport, writeHostSupportMaterial } from './host-evidence.mjs';
import {
  RELEASE_CEREMONY_POLICY,
  authorizationConfirmation,
  createGithubReleaseAuthorization,
  createReleaseCeremonyPlan,
  releaseAttestations,
  releaseTagMessage,
} from './release-ceremony.mjs';

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);
const repositoryRoot = join(import.meta.dirname, '../..');
const releaseVersion = '1.0.0';
const gitCommit = 'c'.repeat(40);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function sha512(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('hex');
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function publicationFixture() {
  const root = await mkdtemp(join(tmpdir(), 'breakdown-publication-'));
  temporaryDirectories.push(root);
  const candidateDirectory = join(root, 'candidate');
  const supportDirectory = join(root, 'support');
  const outputDirectory = join(root, 'publication');
  await Promise.all([mkdir(candidateDirectory), mkdir(supportDirectory), mkdir(outputDirectory)]);

  const primaryArtifacts = [
    ['breakdown-contracts-1.0.0.tar.gz', 'contracts-archive'],
    ['breakdown-contracts-1.0.0.zip', 'contracts-archive'],
    ['breakdown-sh-cli-1.0.0.tgz', 'command-line-interface'],
    ['breakdown-sh-core-1.0.0.tgz', 'core-library'],
    ['breakdown-sh-mcp-1.0.0.tgz', 'mcp-adapter'],
    ['breakdown-skills-1.0.0.tar.gz', 'skills-archive'],
    ['breakdown-skills-1.0.0.zip', 'skills-archive'],
  ] as const;
  const primaryBytes = new Map<string, Buffer>(
    primaryArtifacts.map(([file]) => [file, Buffer.from(`exact candidate bytes: ${file}\n`)]),
  );
  for (const [file, bytes] of primaryBytes) {
    await writeFile(join(candidateDirectory, file), bytes);
  }
  const subjects = [...primaryBytes]
    .map(([name, bytes]) => ({ name, digest: { sha256: sha256(bytes) } }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const candidateDigest = sha256(
    Buffer.from(
      `${subjects
        .map((subject) => `${subject.digest.sha256}  ${subject.name}`)
        .sort()
        .join('\n')}\n`,
    ),
  );
  const provenanceFile = 'breakdown-provenance-inputs-1.0.0.json';
  await writeJson(join(candidateDirectory, provenanceFile), {
    schema_version: 'breakdown.provenance-inputs.v1',
    release_version: releaseVersion,
    source: {
      repository: 'https://github.com/alamorre/breakdown.sh',
      git_commit: gitCommit,
      clean: true,
      clean_scope: 'entire-git-worktree',
    },
    subjects,
  });
  const sbomFile = 'breakdown-sbom-1.0.0.cdx.json';
  await writeJson(join(candidateDirectory, sbomFile), {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
  });

  const artifactDefinitions = [
    ...primaryArtifacts,
    [provenanceFile, 'provenance-inputs'],
    [sbomFile, 'software-bill-of-materials'],
  ] as const;
  const artifacts = [];
  for (const [file, role] of artifactDefinitions) {
    const bytes = await readFile(join(candidateDirectory, file));
    artifacts.push({
      file,
      role,
      bytes: bytes.byteLength,
      hashes: { sha256: sha256(bytes) },
    });
  }
  const releaseManifestFile = 'breakdown-release-1.0.0.json';
  await writeJson(join(candidateDirectory, releaseManifestFile), {
    schema_version: 'breakdown.release-manifest.v1',
    release_version: releaseVersion,
    channel: {
      stability: 'stable',
      npm_dist_tag: 'latest',
      github_prerelease: false,
      immutable_tag: 'breakdown-local-v1.0.0',
    },
    artifacts,
    packages: [
      {
        name: '@breakdown-sh/core',
        version: releaseVersion,
        artifact: 'breakdown-sh-core-1.0.0.tgz',
      },
      {
        name: '@breakdown-sh/cli',
        version: releaseVersion,
        artifact: 'breakdown-sh-cli-1.0.0.tgz',
      },
      {
        name: '@breakdown-sh/mcp',
        version: releaseVersion,
        artifact: 'breakdown-sh-mcp-1.0.0.tgz',
      },
    ],
    platform_conformance: {
      maintained_tuples: [
        { os: 'linux-glibc', architecture: 'x64' },
        { os: 'linux-glibc', architecture: 'arm64' },
        { os: 'macos', architecture: 'x64' },
        { os: 'macos', architecture: 'arm64' },
      ],
      current_build: {
        corpus_revision: {
          file: 'local/contracts/MANIFEST.json',
          sha256: 'b'.repeat(64),
        },
        candidate_digest: {
          algorithm: 'SHA-256',
          content: candidateDigest,
        },
      },
    },
    license_scope: {
      license: 'Apache-2.0',
      included: ['Breakdown Local release corpus'],
      excluded: [
        'hosted application root and hosted assets',
        'Breakdown branding rights',
        'user-authored content',
        'third-party material',
      ],
    },
  });
  const checksumFiles = [...artifactDefinitions.map(([file]) => file), releaseManifestFile].sort();
  const checksumLines = [];
  for (const file of checksumFiles) {
    checksumLines.push(`${sha256(await readFile(join(candidateDirectory, file)))}  ${file}`);
  }
  const checksumBytes = Buffer.from(`${checksumLines.join('\n')}\n`);
  await writeFile(join(candidateDirectory, 'SHA256SUMS'), checksumBytes);

  const platformIndexPath = join(root, 'breakdown-platform-evidence-index.json');
  const platformRows = [
    { os: 'linux-glibc', architecture: 'x64' },
    { os: 'linux-glibc', architecture: 'arm64' },
    { os: 'macos', architecture: 'x64' },
    { os: 'macos', architecture: 'arm64' },
  ].map((tuple, index) => ({
    tuple,
    status: 'passed',
    evidence: {
      artifact_name: `breakdown-platform-evidence-${index}`,
      mechanism: 'github-actions-artifact-v7',
      workflow_run_id: '12345',
      workflow_run_attempt: '1',
      file_sha256: String(index + 1)
        .repeat(64)
        .slice(0, 64),
    },
  }));
  await writeJson(platformIndexPath, {
    schema_version: 'breakdown.platform-qualification-index.v1',
    release_version: releaseVersion,
    status: 'passed',
    candidate_digest: { algorithm: 'SHA-256', content: candidateDigest },
    corpus_revision: {
      file: 'local/contracts/MANIFEST.json',
      sha256: 'b'.repeat(64),
    },
    source: {
      repository: 'https://github.com/alamorre/breakdown.sh',
      git_commit: gitCommit,
    },
    rows: platformRows,
    gate: { satisfied: true },
  });

  const candidateArtifacts = {
    digest: { algorithm: 'SHA-256', content: candidateDigest },
    provenance_inputs: {
      file: provenanceFile,
      sha256: sha256(await readFile(join(candidateDirectory, provenanceFile))),
    },
    skill_archive: {
      file: 'breakdown-skills-1.0.0.tar.gz',
      sha256: sha256(primaryBytes.get('breakdown-skills-1.0.0.tar.gz')!),
    },
    packages: (
      [
        'breakdown-sh-core-1.0.0.tgz',
        'breakdown-sh-cli-1.0.0.tgz',
        'breakdown-sh-mcp-1.0.0.tgz',
      ] as const
    ).map((file) => {
      return { file, sha256: sha256(primaryBytes.get(file)!) };
    }),
  };
  const hostRows = [
    { family: 'linux', platform: 'linux', model: 'claude', provider: 'anthropic' },
    { family: 'macos', platform: 'darwin', model: 'gpt', provider: 'openai' },
  ].map(({ family, platform, model, provider }, index) => ({
    host: { surface: `Agent Host ${index + 1}`, version: '1.2.3' },
    operating_system: {
      family,
      platform,
      name: `${family} operating system`,
      release: 'release',
      version: 'version',
      architecture: 'x64',
    },
    transport: 'cli',
    breakdown_version: releaseVersion,
    model: { model_family: model, provider_family: provider },
    candidate: candidateArtifacts,
    status: 'passed',
    evidence: {
      artifact_name: `breakdown-host-evidence-${index + 1}`,
      mechanism: 'github-actions-artifact-v7',
      workflow_run_id: '12345',
      workflow_run_attempt: '1',
      file_sha256: String(index + 4)
        .repeat(64)
        .slice(0, 64),
    },
  }));
  const supportedHosts = hostRows.map((row) => ({
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
  const hostIndexPath = join(root, 'breakdown-host-support-index.json');
  await writeJson(hostIndexPath, {
    schema_version: 'breakdown.host-support-index.v1',
    release_version: releaseVersion,
    tag: `breakdown-local-v${releaseVersion}`,
    status: 'passed',
    policy: {
      state: 'qualified',
      certification_issue: 188,
      supported_host_claims: supportedHosts.length,
      evidence_rows: hostRows.length,
    },
    candidate_digest: { algorithm: 'SHA-256', content: candidateDigest },
    corpus_revision: {
      file: 'local/contracts/MANIFEST.json',
      sha256: 'b'.repeat(64),
    },
    source: {
      repository: 'https://github.com/alamorre/breakdown.sh',
      git_commit: gitCommit,
    },
    coverage: {
      guided_cli_operating_systems: ['linux', 'macos'],
      model_families: ['claude', 'gpt'],
      provider_families: ['anthropic', 'openai'],
    },
    rows: hostRows,
    supported_hosts: supportedHosts,
    classifications: {
      supported: 'Only exact passing indexed rows are Supported.',
      compatible: 'Unqualified capable Agent Hosts are Compatible.',
      unsupported: 'Bare models are Unsupported.',
    },
    outcome_parity: {
      assessed: true,
      disclaimed_dimensions: [
        'ui',
        'wording',
        'approval-mechanics',
        'latency',
        'model-prose',
        'quality',
        'cost',
        'provider-privacy',
      ],
    },
    gate: { satisfied: true },
  });
  await writeHostSupportMaterial({ indexPath: hostIndexPath, outputDirectory: supportDirectory });
  await writeJson(join(supportDirectory, 'breakdown-host-support-index.attestation.json'), {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
  });

  const candidate = await readCandidate(candidateDirectory);
  const plan = createReleaseCeremonyPlan({
    candidate,
    candidateArtifact: {
      id: 1234,
      name: 'breakdown-local-candidate',
      expired: false,
      digest: `sha256:${'a'.repeat(64)}`,
      workflow_run: { id: 700, head_sha: gitCommit },
    },
    candidateArtifactId: '1234',
    ceremonyRun: {
      repository: 'alamorre/breakdown.sh',
      ref: 'refs/heads/main',
      sha: gitCommit,
      actor: 'alamorre',
      triggering_actor: 'alamorre',
      id: 900,
      attempt: 1,
    },
    currentMainSha: gitCommit,
    executionMode: 'execute',
    npmPublicationMode: 'oidc-trusted-publishing',
    npmTrustedPublishingArtifactId: '3456',
    plannedAt: new Date('2026-07-29T20:00:00.000Z'),
    platformIndex: JSON.parse(await readFile(platformIndexPath, 'utf8')),
    platformIndexArtifact: {
      id: 5678,
      name: 'breakdown-platform-evidence-index',
      expired: false,
      digest: `sha256:${'b'.repeat(64)}`,
      workflow_run: { id: 700, head_sha: gitCommit },
    },
    platformIndexArtifactId: '5678',
    platformIndexSha256: sha256(await readFile(platformIndexPath)),
    qualificationRun: {
      id: 700,
      workflow_id: RELEASE_CEREMONY_POLICY.qualificationWorkflowId,
      event: 'workflow_dispatch',
      conclusion: 'success',
      run_attempt: 1,
      head_sha: gitCommit,
    },
  });
  const planBytes = Buffer.from(`${JSON.stringify(plan, null, 2)}\n`);
  const planSha256 = sha256(planBytes);
  const authorizationPath = join(root, 'breakdown-github-release-authorization.json');
  await writeJson(
    authorizationPath,
    createGithubReleaseAuthorization({
      approvalHistory: [
        {
          state: 'approved',
          comment: authorizationConfirmation(planSha256),
          environments: [
            {
              id: RELEASE_CEREMONY_POLICY.authorizationEnvironmentId,
              name: RELEASE_CEREMONY_POLICY.authorizationEnvironment,
            },
          ],
          user: { login: 'alamorre', id: 15023107 },
        },
      ],
      authorizedAt: new Date('2026-07-29T20:01:00.000Z'),
      plan,
      planBytes,
      runAttempt: 1,
    }),
  );
  const authorizationAttestationPath = join(
    root,
    'breakdown-github-release-authorization.attestation.json',
  );
  await writeJson(authorizationAttestationPath, {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
  });
  const authorizationVerificationPath = join(
    root,
    'breakdown-github-release-authorization-verification.json',
  );
  await writeJson(authorizationVerificationPath, {
    schema_version: 'breakdown.github-release-authorization-verification.v1',
    repository: 'alamorre/breakdown.sh',
    authorization: { sha256: sha256(await readFile(authorizationPath)) },
    attestation: {
      sha256: sha256(await readFile(authorizationAttestationPath)),
      signer_workflow: 'alamorre/breakdown.sh/.github/workflows/local-release-ceremony.yml',
      source_ref: 'refs/heads/main',
      source_digest: gitCommit,
      github_hosted_runner: true,
    },
    verification: { status: 'passed' },
  });

  const githubControlsPath = join(root, 'breakdown-github-release-controls.json');
  await writeJson(githubControlsPath, {
    schema_version: 'breakdown.github-release-controls.v1',
    captured_at: '2026-07-29T20:02:00.000Z',
    phase: 'publication',
    repository: {
      full_name: 'alamorre/breakdown.sh',
      visibility: 'public',
      html_url: 'https://github.com/alamorre/breakdown.sh',
    },
    permanent_operating_model: {
      sole_maintainer: 'alamorre',
      independent_review: false,
      compensating_controls_are_independent_review: false,
    },
    environment: {
      id: 18989155368,
      name: 'breakdown-local-stable',
      can_admins_bypass: false,
      protection_rules: [{ id: 1, type: 'branch_policy' }],
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    },
    deployment_branch_policies: [{ id: 1, name: 'breakdown-local-v*', type: 'tag' }],
    authorization_environment: {
      id: 20224502339,
      name: 'breakdown-local-authorization',
      can_admins_bypass: false,
      protection_rules: [
        {
          id: 2,
          type: 'required_reviewers',
          prevent_self_review: false,
          reviewers: [{ type: 'User', reviewer: { id: 15023107, login: 'alamorre' } }],
        },
        { id: 3, type: 'branch_policy' },
      ],
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    },
    authorization_deployment_branch_policies: [{ id: 4, name: 'main', type: 'branch' }],
    immutable_releases: { enabled: true, enforced_by_owner: false },
    tag_ruleset: {
      id: 20015652,
      name: 'Protect Breakdown Local stable release tags',
      target: 'tag',
      enforcement: 'active',
      conditions: {
        ref_name: { include: ['refs/tags/breakdown-local-v*'], exclude: [] },
      },
      rules: [{ type: 'update' }, { type: 'deletion' }],
      bypass_actors: [],
      current_user_can_bypass: 'never',
    },
    direct_collaborators: [{ login: 'alamorre', role_name: 'admin' }],
    publication_identity: {
      intended_tag: 'breakdown-local-v1.0.0',
      matching_tags: ['breakdown-local-v1.0.0'],
      matching_releases: [],
    },
    verification: { status: 'passed' },
  });

  const tagEvidencePath = join(root, 'breakdown-signed-tag-evidence.json');
  await writeJson(tagEvidencePath, {
    schema_version: 'breakdown.signed-tag-evidence.v1',
    repository: 'https://github.com/alamorre/breakdown.sh',
    tag: 'breakdown-local-v1.0.0',
    tag_object_sha: 'd'.repeat(40),
    target: { type: 'commit', sha: gitCommit },
    verification: { verified: true, reason: 'sigstore-keyless-valid' },
    message: releaseTagMessage({
      authorizationSha256: sha256(await readFile(authorizationPath)),
      plan,
    }),
    signer: {
      method: 'sigstore-keyless-gitsign',
      gitsign_version: '0.17.1',
      binary_sha256: RELEASE_CEREMONY_POLICY.signer.binarySha256,
      certificate_identity: RELEASE_CEREMONY_POLICY.signer.certificateIdentity,
      certificate_oidc_issuer: RELEASE_CEREMONY_POLICY.signer.oidcIssuer,
      transparency_log: RELEASE_CEREMONY_POLICY.signer.transparencyLog,
      signature_verified: true,
      certificate_claims_verified: true,
      transparency_log_verified: true,
    },
    artifact_ids: {
      candidate: '1234',
      platform_index: '5678',
    },
    protection: {
      ruleset_id: 20015652,
      name: 'Protect Breakdown Local stable release tags',
      target: 'tag',
      enforcement: 'active',
      conditions: {
        ref_name: {
          include: ['refs/tags/breakdown-local-v*'],
          exclude: [],
        },
      },
      rules: [{ type: 'update' }, { type: 'deletion' }],
      bypass_actors: [],
      current_user_can_bypass: 'never',
    },
  });

  const workflowIdentityPath = join(root, 'breakdown-stable-workflow-identity.json');
  await writeJson(workflowIdentityPath, {
    schema_version: 'breakdown.stable-workflow-identity.v1',
    repository: 'alamorre/breakdown.sh',
    ref: 'refs/tags/breakdown-local-v1.0.0',
    ref_name: 'breakdown-local-v1.0.0',
    source_commit: gitCommit,
    actor: 'github-actions[bot]',
    triggering_actor: 'github-actions[bot]',
    environment: 'breakdown-local-stable',
    runner_environment: 'github-hosted',
    oidc: {
      subject: 'repo:alamorre/breakdown.sh:environment:breakdown-local-stable',
      audience: 'npm:registry.npmjs.org',
    },
    artifact_ids: {
      candidate: '1234',
      platform_index: '5678',
      host_support: '9012',
    },
    release_controls: {
      ruleset_id: 20015652,
      snapshot_sha256: sha256(await readFile(githubControlsPath)),
    },
    authorization_verification_sha256: sha256(await readFile(authorizationVerificationPath)),
  });

  const npmControlsPath = join(root, 'breakdown-npm-publication-controls.json');
  const npmPublisher = 'adam-publisher';
  const trustedPublishing = {
    schema_version: 'breakdown.npm-trusted-publishing.v1',
    captured_at: '2026-07-29T20:03:00.000Z',
    registry: 'https://registry.npmjs.org/',
    publisher: {
      username: npmPublisher,
      organization: 'breakdown-sh',
      organization_role: 'owner',
    },
    packages: ['core', 'cli', 'mcp'].map((packageName) => ({
      name: `@breakdown-sh/${packageName}`,
      visibility: 'public',
      maintainers: [npmPublisher],
      trusted_publisher: {
        type: 'github',
        repository: 'alamorre/breakdown.sh',
        file: 'local-stable-publication.yml',
        environment: 'breakdown-local-stable',
        permissions: ['createPackage'],
      },
    })),
    credential_material_retained: false,
    verification: { status: 'passed' },
  };
  await writeJson(npmControlsPath, {
    schema_version: 'breakdown.npm-publication-controls.v1',
    captured_at: '2026-07-29T20:04:00.000Z',
    mode: 'oidc-trusted-publishing',
    registry: 'https://registry.npmjs.org/',
    release_version: releaseVersion,
    candidate_digest: { algorithm: 'SHA-256', content: candidateDigest },
    repository: 'alamorre/breakdown.sh',
    workflow: 'local-stable-publication.yml',
    environment: 'breakdown-local-stable',
    packages: ['core', 'cli', 'mcp'].map((packageName) => {
      const file = `breakdown-sh-${packageName}-${releaseVersion}.tgz`;
      return {
        name: `@breakdown-sh/${packageName}`,
        version: releaseVersion,
        artifact: file,
        sha256: sha256(primaryBytes.get(file)!),
      };
    }),
    authentication: {
      method: 'oidc-trusted-publishing',
      token_publication: 'human-confirmed-disabled',
      credential_value_retained: false,
    },
    trusted_publishing: trustedPublishing,
    provenance: 'required',
    registry_signatures: 'required',
    verification: { status: 'passed' },
  });

  return {
    authorizationPath,
    authorizationAttestationPath,
    authorizationVerificationPath,
    candidateDirectory,
    candidateDigest,
    githubControlsPath,
    hostIndexPath,
    npmControlsPath,
    outputDirectory,
    platformIndexPath,
    primaryBytes,
    supportDirectory,
    supportedHosts,
    tagEvidencePath,
    workflowIdentityPath,
  };
}

function prepareFixture(
  fixture: Awaited<ReturnType<typeof publicationFixture>>,
  bootstrapEvidence?: { attestationPath: string; reportPath: string },
) {
  return prepareLocalPublication({
    authorizationPath: fixture.authorizationPath,
    authorizationAttestationPath: fixture.authorizationAttestationPath,
    authorizationVerificationPath: fixture.authorizationVerificationPath,
    candidateDirectory: fixture.candidateDirectory,
    githubControlsPath: fixture.githubControlsPath,
    hostIndexPath: fixture.hostIndexPath,
    npmBootstrapAttestationPath: bootstrapEvidence?.attestationPath,
    npmBootstrapReportPath: bootstrapEvidence?.reportPath,
    npmControlsPath: fixture.npmControlsPath,
    outputDirectory: fixture.outputDirectory,
    platformIndexPath: fixture.platformIndexPath,
    supportDirectory: fixture.supportDirectory,
    tagEvidencePath: fixture.tagEvidencePath,
    workflowIdentityPath: fixture.workflowIdentityPath,
  });
}

async function refreshAuthorizationEvidence(
  fixture: Awaited<ReturnType<typeof publicationFixture>>,
) {
  const authorization = JSON.parse(await readFile(fixture.authorizationPath, 'utf8'));
  const planBytes = Buffer.from(`${JSON.stringify(authorization.plan.value, null, 2)}\n`);
  authorization.plan.sha256 = sha256(planBytes);
  authorization.github_review.comment = authorizationConfirmation(authorization.plan.sha256);
  await writeJson(fixture.authorizationPath, authorization);
  const verification = JSON.parse(await readFile(fixture.authorizationVerificationPath, 'utf8'));
  verification.authorization.sha256 = sha256(await readFile(fixture.authorizationPath));
  await writeJson(fixture.authorizationVerificationPath, verification);
  const workflowIdentity = JSON.parse(await readFile(fixture.workflowIdentityPath, 'utf8'));
  workflowIdentity.authorization_verification_sha256 = sha256(
    await readFile(fixture.authorizationVerificationPath),
  );
  await writeJson(fixture.workflowIdentityPath, workflowIdentity);
  const tagEvidence = JSON.parse(await readFile(fixture.tagEvidencePath, 'utf8'));
  tagEvidence.message = releaseTagMessage({
    authorizationSha256: sha256(await readFile(fixture.authorizationPath)),
    plan: authorization.plan.value,
  });
  await writeJson(fixture.tagEvidencePath, tagEvidence);
}

async function configureDeferredHostSupport(
  fixture: Awaited<ReturnType<typeof publicationFixture>>,
) {
  await rm(fixture.supportDirectory, { recursive: true, force: true });
  await mkdir(fixture.supportDirectory);
  fixture.hostIndexPath = join(
    fixture.candidateDirectory,
    '..',
    'breakdown-host-support-index.json',
  );
  await indexDeferredHostSupport({
    candidateDirectory: fixture.candidateDirectory,
    outputPath: fixture.hostIndexPath,
    releaseTag: 'breakdown-local-v1.0.0',
  });
  await writeHostSupportMaterial({
    indexPath: fixture.hostIndexPath,
    outputDirectory: fixture.supportDirectory,
  });
  await writeJson(join(fixture.supportDirectory, 'breakdown-host-support-index.attestation.json'), {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('prepareLocalPublication', () => {
  it('should create a candidate-bound human approval template with every gate closed', async () => {
    const fixture = await publicationFixture();
    const outputPath = join(fixture.outputDirectory, 'breakdown-human-release-approval.json');

    await expect(
      writeHumanReleaseApprovalTemplate({
        candidateDirectory: fixture.candidateDirectory,
        outputPath,
      }),
    ).resolves.toMatchObject({
      schema_version: 'breakdown.human-release-approval.v1',
      release_version: releaseVersion,
      candidate_digest: {
        algorithm: 'SHA-256',
        content: fixture.candidateDigest,
      },
      source: {
        repository: 'https://github.com/alamorre/breakdown.sh',
        git_commit: gitCommit,
      },
      tag: 'breakdown-local-v1.0.0',
      npm_publication_mode: 'oidc-trusted-publishing',
      approver: {
        name: '',
        email: '',
        github_login: '',
      },
      approved_at: '',
      host_support_policy: {
        state: 'deferred',
        certification_issue: 188,
        supported_hosts: [],
      },
    });
    const template = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(template.attestations).toEqual(
      Object.fromEntries(HUMAN_RELEASE_ATTESTATIONS.map((name) => [name, false])),
    );
    expect(template.attestations).toHaveProperty('zero_claim_deferred_host_policy_reviewed', false);
    expect(template.attestations).not.toHaveProperty('host_gate_passed');
    expect(template.statement).toContain('supported_hosts: []');
  });

  it('should expose approval-template creation as a strict operator command', async () => {
    const fixture = await publicationFixture();
    const outputPath = join(fixture.outputDirectory, 'breakdown-human-release-approval.json');

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        join(repositoryRoot, 'scripts', 'create-release-approval.mjs'),
        '--candidate',
        fixture.candidateDirectory,
        '--npm-publication-mode',
        'oidc-trusted-publishing',
        '--output',
        outputPath,
      ],
      { cwd: repositoryRoot },
    );

    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toMatchObject({
      schema_version: 'breakdown.human-release-approval.v1',
      release_version: releaseVersion,
      candidate_digest: {
        content: fixture.candidateDigest,
      },
    });
  });

  it('should preserve the exact candidate in the inspected stable publication', async () => {
    const fixture = await publicationFixture();

    await expect(prepareFixture(fixture)).resolves.toMatchObject({
      schema_version: 'breakdown.publication-inspection.v1',
      release_version: releaseVersion,
      status: 'passed',
      candidate_digest: {
        algorithm: 'SHA-256',
        content: fixture.candidateDigest,
      },
      npm_dist_tag: 'latest',
      github_prerelease: false,
      qualified_platforms: 4,
      supported_hosts: fixture.supportedHosts.length,
    });

    for (const [file, bytes] of fixture.primaryBytes) {
      expect(await readFile(join(fixture.outputDirectory, file))).toEqual(bytes);
    }
  });

  it('should retain the authenticated bootstrap report and bundle only in finalization', async () => {
    const fixture = await publicationFixture();
    await configureDeferredHostSupport(fixture);
    const controls = JSON.parse(await readFile(fixture.npmControlsPath, 'utf8'));
    const bootstrapReport = {
      schema_version: 'breakdown.npm-first-package-bootstrap.v1',
      registry: 'https://registry.npmjs.org/',
      release_version: releaseVersion,
      candidate_digest: controls.candidate_digest,
      repository: 'alamorre/breakdown.sh',
      workflow: 'local-stable-publication.yml',
      environment: 'breakdown-local-stable',
      publication_manifest: {
        file: 'breakdown-publication-manifest-1.0.0.json',
        sha256: 'e'.repeat(64),
      },
      packages: controls.packages,
      authentication: 'one-time-granular-access-token',
      credential_value_retained: false,
      provenance: 'passed',
      registry_signatures: 'passed',
      verification: { status: 'passed' },
    };
    controls.mode = 'finalize-bootstrap';
    controls.authentication.method = 'previously-completed-first-package-bootstrap';
    controls.bootstrap_publication = bootstrapReport;
    await writeJson(fixture.npmControlsPath, controls);
    const authorization = JSON.parse(await readFile(fixture.authorizationPath, 'utf8'));
    authorization.plan.value.npm_publication_mode = 'finalize-bootstrap';
    authorization.plan.value.artifact_ids.npm_bootstrap = '7890';
    authorization.plan.value.artifact_ids.npm_trusted_publishing = '3456';
    authorization.plan.value.human_authorization.attestations = [
      ...releaseAttestations('finalize-bootstrap'),
    ];
    authorization.attestations = Object.fromEntries(
      releaseAttestations('finalize-bootstrap').map((attestation: string) => [attestation, true]),
    );
    await writeJson(fixture.authorizationPath, authorization);
    await refreshAuthorizationEvidence(fixture);
    const reportPath = join(fixture.outputDirectory, '..', 'bootstrap-report.json');
    const attestationPath = join(fixture.outputDirectory, '..', 'bootstrap-attestation.json');
    await writeJson(reportPath, bootstrapReport);
    await writeJson(attestationPath, {
      mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    });

    await expect(prepareFixture(fixture, { attestationPath, reportPath })).resolves.toMatchObject({
      public_assets: 28,
    });
    await expect(
      readFile(join(fixture.outputDirectory, 'breakdown-npm-first-package-bootstrap.json'), 'utf8'),
    ).resolves.toBe(await readFile(reportPath, 'utf8'));
    await expect(
      readFile(
        join(fixture.outputDirectory, 'breakdown-npm-first-package-bootstrap.attestation.json'),
        'utf8',
      ),
    ).resolves.toBe(await readFile(attestationPath, 'utf8'));
  });

  it('should derive stable channels and qualified claims only from passing evidence', async () => {
    const fixture = await publicationFixture();
    await prepareFixture(fixture);

    const manifest = JSON.parse(
      await readFile(
        join(fixture.outputDirectory, 'breakdown-publication-manifest-1.0.0.json'),
        'utf8',
      ),
    );
    expect(manifest.channel).toEqual({
      stability: 'stable',
      npm_dist_tag: 'latest',
      github_prerelease: false,
      immutable_tag: 'breakdown-local-v1.0.0',
    });
    expect(manifest.qualified_platforms).toEqual(
      JSON.parse(await readFile(fixture.platformIndexPath, 'utf8')).rows,
    );
    expect(manifest.supported_hosts).toEqual(fixture.supportedHosts);
  });

  it('should reject a qualified support set without an exact release-tag binding', async () => {
    const fixture = await publicationFixture();
    const hostIndex = JSON.parse(await readFile(fixture.hostIndexPath, 'utf8'));
    delete hostIndex.tag;
    await writeJson(fixture.hostIndexPath, hostIndex);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'Host support index is not bound to the canonical release schema and tag.',
    );
  });

  it('should reject an authorization for a different npm publication mode', async () => {
    const fixture = await publicationFixture();
    const authorization = JSON.parse(await readFile(fixture.authorizationPath, 'utf8'));
    authorization.plan.value.npm_publication_mode = 'first-package-bootstrap';
    await writeJson(fixture.authorizationPath, authorization);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'GitHub release authorization is not bound to the exact candidate and publication mode.',
    );
  });

  it('should publish the authenticated deferred policy with zero Supported Host claims', async () => {
    const fixture = await publicationFixture();
    await configureDeferredHostSupport(fixture);

    await expect(prepareFixture(fixture)).resolves.toMatchObject({ supported_hosts: 0 });

    const manifest = JSON.parse(
      await readFile(
        join(fixture.outputDirectory, 'breakdown-publication-manifest-1.0.0.json'),
        'utf8',
      ),
    );
    expect(manifest.host_support_policy).toMatchObject({
      state: 'deferred',
      certification_issue: 188,
      supported_host_claims: 0,
      evidence_rows: 0,
    });
    expect(manifest.supported_hosts).toEqual([]);
    const notes = await readFile(
      join(fixture.outputDirectory, 'breakdown-release-notes-1.0.0.md'),
      'utf8',
    );
    expect(notes).toContain('supported_hosts: []');
    expect(notes).toContain('Supported Host certification is deferred');
    expect(notes).toContain('Compatible, not Supported');
    expect(notes).toContain('Unsupported');
    expect(notes).not.toContain('host gate passed');
  });

  it('should reject a deferred support set not bound to the signed release tag', async () => {
    const fixture = await publicationFixture();
    await configureDeferredHostSupport(fixture);
    const hostIndex = JSON.parse(await readFile(fixture.hostIndexPath, 'utf8'));
    hostIndex.tag = 'breakdown-local-v1.0.1';
    await writeJson(fixture.hostIndexPath, hostIndex);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'Host support index is not bound to the canonical release schema and tag.',
    );
  });

  it('should reject a non-empty claim disguised as deferred support', async () => {
    const fixture = await publicationFixture();
    await configureDeferredHostSupport(fixture);
    const hostIndex = JSON.parse(await readFile(fixture.hostIndexPath, 'utf8'));
    hostIndex.supported_hosts = [{ surface: 'Fabricated Host' }];
    await writeJson(fixture.hostIndexPath, hostIndex);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'Deferred host support must contain zero evidence rows and zero claims.',
    );
  });

  it('should reject a post-assembly false claim even when publication checksums are updated', async () => {
    const fixture = await publicationFixture();
    await configureDeferredHostSupport(fixture);
    await prepareFixture(fixture);
    const manifestFile = 'breakdown-publication-manifest-1.0.0.json';
    const manifestPath = join(fixture.outputDirectory, manifestFile);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.supported_hosts = [{ surface: 'Fabricated Host' }];
    await writeJson(manifestPath, manifest);
    const checksumPath = join(fixture.outputDirectory, 'breakdown-publication-SHA256SUMS-1.0.0');
    const manifestDigest = sha256(await readFile(manifestPath));
    const checksumLines = (await readFile(checksumPath, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) =>
        line.endsWith(`  ${manifestFile}`) ? `${manifestDigest}  ${manifestFile}` : line,
      );
    await writeFile(checksumPath, `${checksumLines.join('\n')}\n`);

    await expect(
      inspectLocalPublication({ publicationDirectory: fixture.outputDirectory }),
    ).rejects.toThrow(
      'Publication host support policy and claims do not match the authenticated index.',
    );
  });

  it('should keep publication closed when one human authorization gate is not approved', async () => {
    const fixture = await publicationFixture();
    const authorization = JSON.parse(await readFile(fixture.authorizationPath, 'utf8'));
    authorization.attestations.npm_scope_control_confirmed = false;
    await writeJson(fixture.authorizationPath, authorization);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'GitHub release authorization is not bound to the exact candidate and publication mode.',
    );
    expect(await readdir(fixture.outputDirectory)).toEqual([]);
  });

  it('should reject authorization bytes without matching GitHub attestation evidence', async () => {
    const fixture = await publicationFixture();
    await writeFile(fixture.authorizationAttestationPath, 'different attestation bytes\n');

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'GitHub release authorization attestation does not authenticate the exact authorization.',
    );
  });

  it('should reject retained GitHub controls with administrator bypass', async () => {
    const fixture = await publicationFixture();
    const controls = JSON.parse(await readFile(fixture.githubControlsPath, 'utf8'));
    controls.environment.can_admins_bypass = true;
    await writeJson(fixture.githubControlsPath, controls);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'Retained GitHub release controls do not prove the exact publication boundary.',
    );
  });

  it('should reject stable workflow evidence from a self-hosted runner', async () => {
    const fixture = await publicationFixture();
    const workflowIdentity = JSON.parse(await readFile(fixture.workflowIdentityPath, 'utf8'));
    workflowIdentity.runner_environment = 'self-hosted';
    await writeJson(fixture.workflowIdentityPath, workflowIdentity);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'Stable workflow identity does not prove the exact runner, OIDC, actor, and artifact boundary.',
    );
  });

  it('should reject a signed tag message that does not bind the exact candidate inventory', async () => {
    const fixture = await publicationFixture();
    const tagEvidence = JSON.parse(await readFile(fixture.tagEvidencePath, 'utf8'));
    tagEvidence.message = tagEvidence.message.replace(fixture.candidateDigest, '0'.repeat(64));
    await writeJson(fixture.tagEvidencePath, tagEvidence);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'Signed tag evidence does not bind and protect the exact candidate bytes and source commit.',
    );
  });

  it('should reject tag protection with a bypass actor', async () => {
    const fixture = await publicationFixture();
    const tagEvidence = JSON.parse(await readFile(fixture.tagEvidencePath, 'utf8'));
    tagEvidence.protection.bypass_actors = [
      { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' },
    ];
    await writeJson(fixture.tagEvidencePath, tagEvidence);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'Signed tag evidence does not bind and protect the exact candidate bytes and source commit.',
    );
  });

  it('should reject a support table not generated from the passing host index', async () => {
    const fixture = await publicationFixture();
    await writeFile(
      join(fixture.supportDirectory, 'breakdown-supported-hosts-1.0.0.md'),
      '# Supported Agent Hosts\n\nAn unqualified host is Supported.\n',
    );

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'Generated host support Markdown is not derived from the authenticated host support index.',
    );
  });

  it('should reject a Supported Host claim not derived from a passing indexed row', async () => {
    const fixture = await publicationFixture();
    const hostIndex = JSON.parse(await readFile(fixture.hostIndexPath, 'utf8'));
    hostIndex.supported_hosts[0].surface = 'Unqualified Agent Host';
    await writeJson(fixture.hostIndexPath, hostIndex);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'Supported Host claims are not derived from the indexed rows.',
    );
  });

  it('should expose the complete release gate as one strict command', async () => {
    const fixture = await publicationFixture();

    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        join(repositoryRoot, 'scripts', 'prepare-local-publication.mjs'),
        '--candidate',
        fixture.candidateDirectory,
        '--platform-index',
        fixture.platformIndexPath,
        '--host-support-index',
        fixture.hostIndexPath,
        '--host-support',
        fixture.supportDirectory,
        '--authorization',
        fixture.authorizationPath,
        '--authorization-attestation',
        fixture.authorizationAttestationPath,
        '--authorization-verification',
        fixture.authorizationVerificationPath,
        '--github-controls',
        fixture.githubControlsPath,
        '--tag-evidence',
        fixture.tagEvidencePath,
        '--workflow-identity',
        fixture.workflowIdentityPath,
        '--npm-controls',
        fixture.npmControlsPath,
        '--output',
        fixture.outputDirectory,
      ],
      { cwd: repositoryRoot },
    );

    expect(stderr).toBe('');
    expect(JSON.parse(stdout)).toMatchObject({
      schema_version: 'breakdown.publication-inspection.v1',
      release_version: releaseVersion,
      status: 'passed',
      public_assets: 26,
    });
  });

  it('should reject a coherently re-inventoried change to the once-built candidate', async () => {
    const fixture = await publicationFixture();
    await prepareFixture(fixture);
    const changedFile = 'breakdown-sh-core-1.0.0.tgz';
    const changedBytes = Buffer.from('rebuilt after qualification\n');
    await writeFile(join(fixture.outputDirectory, changedFile), changedBytes);
    const manifestFile = 'breakdown-publication-manifest-1.0.0.json';
    const manifestPath = join(fixture.outputDirectory, manifestFile);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const artifact = manifest.artifacts.find(
      (candidate: { file: string }) => candidate.file === changedFile,
    );
    artifact.bytes = changedBytes.byteLength;
    artifact.hashes = {
      sha256: sha256(changedBytes),
      sha512: sha512(changedBytes),
    };
    await writeJson(manifestPath, manifest);
    const checksumFile = 'breakdown-publication-SHA256SUMS-1.0.0';
    const publicationFiles = (await readdir(fixture.outputDirectory))
      .filter((file) => file !== checksumFile)
      .sort();
    const checksumLines = [];
    for (const file of publicationFiles) {
      checksumLines.push(`${sha256(await readFile(join(fixture.outputDirectory, file)))}  ${file}`);
    }
    await writeFile(join(fixture.outputDirectory, checksumFile), `${checksumLines.join('\n')}\n`);

    await expect(
      inspectLocalPublication({ publicationDirectory: fixture.outputDirectory }),
    ).rejects.toThrow(`Candidate checksum differs for ${changedFile}.`);
  });
});

describe('verifyPublishedLocalRelease', () => {
  it('should reject an incomplete post-publication command before network access', async () => {
    const command = execFileAsync(
      process.execPath,
      [join(repositoryRoot, 'scripts', 'verify-local-publication.mjs')],
      { cwd: repositoryRoot },
    );

    await expect(command).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'Usage: verify-local-publication.mjs --publication PATH --repository OWNER/NAME --work PATH --output PATH',
      ),
    });
  });

  it('should verify every public byte, immutable release record, npm channel, and signature', async () => {
    const fixture = await publicationFixture();
    await configureDeferredHostSupport(fixture);
    await prepareFixture(fixture);
    const workDirectory = join(fixture.outputDirectory, '..', 'public-verification');
    await mkdir(workDirectory);
    const packageFiles = new Map([
      ['@breakdown-sh/core@1.0.0', 'breakdown-sh-core-1.0.0.tgz'],
      ['@breakdown-sh/cli@1.0.0', 'breakdown-sh-cli-1.0.0.tgz'],
      ['@breakdown-sh/mcp@1.0.0', 'breakdown-sh-mcp-1.0.0.tgz'],
    ]);
    const commands: Array<{ command: string; args: string[] }> = [];
    const commandRunner = async (
      command: string,
      args: string[],
      options: { cwd?: string } = {},
    ) => {
      commands.push({ command, args });
      if (command === 'gh' && args[0] === 'release' && args[1] === 'download') {
        const destination = args[args.indexOf('--dir') + 1]!;
        await mkdir(destination, { recursive: true });
        for (const file of await readdir(fixture.outputDirectory)) {
          await copyFile(join(fixture.outputDirectory, file), join(destination, file));
        }
        return { stdout: '', stderr: '' };
      }
      if (command === 'gh' && args[0] === 'release' && args[1] === 'view') {
        const assets = await Promise.all(
          (await readdir(fixture.outputDirectory)).map(async (name) => ({
            name,
            size: (await readFile(join(fixture.outputDirectory, name))).byteLength,
          })),
        );
        return {
          stdout: JSON.stringify({
            assets,
            isDraft: false,
            isImmutable: true,
            isPrerelease: false,
            tagName: 'breakdown-local-v1.0.0',
            targetCommitish: gitCommit,
            url: 'https://github.com/alamorre/breakdown.sh/releases/tag/breakdown-local-v1.0.0',
          }),
          stderr: '',
        };
      }
      if (command === 'gh' && args[0] === 'api' && args[1].includes('/git/ref/tags/')) {
        return {
          stdout: JSON.stringify({
            object: { type: 'tag', sha: 'd'.repeat(40) },
          }),
          stderr: '',
        };
      }
      if (command === 'gh' && args[0] === 'api' && args[1].includes('/git/tags/')) {
        const retainedTagEvidence = JSON.parse(await readFile(fixture.tagEvidencePath, 'utf8'));
        return {
          stdout: JSON.stringify({
            sha: 'd'.repeat(40),
            tag: 'breakdown-local-v1.0.0',
            object: { type: 'commit', sha: gitCommit },
            message: retainedTagEvidence.message,
            verification: { verified: true, reason: 'valid' },
          }),
          stderr: '',
        };
      }
      if (command === 'gh' && args[0] === 'api' && args[1].includes('/rulesets/')) {
        return {
          stdout: JSON.stringify({
            id: 20015652,
            name: 'Protect Breakdown Local stable release tags',
            target: 'tag',
            enforcement: 'active',
            conditions: {
              ref_name: {
                include: ['refs/tags/breakdown-local-v*'],
                exclude: [],
              },
            },
            rules: [{ type: 'update' }, { type: 'deletion' }],
            bypass_actors: [],
            current_user_can_bypass: 'never',
          }),
          stderr: '',
        };
      }
      if (command === 'gh' && args[0] === 'attestation' && args[1] === 'verify') {
        return { stdout: '{}', stderr: '' };
      }
      if (command === 'gh' && args[0] === 'release' && args[1].startsWith('verify')) {
        return { stdout: '{}', stderr: '' };
      }
      if (command === 'npm' && args[0] === 'view') {
        return { stdout: JSON.stringify(releaseVersion), stderr: '' };
      }
      if (command === 'npm' && args[0] === 'pack') {
        const packageFile = packageFiles.get(args[1]!);
        if (packageFile === undefined) throw new Error(`Unexpected npm package ${args[1]}`);
        const destination = args[args.indexOf('--pack-destination') + 1]!;
        await mkdir(destination, { recursive: true });
        await copyFile(join(fixture.outputDirectory, packageFile), join(destination, packageFile));
        return {
          stdout: JSON.stringify([{ filename: packageFile }]),
          stderr: '',
        };
      }
      if (
        command === 'npm' &&
        ((args[0] === 'install' && options.cwd !== undefined) ||
          (args[0] === 'audit' && args[1] === 'signatures'))
      ) {
        return {
          stdout: args[0] === 'audit' ? JSON.stringify({ invalid: [], missing: [] }) : '',
          stderr: '',
        };
      }
      throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
    };

    await expect(
      verifyPublishedLocalRelease({
        commandRunner,
        publicationDirectory: fixture.outputDirectory,
        repository: 'alamorre/breakdown.sh',
        workDirectory,
      }),
    ).resolves.toMatchObject({
      schema_version: 'breakdown.post-publication-inspection.v1',
      release_version: releaseVersion,
      status: 'passed',
      github: {
        immutable: true,
        release_assets: 26,
        verified_assets: 26,
        asset_provenance_attestations: 26,
      },
      npm: {
        dist_tag: 'latest',
        packages: 3,
        exact_tarballs: 3,
        signatures_and_provenance: 'passed',
      },
      host_support_policy: { state: 'deferred' },
      supported_hosts: 0,
    });
    expect(
      commands.find(
        ({ command, args }) =>
          command === 'gh' &&
          args[0] === 'attestation' &&
          args.some((arg) => arg.endsWith('breakdown-host-support-index.attestation.json')),
      )?.args[2],
    ).toContain('breakdown-host-support-index.json');
  });
});

describe('stable publication workflow', () => {
  it('should publish only downloaded qualified bytes through the protected human ceremony', async () => {
    const workflow = await readFile(
      join(repositoryRoot, '.github', 'workflows', 'local-stable-publication.yml'),
      'utf8',
    );

    const requiredSnippets = [
      'candidate_artifact_id:',
      'platform_index_artifact_id:',
      'host_support_artifact_id:',
      'authorization_artifact_id:',
      'ceremony_run_id:',
      'npm_publication_mode:',
      'first-package-bootstrap',
      'finalize-bootstrap',
      'oidc-trusted-publishing',
      'npm_trusted_publishing_artifact_id:',
      'npm_bootstrap_artifact_id:',
      "startsWith(github.ref, 'refs/tags/breakdown-local-v')",
      'environment: breakdown-local-stable',
      'actions: read',
      'attestations: write',
      'contents: write',
      'id-token: write',
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8',
      'artifact-ids: ${{ inputs.candidate_artifact_id }}',
      'artifact-ids: ${{ inputs.platform_index_artifact_id }}',
      'artifact-ids: ${{ inputs.host_support_artifact_id }}',
      'breakdown-github-release-authorization.json',
      'breakdown-github-release-authorization.attestation.json',
      'local-release-ceremony.yml',
      'pnpm local:release:verify-github-controls',
      'current_user_can_bypass',
      'repo:alamorre/breakdown.sh:environment:breakdown-local-stable',
      'npm:registry.npmjs.org',
      'RUNNER_ENVIRONMENT',
      'certificate_claims_verified',
      'gh attestation verify "$HOST_INDEX"',
      'breakdown-host-support-index.json',
      'breakdown-host-support-index.attestation.json',
      '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/local-host-support.yml"',
      'pnpm local:release:prepare-publication',
      'pnpm local:release:prepare-npm',
      'pnpm local:release:publish-first-npm-packages',
      'pnpm local:release:verify-first-npm-packages',
      'secrets.NPM_FIRST_PACKAGE_TOKEN',
      'breakdown-npm-first-package-bootstrap.attestation.json',
      'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4',
      'gh release create',
      '--draft',
      '--verify-tag',
      'npm publish',
      'breakdown-sh-core-${RELEASE_VERSION}.tgz',
      'breakdown-sh-cli-${RELEASE_VERSION}.tgz',
      'breakdown-sh-mcp-${RELEASE_VERSION}.tgz',
      '--access public --tag latest',
      'gh release edit',
      '--draft=false',
      '--prerelease=false',
      '--latest',
      'pnpm local:release:verify-publication',
      'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7',
    ];
    expect(requiredSnippets.filter((snippet) => !workflow.includes(snippet))).toEqual([]);
    const forbiddenSnippets = ['local:release:build', 'NPM_TOKEN', 'tag_ruleset_id:'];
    expect(forbiddenSnippets.filter((snippet) => workflow.includes(snippet))).toEqual([]);

    const qualificationWorkflow = await readFile(
      join(repositoryRoot, '.github', 'workflows', 'local-platform-qualification.yml'),
      'utf8',
    );
    expect(qualificationWorkflow).not.toContain("tags:\n      - 'breakdown-local-v*'");
  });
});

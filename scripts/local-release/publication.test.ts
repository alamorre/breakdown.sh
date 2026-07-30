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
  verifyPublishedLocalRelease,
  writeHumanReleaseApprovalTemplate,
} from './publication.mjs';
import { writeHostSupportMaterial } from './host-evidence.mjs';

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
  const primaryBytes = new Map(
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
  const hostIndexPath = join(root, 'breakdown-host-evidence-index.json');
  await writeJson(hostIndexPath, {
    schema_version: 'breakdown.guided-host-evidence-index.v1',
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
  await writeJson(join(supportDirectory, 'breakdown-host-evidence-index.attestation.json'), {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
  });

  const approvalPath = join(root, 'breakdown-human-release-approval.json');
  await writeJson(approvalPath, {
    schema_version: 'breakdown.human-release-approval.v1',
    release_version: releaseVersion,
    candidate_digest: { algorithm: 'SHA-256', content: candidateDigest },
    source: {
      repository: 'https://github.com/alamorre/breakdown.sh',
      git_commit: gitCommit,
    },
    tag: 'breakdown-local-v1.0.0',
    approver: {
      name: 'Release Approver',
      email: 'release@example.com',
      github_login: 'release-approver',
    },
    approved_at: '2026-07-29T20:00:00.000Z',
    attestations: Object.fromEntries(
      HUMAN_RELEASE_ATTESTATIONS.map((attestation) => [attestation, true]),
    ),
    statement:
      'I approve publication of only the identified candidate bytes after completing every recorded human gate.',
  });

  const tagEvidencePath = join(root, 'breakdown-signed-tag-evidence.json');
  await writeJson(tagEvidencePath, {
    schema_version: 'breakdown.signed-tag-evidence.v1',
    repository: 'https://github.com/alamorre/breakdown.sh',
    tag: 'breakdown-local-v1.0.0',
    tag_object_sha: 'd'.repeat(40),
    target: { type: 'commit', sha: gitCommit },
    verification: { verified: true, reason: 'valid' },
    message: `Breakdown Local 1.0.0

candidate-digest-sha256: ${candidateDigest}
candidate-checksum-inventory-sha256: ${sha256(checksumBytes)}
candidate-artifact-id: 1234
platform-index-artifact-id: 5678`,
    artifact_ids: {
      candidate: '1234',
      platform_index: '5678',
    },
    protection: {
      ruleset_id: 42,
      name: 'Protect Breakdown Local release tags',
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
    },
  });

  return {
    approvalPath,
    candidateDirectory,
    candidateDigest,
    hostIndexPath,
    outputDirectory,
    platformIndexPath,
    primaryBytes,
    supportDirectory,
    supportedHosts,
    tagEvidencePath,
  };
}

function prepareFixture(fixture: Awaited<ReturnType<typeof publicationFixture>>) {
  return prepareLocalPublication({
    approvalPath: fixture.approvalPath,
    candidateDirectory: fixture.candidateDirectory,
    hostIndexPath: fixture.hostIndexPath,
    outputDirectory: fixture.outputDirectory,
    platformIndexPath: fixture.platformIndexPath,
    supportDirectory: fixture.supportDirectory,
    tagEvidencePath: fixture.tagEvidencePath,
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
      approver: {
        name: '',
        email: '',
        github_login: '',
      },
      approved_at: '',
    });
    const template = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(template.attestations).toEqual(
      Object.fromEntries(HUMAN_RELEASE_ATTESTATIONS.map((name) => [name, false])),
    );
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

  it('should keep publication closed when one human gate is not approved', async () => {
    const fixture = await publicationFixture();
    const approval = JSON.parse(await readFile(fixture.approvalPath, 'utf8'));
    approval.attestations.npm_scope_control_confirmed = false;
    await writeJson(fixture.approvalPath, approval);

    await expect(prepareFixture(fixture)).rejects.toThrow(
      'Human release approval does not affirm every required gate.',
    );
    expect(await readdir(fixture.outputDirectory)).toEqual([]);
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
      'Generated host support Markdown is not derived from the exact passing host index.',
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
        '--host-index',
        fixture.hostIndexPath,
        '--host-support',
        fixture.supportDirectory,
        '--approval',
        fixture.approvalPath,
        '--tag-evidence',
        fixture.tagEvidencePath,
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
      public_assets: 21,
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
    await prepareFixture(fixture);
    const workDirectory = join(fixture.outputDirectory, '..', 'public-verification');
    await mkdir(workDirectory);
    const packageFiles = new Map([
      ['@breakdown-sh/core@1.0.0', 'breakdown-sh-core-1.0.0.tgz'],
      ['@breakdown-sh/cli@1.0.0', 'breakdown-sh-cli-1.0.0.tgz'],
      ['@breakdown-sh/mcp@1.0.0', 'breakdown-sh-mcp-1.0.0.tgz'],
    ]);
    const commandRunner = async (
      command: string,
      args: string[],
      options: { cwd?: string } = {},
    ) => {
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
        return {
          stdout: JSON.stringify({
            sha: 'd'.repeat(40),
            tag: 'breakdown-local-v1.0.0',
            object: { type: 'commit', sha: gitCommit },
            message: `Breakdown Local 1.0.0

candidate-digest-sha256: ${fixture.candidateDigest}
candidate-checksum-inventory-sha256: ${sha256(
              await readFile(join(fixture.outputDirectory, 'SHA256SUMS')),
            )}
candidate-artifact-id: 1234
platform-index-artifact-id: 5678`,
            verification: { verified: true, reason: 'valid' },
          }),
          stderr: '',
        };
      }
      if (command === 'gh' && args[0] === 'api' && args[1].includes('/rulesets/')) {
        return {
          stdout: JSON.stringify({
            id: 42,
            name: 'Protect Breakdown Local release tags',
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
        release_assets: 21,
        verified_assets: 21,
        asset_provenance_attestations: 21,
      },
      npm: {
        dist_tag: 'latest',
        packages: 3,
        exact_tarballs: 3,
        signatures_and_provenance: 'passed',
      },
    });
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
      'human_approval_base64:',
      "startsWith(github.ref, 'refs/tags/breakdown-local-v')",
      'environment: breakdown-local-stable',
      'actions: read',
      'attestations: write',
      'contents: write',
      'id-token: write',
      'actions/download-artifact@v8',
      'artifact-ids: ${{ inputs.candidate_artifact_id }}',
      'artifact-ids: ${{ inputs.platform_index_artifact_id }}',
      'artifact-ids: ${{ inputs.host_support_artifact_id }}',
      'inputs.human_approval_base64',
      'verification.verified',
      'candidate-checksum-inventory-sha256:',
      '([.rules[].type] | index("update"))',
      '([.rules[].type] | index("deletion"))',
      '(.bypass_actors | length) == 0',
      'gh attestation verify "$HOST_INDEX"',
      '--signer-workflow "$GITHUB_REPOSITORY/.github/workflows/local-host-support.yml"',
      'pnpm local:release:prepare-publication',
      'actions/attest@v4',
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
      'actions/upload-artifact@v7',
    ];
    expect(requiredSnippets.filter((snippet) => !workflow.includes(snippet))).toEqual([]);
    const forbiddenSnippets = ['local:release:build', 'NODE_AUTH_TOKEN'];
    expect(forbiddenSnippets.filter((snippet) => workflow.includes(snippet))).toEqual([]);

    const qualificationWorkflow = await readFile(
      join(repositoryRoot, '.github', 'workflows', 'local-platform-qualification.yml'),
      'utf8',
    );
    expect(qualificationWorkflow).not.toContain("tags:\n      - 'breakdown-local-v*'");
  });
});

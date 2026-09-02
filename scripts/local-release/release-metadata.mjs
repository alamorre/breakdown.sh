import { execFile } from 'node:child_process';
import { readFile, statfs, writeFile } from 'node:fs/promises';
import { release as osRelease, version as osVersion } from 'node:os';
import { extname, join, relative } from 'node:path';
import { promisify } from 'node:util';

import { filesBelow, sha256, sha512 } from './filesystem.mjs';
import { dependencyGraphRecords, packageNameFromLockPath } from './package-artifacts.mjs';
import { releaseChannel } from './release-channel.mjs';

const execFileAsync = promisify(execFile);

const releaseSourceDirectories = [
  'local/contracts',
  'local/docs',
  'local/skills',
  'plugins/breakdown/skills',
  'packages/breakdown-core/src',
  'packages/breakdown-cli/src',
  'packages/breakdown-cli/scripts',
  'packages/breakdown-mcp/src',
  'packages/breakdown-mcp/scripts',
  'scripts/local-release',
];

const releaseSourceFiles = [
  'package.json',
  'local/LICENSE-SCOPE.md',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'scripts/authorize-release-ceremony.mjs',
  'scripts/bind-host-evidence.mjs',
  'scripts/build-local-release.mjs',
  'scripts/create-release-approval.mjs',
  'scripts/generate-local-documentation.mjs',
  'scripts/hash-host-evidence.mjs',
  'scripts/index-host-evidence.mjs',
  'scripts/index-platform-evidence.mjs',
  'scripts/inspect-npm-trusted-publishing.mjs',
  'scripts/inspect-local-release.mjs',
  'scripts/prepare-npm-publication.mjs',
  'scripts/prepare-host-qualification.mjs',
  'scripts/prepare-local-publication.mjs',
  'scripts/plan-release-ceremony.mjs',
  'scripts/publish-first-npm-packages.mjs',
  'scripts/qualify-host-evidence.mjs',
  'scripts/qualify-local-release.mjs',
  'scripts/rehearse-host-qualification.mjs',
  'scripts/render-release-tag-message.mjs',
  'scripts/standalone-validator.mjs',
  'scripts/verify-local-publication.mjs',
  'scripts/verify-first-npm-packages.mjs',
  'scripts/verify-v1-release-recovery.mjs',
  'packages/breakdown-core/package.json',
  'packages/breakdown-core/tsconfig.build.json',
  'packages/breakdown-core/tsconfig.json',
  'packages/breakdown-cli/package.json',
  'packages/breakdown-cli/tsconfig.build.json',
  'packages/breakdown-cli/tsconfig.json',
  'packages/breakdown-mcp/package.json',
  'packages/breakdown-mcp/tsconfig.build.json',
  'packages/breakdown-mcp/tsconfig.json',
];

function mediaType(fileName) {
  if (fileName.endsWith('.tgz') || fileName.endsWith('.tar.gz')) {
    return 'application/gzip';
  }
  if (fileName.endsWith('.zip')) return 'application/zip';
  return 'application/json';
}

async function artifactRecord(outputPath, fileName, role) {
  const bytes = await readFile(join(outputPath, fileName));
  return {
    file: fileName,
    role,
    media_type: mediaType(fileName),
    bytes: bytes.byteLength,
    hashes: {
      sha256: sha256(bytes),
      sha512: sha512(bytes),
    },
  };
}

function packagePurl(name, version) {
  const encodedName = name.startsWith('@') ? `%40${name.slice(1)}` : name;
  return `pkg:npm/${encodedName}@${version}`;
}

function integrityHash(integrity) {
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) return [];
  return [
    {
      alg: 'SHA-512',
      content: Buffer.from(integrity.slice('sha512-'.length), 'base64').toString('hex'),
    },
  ];
}

function externalComponents(packageResults) {
  const components = new Map();
  for (const result of packageResults) {
    for (const [path, value] of Object.entries(result.shrinkwrap?.packages ?? {})) {
      if (path === '' || value === null || typeof value !== 'object') continue;
      const name = packageNameFromLockPath(path);
      if (name === undefined || name.startsWith('@breakdown-sh/')) continue;
      const key = `${name}@${value.version}`;
      components.set(key, {
        type: 'library',
        'bom-ref': packagePurl(name, value.version),
        name,
        version: value.version,
        purl: packagePurl(name, value.version),
        hashes: integrityHash(value.integrity),
        licenses: [{ license: { id: value.license } }],
        externalReferences:
          typeof value.resolved === 'string' ? [{ type: 'distribution', url: value.resolved }] : [],
      });
    }
  }
  return [...components.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  );
}

function externalDependencyGraph(packageResults) {
  const graph = new Map();
  for (const result of packageResults) {
    for (const component of dependencyGraphRecords(result.shrinkwrap ?? { packages: {} })) {
      const reference = packagePurl(component.name, component.version);
      const dependencies = graph.get(reference) ?? new Set();
      for (const dependency of component.dependencies) {
        dependencies.add(packagePurl(dependency.name, dependency.version));
      }
      graph.set(reference, dependencies);
    }
  }
  return graph;
}

function directDependencyRef(packageResults, dependencyName, version) {
  const firstParty = packageResults.find((result) => result.name === dependencyName);
  return firstParty === undefined
    ? packagePurl(dependencyName, version)
    : packagePurl(firstParty.name, firstParty.manifest.version);
}

function archiveReference(fileName) {
  return `urn:breakdown:artifact:${encodeURIComponent(fileName)}`;
}

export async function writeSbom({ archiveNames, outputPath, packageResults, releaseVersion }) {
  const external = externalComponents(packageResults);
  const externalGraph = externalDependencyGraph(packageResults);
  const packageComponents = [];
  const archiveComponents = [];
  const dependencies = [];
  for (const result of packageResults) {
    const bytes = await readFile(result.artifactPath);
    const reference = packagePurl(result.name, releaseVersion);
    packageComponents.push({
      type: result.name === '@breakdown-sh/core' ? 'library' : 'application',
      'bom-ref': reference,
      name: result.name,
      version: releaseVersion,
      purl: reference,
      hashes: [
        { alg: 'SHA-256', content: sha256(bytes) },
        { alg: 'SHA-512', content: sha512(bytes) },
      ],
      licenses: [{ license: { id: 'Apache-2.0' } }],
      properties: [
        { name: 'breakdown:artifact', value: result.artifactName },
        { name: 'breakdown:node-engine', value: result.manifest.engines.node },
      ],
    });
    dependencies.push({
      ref: reference,
      dependsOn: Object.entries(result.manifest.dependencies ?? {})
        .map(([name, version]) => directDependencyRef(packageResults, name, version))
        .sort(),
    });
  }
  for (const [key, fileName] of Object.entries(archiveNames).sort(([, left], [, right]) =>
    left.localeCompare(right),
  )) {
    const bytes = await readFile(join(outputPath, fileName));
    const reference = archiveReference(fileName);
    archiveComponents.push({
      type: 'file',
      'bom-ref': reference,
      name: fileName,
      version: releaseVersion,
      hashes: [
        { alg: 'SHA-256', content: sha256(bytes) },
        { alg: 'SHA-512', content: sha512(bytes) },
      ],
      licenses: [{ license: { id: 'Apache-2.0' } }],
      properties: [
        { name: 'breakdown:artifact', value: fileName },
        {
          name: 'breakdown:role',
          value: key.startsWith('contracts') ? 'contracts-archive' : 'skills-archive',
        },
      ],
    });
    dependencies.push({ ref: reference, dependsOn: [] });
  }
  for (const component of external) {
    dependencies.push({
      ref: component['bom-ref'],
      dependsOn: [...(externalGraph.get(component['bom-ref']) ?? [])].sort(),
    });
  }

  const fileName = `breakdown-sbom-${releaseVersion}.cdx.json`;
  const bom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        'bom-ref': `breakdown-local-release@${releaseVersion}`,
        name: 'Breakdown Local release set',
        version: releaseVersion,
        licenses: [{ license: { id: 'Apache-2.0' } }],
      },
      tools: {
        components: [
          {
            type: 'application',
            name: 'Breakdown Local candidate builder',
            version: releaseVersion,
          },
        ],
      },
    },
    components: [...packageComponents, ...archiveComponents, ...external],
    dependencies: [
      {
        ref: `breakdown-local-release@${releaseVersion}`,
        dependsOn: [...packageComponents, ...archiveComponents]
          .map((component) => component['bom-ref'])
          .sort(),
      },
      ...dependencies.sort((left, right) => left.ref.localeCompare(right.ref)),
    ],
  };
  await writeFile(join(outputPath, fileName), `${JSON.stringify(bom, null, 2)}\n`);
  return fileName;
}

function provenanceRole(path) {
  if (path.includes('/src/')) return 'implementation-source';
  if (path.includes('/contracts/')) return 'contract-input';
  if (path.includes('/skills/')) return 'skill-input';
  if (extname(path) === '.json') return 'manifest-or-configuration';
  return 'build-input';
}

async function provenanceInputPaths(repositoryRoot) {
  const paths = [];
  for (const directoryPath of releaseSourceDirectories) {
    for (const absolutePath of await filesBelow(join(repositoryRoot, directoryPath))) {
      if (absolutePath.endsWith('.test.ts')) continue;
      paths.push(absolutePath);
    }
  }
  for (const path of releaseSourceFiles) {
    paths.push(join(repositoryRoot, path));
  }
  return [...new Set(paths)].sort();
}

async function commandOutput(command, args, cwd) {
  const { stdout } = await execFileAsync(command, args, { cwd });
  return stdout.trim();
}

export async function assertCleanReleaseSource(repositoryRoot) {
  const status = await commandOutput(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    repositoryRoot,
  );
  if (status.length > 0) {
    throw new Error(`The entire Git worktree must be clean before building:\n${status}`);
  }
}

function candidateDigest(subjects) {
  const inventory = subjects
    .map((subject) => `${subject.digest.sha256}  ${subject.name}`)
    .sort()
    .join('\n');
  return sha256(Buffer.from(`${inventory}\n`));
}

async function builderEnvironment({ outputPath, repositoryRoot, subjects }) {
  const filesystem = await statfs(outputPath, { bigint: true });
  const manifestBytes = await readFile(join(repositoryRoot, 'local', 'contracts', 'MANIFEST.json'));
  return {
    os: {
      platform: process.platform,
      release: osRelease(),
      version: osVersion(),
    },
    architecture: process.arch,
    node: process.version,
    filesystem: {
      type: `0x${BigInt.asUintN(64, filesystem.type).toString(16)}`,
      block_size: filesystem.bsize.toString(),
    },
    runner: {
      provider: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local',
      name: process.env.RUNNER_NAME ?? 'local-process',
      os: process.env.RUNNER_OS ?? process.platform,
      architecture: process.env.RUNNER_ARCH ?? process.arch,
    },
    corpus_revision: {
      file: 'local/contracts/MANIFEST.json',
      sha256: sha256(manifestBytes),
    },
    candidate_digest: {
      algorithm: 'SHA-256',
      content: candidateDigest(subjects),
      scope: 'sorted primary artifact names and SHA-256 digests',
    },
  };
}

function platformConformance(environment) {
  return {
    state: 'pending-required-evidence',
    support_claim: 'No maintained-platform support claim is made by this local candidate alone.',
    maintained_tuples: [
      { os: 'linux-glibc', architecture: 'x64' },
      { os: 'linux-glibc', architecture: 'arm64' },
      { os: 'macos', architecture: 'x64' },
      { os: 'macos', architecture: 'arm64' },
    ],
    current_build: environment,
    required_suite:
      'Complete deterministic core, CLI, package, disk, crash, concurrency, and applicable security suite against these exact candidate digests.',
    required_retained_evidence: [
      'exact OS',
      'architecture',
      'Node patch',
      'filesystem',
      'runner',
      'corpus revision',
      'candidate digest',
    ],
  };
}

export async function writeProvenanceInputs({
  outputPath,
  primaryArtifacts,
  releaseVersion,
  repositoryRoot,
}) {
  const sourceInputs = [];
  for (const absolutePath of await provenanceInputPaths(repositoryRoot)) {
    const bytes = await readFile(absolutePath);
    const path = relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
    sourceInputs.push({
      path,
      role: provenanceRole(path),
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    });
  }
  const subjects = [];
  for (const artifact of primaryArtifacts) {
    const bytes = await readFile(join(outputPath, artifact.file));
    subjects.push({
      name: artifact.file,
      digest: {
        sha256: sha256(bytes),
        sha512: sha512(bytes),
      },
    });
  }
  const environment = await builderEnvironment({ outputPath, repositoryRoot, subjects });
  const fileName = `breakdown-provenance-inputs-${releaseVersion}.json`;
  const provenance = {
    schema_version: 'breakdown.provenance-inputs.v1',
    release_version: releaseVersion,
    statement:
      'These content-addressed inputs and subjects are the auditable inputs to later signed GitHub and npm provenance. This file is not itself a signature or attestation.',
    source: {
      repository: 'https://github.com/alamorre/breakdown.sh',
      git_commit: await commandOutput('git', ['rev-parse', 'HEAD'], repositoryRoot),
      clean: true,
      clean_scope: 'entire-git-worktree',
      source_inputs: sourceInputs,
    },
    builder: {
      build_type: 'https://breakdown.sh/build-types/local-release/v1',
      node: process.version,
      npm: await commandOutput('npm', ['--version'], repositoryRoot),
      pnpm: await commandOutput('pnpm', ['--version'], repositoryRoot),
      environment,
      commands: [
        'pnpm local:release:build --output <candidate-directory>',
        'pnpm local:release:inspect --candidate <candidate-directory>',
      ],
    },
    subjects,
    required_signed_publication_evidence: [
      'signed protected breakdown-local-v<version> tag',
      'GitHub immutable release attestation',
      'npm trusted-publisher provenance for each package',
      'npm registry signature for each package',
    ],
  };
  await writeFile(join(outputPath, fileName), `${JSON.stringify(provenance, null, 2)}\n`);
  return {
    fileName,
    platformConformance: platformConformance(environment),
    provenance,
  };
}

export async function writeReleaseManifest({
  archiveNames,
  outputPath,
  packageResults,
  platformConformance,
  provenanceName,
  releaseVersion,
  sbomName,
}) {
  const artifactRoles = [
    ...packageResults.map((result) => [result.artifactName, result.role]),
    [archiveNames.skillsTar, 'skills-archive'],
    [archiveNames.skillsZip, 'skills-archive'],
    [archiveNames.contractsTar, 'contracts-archive'],
    [archiveNames.contractsZip, 'contracts-archive'],
    [sbomName, 'software-bill-of-materials'],
    [provenanceName, 'provenance-inputs'],
  ];
  const artifacts = [];
  for (const [fileName, role] of artifactRoles.sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    artifacts.push(await artifactRecord(outputPath, fileName, role));
  }
  const fileName = `breakdown-release-${releaseVersion}.json`;
  const manifest = {
    schema_version: 'breakdown.release-manifest.v1',
    release_version: releaseVersion,
    channel: releaseChannel(releaseVersion),
    integrity: {
      checksum_inventory: 'SHA256SUMS',
      manifest_file: fileName,
      rule: 'SHA256SUMS authenticates every other candidate file, including this manifest.',
    },
    artifacts,
    packages: packageResults.map((result) => ({
      name: result.name,
      version: releaseVersion,
      artifact: result.artifactName,
      node_engine: result.manifest.engines.node,
      type: result.manifest.type,
      exports: result.manifest.exports,
      bins: result.manifest.bin ?? {},
      dependencies: result.manifest.dependencies ?? {},
      shrinkwrap: result.shrinkwrap === undefined ? null : 'npm-shrinkwrap.json',
    })),
    architecture: {
      direction: [
        '@breakdown-sh/cli -> @breakdown-sh/core',
        '@breakdown-sh/mcp -> @breakdown-sh/core',
        '@breakdown-sh/core -> yaml',
      ],
      package_root_only: true,
      bundled_runtime: false,
      browser_build: false,
      native_addons: false,
      install_time_build: false,
    },
    project_boundary: {
      required_project_entries: ['breakdown.yaml'],
      not_required: [
        'package.json',
        'lockfile',
        'node_modules',
        'version receipt',
        'updater state',
        'database',
        'account',
        'Git repository',
      ],
    },
    platform_conformance: platformConformance,
    license_scope: {
      license: 'Apache-2.0',
      included: [
        'packages/breakdown-core',
        'packages/breakdown-cli',
        'packages/breakdown-mcp',
        'local/contracts',
        'local/docs',
        'local/skills',
        'local/LICENSE-SCOPE.md',
        'scripts/local-release',
        'scripts/authorize-release-ceremony.mjs',
        'scripts/bind-host-evidence.mjs',
        'scripts/build-local-release.mjs',
        'scripts/create-release-approval.mjs',
        'scripts/generate-local-documentation.mjs',
        'scripts/index-host-evidence.mjs',
        'scripts/index-platform-evidence.mjs',
        'scripts/inspect-npm-trusted-publishing.mjs',
        'scripts/inspect-local-release.mjs',
        'scripts/prepare-npm-publication.mjs',
        'scripts/prepare-host-qualification.mjs',
        'scripts/prepare-local-publication.mjs',
        'scripts/plan-release-ceremony.mjs',
        'scripts/publish-first-npm-packages.mjs',
        'scripts/qualify-host-evidence.mjs',
        'scripts/qualify-local-release.mjs',
        'scripts/render-release-tag-message.mjs',
        'scripts/standalone-validator.mjs',
        'scripts/verify-local-publication.mjs',
        'scripts/verify-first-npm-packages.mjs',
        'scripts/verify-v1-release-recovery.mjs',
      ],
      excluded: [
        'hosted application root and hosted assets',
        'Breakdown names, logos, and other branding rights',
        'user-authored Workflow Definitions, Inputs, Runs, and Results',
        'third-party dependencies and material under their own licenses',
      ],
    },
    publication_evidence: {
      state: 'candidate-only',
      signed_tag: 'required-before-publication',
      github_immutable_release_attestation: 'required-before-publication',
      npm_oidc_provenance: 'required-before-publication',
      npm_registry_signatures: 'required-before-publication',
      legal_authority_and_scope_control: 'requires-human-confirmation',
      dco_and_ai_assistance_review: 'requires-human-confirmation',
    },
  };
  await writeFile(join(outputPath, fileName), `${JSON.stringify(manifest, null, 2)}\n`);
  return { artifacts, fileName, manifest };
}

export async function writeChecksums({ outputPath, fileNames }) {
  const lines = [];
  for (const fileName of [...fileNames].sort()) {
    lines.push(`${sha256(await readFile(join(outputPath, fileName)))}  ${fileName}`);
  }
  await writeFile(join(outputPath, 'SHA256SUMS'), `${lines.join('\n')}\n`);
}

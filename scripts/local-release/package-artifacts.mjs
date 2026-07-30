import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import { releaseChannel } from './release-channel.mjs';

const execFileAsync = promisify(execFile);

export const packageArtifactDefinitions = [
  {
    directory: 'breakdown-core',
    fileStem: 'breakdown-sh-core',
    name: '@breakdown-sh/core',
    role: 'core-library',
  },
  {
    directory: 'breakdown-cli',
    fileStem: 'breakdown-sh-cli',
    name: '@breakdown-sh/cli',
    role: 'command-line-interface',
  },
  {
    directory: 'breakdown-mcp',
    fileStem: 'breakdown-sh-mcp',
    name: '@breakdown-sh/mcp',
    role: 'mcp-adapter',
  },
];

const displayNames = {
  '@breakdown-sh/core': 'Breakdown Local Core',
  '@breakdown-sh/cli': 'Breakdown Local CLI',
  '@breakdown-sh/mcp': 'Breakdown Local MCP Adapter',
};

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

export function packageNameFromLockPath(path) {
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  return index === -1 ? undefined : path.slice(index + marker.length);
}

export function dependencyRecords(shrinkwrap) {
  const records = new Map();
  for (const [path, value] of Object.entries(shrinkwrap.packages ?? {})) {
    if (path === '' || value === null || typeof value !== 'object') continue;
    const name = packageNameFromLockPath(path);
    if (name === undefined || name.startsWith('@breakdown-sh/')) continue;
    const key = `${name}@${value.version}`;
    records.set(key, {
      license: value.license,
      name,
      resolved: value.resolved,
      version: value.version,
    });
  }
  return [...records.values()].sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  );
}

function resolveLockDependency(packages, packagePath, dependencyName) {
  let cursor = packagePath;
  while (cursor.length > 0) {
    const nestedPath = `${cursor}/node_modules/${dependencyName}`;
    if (packages[nestedPath] !== undefined) return packages[nestedPath];
    const parentIndex = cursor.lastIndexOf('/node_modules/');
    if (parentIndex === -1) break;
    cursor = cursor.slice(0, parentIndex);
  }
  return packages[`node_modules/${dependencyName}`];
}

export function dependencyGraphRecords(shrinkwrap) {
  const records = [];
  const packages = shrinkwrap.packages ?? {};
  for (const [path, value] of Object.entries(packages)) {
    if (path === '' || value === null || typeof value !== 'object') continue;
    const name = packageNameFromLockPath(path);
    if (name === undefined || name.startsWith('@breakdown-sh/')) continue;
    const dependencyNames = new Set([
      ...Object.keys(value.dependencies ?? {}),
      ...Object.keys(value.optionalDependencies ?? {}),
      ...Object.keys(value.peerDependencies ?? {}),
    ]);
    const dependencies = [];
    for (const dependencyName of [...dependencyNames].sort()) {
      const resolved = resolveLockDependency(packages, path, dependencyName);
      if (resolved === undefined || dependencyName.startsWith('@breakdown-sh/')) continue;
      dependencies.push({ name: dependencyName, version: resolved.version });
    }
    records.push({ dependencies, name, version: value.version });
  }
  return records.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.version.localeCompare(right.version),
  );
}

export function thirdPartyNotices(releaseVersion, dependencies, dependencySource) {
  const rows = dependencies.map(
    ({ license, name, resolved, version }) =>
      `| \`${name}\` | \`${version}\` | \`${license}\` | ${resolved} |`,
  );
  return `# Third-Party Notices

Document kind: License and notice material

Document version: ${releaseVersion}

The following exact runtime dependency versions are recorded from ${dependencySource}:

| Package | Version | License | Source archive |
| --- | --- | --- | --- |
${rows.join('\n')}

These ordinary dependencies are installed separately by npm. Their implementation bytes are not
bundled into this package tarball, so no third-party license text is copied into this package.
The installed dependencies retain their own license files and notices.
`;
}

export function packageNotice(packageName, releaseVersion) {
  return `${displayNames[packageName]}
Copyright 2026 Adam Lamorre

This package is part of Breakdown Local ${releaseVersion}.
`;
}

async function writeLegalFiles({
  dependencies,
  licenseBytes,
  releaseVersion,
  stagePath,
  packageName,
  dependencySource,
}) {
  await writeFile(join(stagePath, 'LICENSE'), licenseBytes);
  await writeFile(join(stagePath, 'NOTICE'), packageNotice(packageName, releaseVersion));
  await writeFile(
    join(stagePath, 'THIRD_PARTY_NOTICES.md'),
    thirdPartyNotices(releaseVersion, dependencies, dependencySource),
  );
}

export function registryTarballUrl(packageName, version) {
  const leafName = packageName.slice(packageName.lastIndexOf('/') + 1);
  return `https://registry.npmjs.org/${packageName}/-/${leafName}-${version}.tgz`;
}

async function generateShrinkwrap({ coreTarballPath, packageManifest, stagePath }) {
  const publishDependencies = Object.fromEntries(
    Object.entries(packageManifest.dependencies ?? {}).map(([name, version]) => [
      name,
      name === '@breakdown-sh/core' ? packageManifest.version : version,
    ]),
  );
  const lockDependencies = {
    ...publishDependencies,
    '@breakdown-sh/core': `file:${coreTarballPath}`,
  };
  const lockManifest = {
    name: packageManifest.name,
    version: packageManifest.version,
    license: packageManifest.license,
    type: packageManifest.type,
    engines: packageManifest.engines,
    ...(packageManifest.bin === undefined ? {} : { bin: packageManifest.bin }),
    dependencies: lockDependencies,
  };
  await writeFile(join(stagePath, 'package.json'), `${JSON.stringify(lockManifest, null, 2)}\n`);
  await run(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--omit=dev',
      '--engine-strict',
      '--audit=false',
      '--fund=false',
    ],
    { cwd: stagePath },
  );

  const shrinkwrap = JSON.parse(await readFile(join(stagePath, 'package-lock.json'), 'utf8'));
  shrinkwrap.packages[''].dependencies = publishDependencies;
  const coreEntry = shrinkwrap.packages['node_modules/@breakdown-sh/core'];
  if (coreEntry === undefined) {
    throw new Error(`${packageManifest.name} shrinkwrap did not resolve @breakdown-sh/core.`);
  }
  coreEntry.resolved = registryTarballUrl('@breakdown-sh/core', packageManifest.version);
  coreEntry.license = 'Apache-2.0';
  const shrinkwrapText = `${JSON.stringify(shrinkwrap, null, 2)}\n`;
  if (shrinkwrapText.includes('file:') || shrinkwrapText.includes(stagePath)) {
    throw new Error(`${packageManifest.name} shrinkwrap retained a local path.`);
  }
  await writeFile(join(stagePath, 'npm-shrinkwrap.json'), shrinkwrapText);
  await writeFile(join(stagePath, 'package.json'), `${JSON.stringify(packageManifest, null, 2)}\n`);
  return shrinkwrap;
}

async function packStage({ artifactName, outputPath, stagePath }) {
  const { stdout } = await run(
    'npm',
    ['pack', '.', '--json', '--ignore-scripts', '--pack-destination', outputPath],
    { cwd: stagePath },
  );
  const packResult = JSON.parse(stdout);
  if (!Array.isArray(packResult) || packResult.length !== 1) {
    throw new Error(`npm pack returned an unexpected result for ${artifactName}.`);
  }
  const generatedPath = join(outputPath, basename(packResult[0].filename));
  const artifactPath = join(outputPath, artifactName);
  await rename(generatedPath, artifactPath);
  return artifactPath;
}

async function coreDependencyRecords(repositoryRoot, packageManifest) {
  const records = [];
  for (const [name, version] of Object.entries(packageManifest.dependencies ?? {})) {
    const dependencyManifest = JSON.parse(
      await readFile(
        join(repositoryRoot, 'packages', 'breakdown-core', 'node_modules', name, 'package.json'),
        'utf8',
      ),
    );
    records.push({
      license: dependencyManifest.license,
      name,
      resolved: registryTarballUrl(name, version),
      version,
    });
  }
  return records;
}

export async function buildPackageArtifacts({ outputPath, releaseVersion, repositoryRoot }) {
  const licenseBytes = await readFile(join(repositoryRoot, 'local', 'contracts', 'LICENSE'));
  for (const definition of packageArtifactDefinitions) {
    await rm(join(repositoryRoot, 'packages', definition.directory, 'dist'), {
      force: true,
      recursive: true,
    });
    await run('pnpm', ['--filter', definition.name, 'build'], { cwd: repositoryRoot });
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), 'breakdown-package-candidate-'));
  const packageResults = [];
  let coreTarballPath;
  try {
    for (const definition of packageArtifactDefinitions) {
      const sourcePath = join(repositoryRoot, 'packages', definition.directory);
      const stagePath = join(temporaryRoot, definition.directory);
      await cp(join(sourcePath, 'dist'), join(stagePath, 'dist'), { recursive: true });
      const sourceManifest = JSON.parse(await readFile(join(sourcePath, 'package.json'), 'utf8'));
      if (sourceManifest.version !== releaseVersion) {
        throw new Error(`${definition.name} is not on release version ${releaseVersion}.`);
      }
      const expectedDistTag = releaseChannel(releaseVersion).npm_dist_tag;
      if (
        sourceManifest.publishConfig?.access !== 'public' ||
        sourceManifest.publishConfig?.provenance !== true ||
        sourceManifest.publishConfig?.tag !== expectedDistTag
      ) {
        throw new Error(
          `${definition.name} must publish publicly with provenance on npm ${expectedDistTag}.`,
        );
      }
      const packageManifest = {
        ...sourceManifest,
        dependencies: Object.fromEntries(
          Object.entries(sourceManifest.dependencies ?? {}).map(([name, version]) => [
            name,
            typeof version === 'string' && version.startsWith('workspace:')
              ? version.slice('workspace:'.length)
              : version,
          ]),
        ),
      };

      let shrinkwrap;
      if (definition.name === '@breakdown-sh/core') {
        const dependencies = await coreDependencyRecords(repositoryRoot, packageManifest);
        await writeLegalFiles({
          dependencies,
          licenseBytes,
          packageName: definition.name,
          releaseVersion,
          stagePath,
          dependencySource: 'the final package manifest and installed lockfile input',
        });
        await writeFile(
          join(stagePath, 'package.json'),
          `${JSON.stringify(packageManifest, null, 2)}\n`,
        );
      } else {
        if (coreTarballPath === undefined) {
          throw new Error('The core tarball must be built before adapter shrinkwraps.');
        }
        shrinkwrap = await generateShrinkwrap({
          coreTarballPath,
          packageManifest,
          stagePath,
        });
        await writeLegalFiles({
          dependencies: dependencyRecords(shrinkwrap),
          licenseBytes,
          packageName: definition.name,
          releaseVersion,
          stagePath,
          dependencySource: "this package's final `npm-shrinkwrap.json` dependency tree",
        });
      }

      const artifactName = `${definition.fileStem}-${releaseVersion}.tgz`;
      const artifactPath = await packStage({ artifactName, outputPath, stagePath });
      if (definition.name === '@breakdown-sh/core') coreTarballPath = artifactPath;
      packageResults.push({
        ...definition,
        artifactName,
        artifactPath,
        manifest: packageManifest,
        shrinkwrap,
      });
    }
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
  return packageResults;
}

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { contractsNotice, contractsThirdPartyNotices } from './contracts-archive.mjs';
import { filesBelow, sha256, sha512 } from './filesystem.mjs';
import {
  dependencyGraphRecords,
  dependencyRecords,
  packageArtifactDefinitions,
  packageNotice,
  registryTarballUrl,
  runPackageArtifactCommand,
  thirdPartyNotices,
} from './package-artifacts.mjs';
import { releaseChannel } from './release-channel.mjs';
import { skillsNotice, skillsThirdPartyNotices } from './skills-archive.mjs';

const execFileAsync = promisify(execFile);
const apacheLicenseSha256 = 'c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4';
const installLifecycleScripts = ['preinstall', 'install', 'postinstall'];
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:ANTHROPIC|OPENAI|SUPABASE)_API_KEY\s*=/,
  /\bSUPABASE_SERVICE_ROLE_KEY\s*=/,
  /\bsk_live_[a-zA-Z0-9]{16,}\b/,
];

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function tarText(header, start, length) {
  const value = header.subarray(start, start + length).toString('utf8');
  const terminator = value.indexOf('\0');
  return (terminator === -1 ? value : value.slice(0, terminator)).trim();
}

export function tarGzipEntries(archive) {
  const tar = gunzipSync(archive);
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarText(header, 0, 100);
    const prefix = tarText(header, 345, 155);
    const path = prefix.length > 0 ? `${prefix}/${name}` : name;
    const size = Number.parseInt(tarText(header, 124, 12) || '0', 8);
    const type = tarText(header, 156, 1) || '0';
    const contents = Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
    if (type === '0') entries.set(path, contents);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export function zipEntries(archive) {
  const entries = new Map();
  let offset = 0;
  while (offset + 4 <= archive.byteLength && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    invariant(method === 0, 'Release zip entries must use deterministic stored encoding.');
    const compressedSize = archive.readUInt32LE(offset + 18);
    const fileNameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const path = archive.subarray(nameStart, nameStart + fileNameLength).toString('utf8');
    entries.set(path, Buffer.from(archive.subarray(dataStart, dataStart + compressedSize)));
    offset = dataStart + compressedSize;
  }
  return entries;
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function inspectSecrets(entries, label) {
  const forbiddenNames = /(?:^|\/)(?:\.env(?:\.|$)|id_rsa$|credentials(?:\.json)?$)|\.pem$/i;
  for (const [path, bytes] of entries) {
    invariant(!forbiddenNames.test(path), `${label} contains forbidden private path ${path}.`);
    if (bytes.includes(0)) continue;
    const text = bytes.toString('utf8');
    for (const pattern of secretPatterns) {
      invariant(!pattern.test(text), `${label} contains a secret-like value in ${path}.`);
    }
  }
}

function exactFiles(manifest) {
  return manifest.name === '@breakdown-sh/core'
    ? ['dist', 'LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'package.json']
    : [
        'dist',
        'LICENSE',
        'NOTICE',
        'THIRD_PARTY_NOTICES.md',
        'npm-shrinkwrap.json',
        'package.json',
      ];
}

function breakdownImportName(specifier) {
  if (!specifier.startsWith('@breakdown-sh/')) return undefined;
  return specifier.split('/').slice(0, 2).join('/');
}

function inspectJavaScriptImports(entries, manifest) {
  const dependencyNames = new Set(Object.keys(manifest.dependencies ?? {}));
  const importPattern = /(?:from\s+|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]/g;
  for (const [path, bytes] of entries) {
    if (!path.endsWith('.js')) continue;
    const source = bytes.toString('utf8');
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      const breakdownPackage = breakdownImportName(specifier);
      if (breakdownPackage === undefined) continue;
      invariant(
        specifier === breakdownPackage,
        `${manifest.name} contains forbidden deep import ${specifier}.`,
      );
      invariant(
        dependencyNames.has(breakdownPackage),
        `${manifest.name} imports undeclared package ${breakdownPackage}.`,
      );
    }
    invariant(!source.includes('@supabase/'), `${manifest.name} contains a hosted dependency.`);
    invariant(!source.includes('next/'), `${manifest.name} contains a Next.js dependency.`);
  }
}

function inspectShrinkwrap(shrinkwrap, manifest) {
  invariant(shrinkwrap.lockfileVersion === 3, `${manifest.name} shrinkwrap must be version 3.`);
  invariant(
    JSON.stringify(shrinkwrap.packages[''].dependencies ?? {}) ===
      JSON.stringify(manifest.dependencies ?? {}),
    `${manifest.name} shrinkwrap root dependencies differ from package.json.`,
  );
  const serialized = JSON.stringify(shrinkwrap);
  invariant(
    !serialized.includes('file:'),
    `${manifest.name} shrinkwrap contains a file dependency.`,
  );
  invariant(
    !serialized.includes('link:'),
    `${manifest.name} shrinkwrap contains a link dependency.`,
  );
  for (const [path, value] of Object.entries(shrinkwrap.packages ?? {})) {
    if (path === '') continue;
    invariant(
      typeof value.version === 'string' &&
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.version),
      `${manifest.name} shrinkwrap has a non-exact version at ${path}.`,
    );
    invariant(
      typeof value.license === 'string' && value.license.length > 0,
      `${manifest.name} shrinkwrap has no license at ${path}.`,
    );
    invariant(
      typeof value.resolved === 'string' &&
        value.resolved.startsWith('https://registry.npmjs.org/'),
      `${manifest.name} shrinkwrap has a non-registry resolution at ${path}.`,
    );
  }
}

function inspectPackageArchive(archive, definition, releaseVersion) {
  const entries = tarGzipEntries(archive);
  const manifest = parseJson(entries.get('package/package.json'), `${definition.name} manifest`);
  invariant(manifest.name === definition.name, `${definition.name} tarball has the wrong name.`);
  invariant(manifest.version === releaseVersion, `${definition.name} is not lockstep.`);
  invariant(manifest.private === undefined, `${definition.name} remains private.`);
  invariant(manifest.license === 'Apache-2.0', `${definition.name} is not Apache-2.0.`);
  invariant(manifest.type === 'module', `${definition.name} is not ESM.`);
  invariant(manifest.engines?.node === '^24.0.0', `${definition.name} has the wrong Node engine.`);
  invariant(
    JSON.stringify(manifest.files) === JSON.stringify(exactFiles(manifest)),
    `${definition.name} has the wrong explicit file allowlist.`,
  );
  invariant(manifest.browser === undefined, `${definition.name} declares a browser build.`);
  invariant(
    manifest.bundleDependencies === undefined && manifest.bundledDependencies === undefined,
    `${definition.name} bundles dependencies.`,
  );
  for (const scriptName of installLifecycleScripts) {
    invariant(
      manifest.scripts?.[scriptName] === undefined,
      `${definition.name} contains ${scriptName}.`,
    );
  }

  const entryPaths = [...entries.keys()];
  for (const requiredPath of [
    'package/LICENSE',
    'package/NOTICE',
    'package/THIRD_PARTY_NOTICES.md',
    'package/dist/index.js',
    'package/dist/index.d.ts',
    'package/package.json',
  ]) {
    invariant(entries.has(requiredPath), `${definition.name} is missing ${requiredPath}.`);
  }
  for (const path of entryPaths) {
    invariant(!path.endsWith('.map'), `${definition.name} includes source map ${path}.`);
    invariant(!path.endsWith('.node'), `${definition.name} includes native addon ${path}.`);
    invariant(!path.startsWith('package/src/'), `${definition.name} includes source ${path}.`);
    invariant(!path.includes('/test'), `${definition.name} includes test material ${path}.`);
  }
  const allowedPrefixes = exactFiles(manifest).map((path) => `package/${path}`);
  for (const path of entryPaths) {
    invariant(
      allowedPrefixes.some(
        (prefix) => path === prefix || (prefix.endsWith('/dist') && path.startsWith(`${prefix}/`)),
      ),
      `${definition.name} includes non-allowlisted path ${path}.`,
    );
  }

  if (definition.name === '@breakdown-sh/core') {
    invariant(
      JSON.stringify(Object.keys(manifest.exports ?? {})) === JSON.stringify(['.']),
      'Core must export only the package root.',
    );
    invariant(manifest.bin === undefined, 'Core must not publish a bin.');
  } else {
    invariant(
      Object.keys(manifest.exports ?? {}).length === 0,
      `${definition.name} must block in-process imports.`,
    );
    invariant(
      Object.keys(manifest.bin ?? {}).length === 1,
      `${definition.name} must publish exactly one bin.`,
    );
  }

  let shrinkwrap;
  if (definition.name !== '@breakdown-sh/core') {
    shrinkwrap = parseJson(
      entries.get('package/npm-shrinkwrap.json'),
      `${definition.name} shrinkwrap`,
    );
    inspectShrinkwrap(shrinkwrap, manifest);
    const notices = entries.get('package/THIRD_PARTY_NOTICES.md').toString('utf8');
    for (const dependency of dependencyRecords(shrinkwrap)) {
      invariant(
        notices.includes(`\`${dependency.name}\``),
        `${definition.name} notices omit ${dependency.name}.`,
      );
    }
  } else {
    invariant(
      entries.get('package/THIRD_PARTY_NOTICES.md').toString('utf8').includes('`yaml`'),
      'Core notices omit yaml.',
    );
  }
  inspectJavaScriptImports(entries, manifest);
  inspectSecrets(entries, definition.name);
  return { definition, entries, manifest, shrinkwrap };
}

function inspectPackageArchitecture(packages) {
  const allowedDependencies = {
    '@breakdown-sh/core': ['yaml'],
    '@breakdown-sh/cli': ['@breakdown-sh/core'],
    '@breakdown-sh/mcp': ['@breakdown-sh/core', '@modelcontextprotocol/sdk', 'zod'],
  };
  const graph = new Map();
  for (const inspected of packages) {
    const dependencies = Object.keys(inspected.manifest.dependencies ?? {});
    invariant(
      JSON.stringify(dependencies) === JSON.stringify(allowedDependencies[inspected.manifest.name]),
      `${inspected.manifest.name} has the wrong dependency direction.`,
    );
    graph.set(
      inspected.manifest.name,
      dependencies.filter((dependency) => dependency.startsWith('@breakdown-sh/')),
    );
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(name) {
    invariant(!visiting.has(name), `Breakdown package dependency cycle reaches ${name}.`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const dependency of graph.get(name) ?? []) visit(dependency);
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of graph.keys()) visit(name);
}

function sortedRecord(record) {
  return Object.fromEntries(
    Object.entries(record ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function inspectExpectedPackages(contractsArchive, packages, releaseVersion) {
  const fixturePath = `${contractsArchive.archiveRoot}/conformance/package/fixtures/artifact-expectations.json`;
  const fixture = parseJson(
    contractsArchive.entries.get(fixturePath),
    'package artifact expectations',
  );
  invariant(
    fixture.release_version === releaseVersion,
    'Package artifact expectations are not lockstep.',
  );
  invariant(
    fixture.packages.length === packages.length,
    'Package artifact expectations do not cover every package.',
  );
  for (const expected of fixture.packages) {
    const actual = packages.find((entry) => entry.manifest.name === expected.name)?.manifest;
    invariant(actual !== undefined, `Package artifact expectations name absent ${expected.name}.`);
    invariant(actual.version === expected.version, `${expected.name} fixture version differs.`);
    invariant(actual.engines?.node === expected.engine, `${expected.name} fixture engine differs.`);
    invariant(
      JSON.stringify(sortedRecord(actual.dependencies)) ===
        JSON.stringify(sortedRecord(expected.runtime_dependencies)),
      `${expected.name} fixture dependencies differ.`,
    );
    if (expected.exports !== undefined) {
      invariant(
        JSON.stringify(Object.keys(actual.exports ?? {}).sort()) ===
          JSON.stringify([...expected.exports].sort()),
        `${expected.name} fixture exports differ.`,
      );
    }
    if (expected.bins !== undefined) {
      invariant(
        JSON.stringify(Object.keys(actual.bin ?? {}).sort()) ===
          JSON.stringify([...expected.bins].sort()),
        `${expected.name} fixture bins differ.`,
      );
    }
  }
}

function inspectArchiveManifest(entries, archiveRoot, schemaVersion) {
  const manifestPath = `${archiveRoot}/MANIFEST.json`;
  const manifest = parseJson(entries.get(manifestPath), `${archiveRoot} manifest`);
  invariant(manifest.schema_version === schemaVersion, `${archiveRoot} has the wrong schema.`);
  const payloadPaths = [...entries.keys()]
    .filter((path) => path !== manifestPath)
    .map((path) => path.slice(archiveRoot.length + 1));
  invariant(
    JSON.stringify(manifest.entries.map((entry) => entry.path)) === JSON.stringify(payloadPaths),
    `${archiveRoot} manifest inventory differs from archive bytes.`,
  );
  for (const entry of manifest.entries) {
    const bytes = entries.get(`${archiveRoot}/${entry.path}`);
    invariant(bytes !== undefined, `${archiveRoot} is missing ${entry.path}.`);
    invariant(entry.bytes === bytes.byteLength, `${archiveRoot}/${entry.path} has wrong size.`);
    invariant(entry.sha256 === sha256(bytes), `${archiveRoot}/${entry.path} has wrong hash.`);
    invariant(entry.media_type.length > 0, `${archiveRoot}/${entry.path} has no media type.`);
    invariant(entry.role.length > 0, `${archiveRoot}/${entry.path} has no role.`);
  }
  for (const legalPath of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md', 'VERSION']) {
    invariant(entries.has(`${archiveRoot}/${legalPath}`), `${archiveRoot} omits ${legalPath}.`);
  }
  inspectSecrets(entries, archiveRoot);
  return manifest;
}

function inspectArchivePair({ candidatePath, releaseVersion, stem, schemaVersion }) {
  const archiveRoot = `${stem}-${releaseVersion}`;
  const tar = tarGzipEntries(candidatePath.get(`${archiveRoot}.tar.gz`));
  const zip = zipEntries(candidatePath.get(`${archiveRoot}.zip`));
  invariant(
    JSON.stringify([...tar.keys()]) === JSON.stringify([...zip.keys()]),
    `${archiveRoot} zip and tar paths differ.`,
  );
  for (const [path, bytes] of tar) {
    invariant(bytes.equals(zip.get(path)), `${archiveRoot} zip and tar bytes differ at ${path}.`);
  }
  const manifest = inspectArchiveManifest(tar, archiveRoot, schemaVersion);
  return { archiveRoot, entries: tar, manifest };
}

function inspectCanonicalSkillManifest(skillsArchive) {
  const embeddedPath = `${skillsArchive.archiveRoot}/setup-breakdown/assets/skill-pack-manifest.json`;
  const embedded = parseJson(
    skillsArchive.entries.get(embeddedPath),
    'embedded skill pack manifest',
  );
  for (const skill of embedded.skills) {
    for (const file of skill.files) {
      const path = `${skillsArchive.archiveRoot}/${skill.name}/${file.path}`;
      const bytes = skillsArchive.entries.get(path);
      invariant(bytes !== undefined, `Skills archive omits ${skill.name}/${file.path}.`);
      invariant(sha256(bytes) === file.sha256, `Skill byte drift at ${skill.name}/${file.path}.`);
    }
    for (const legalPath of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
      invariant(
        skillsArchive.entries.has(`${skillsArchive.archiveRoot}/${skill.name}/${legalPath}`),
        `${skill.name} omits ${legalPath}.`,
      );
    }
  }
}

function componentForArtifact(sbom, fileName) {
  return sbom.components.find((component) =>
    component.properties?.some(
      (property) => property.name === 'breakdown:artifact' && property.value === fileName,
    ),
  );
}

function inspectComponentHashes(component, bytes, label) {
  invariant(component !== undefined, `SBOM omits ${label}.`);
  const hashes = Object.fromEntries(component.hashes.map((hash) => [hash.alg, hash.content]));
  invariant(hashes['SHA-256'] === sha256(bytes), `SBOM SHA-256 differs for ${label}.`);
  invariant(hashes['SHA-512'] === sha512(bytes), `SBOM SHA-512 differs for ${label}.`);
}

function inspectSbom(sbom, packages, candidateBytes, releaseVersion) {
  invariant(sbom.bomFormat === 'CycloneDX', 'SBOM is not CycloneDX.');
  invariant(sbom.specVersion === '1.6', 'SBOM is not CycloneDX 1.6.');
  invariant(sbom.metadata?.component?.version === releaseVersion, 'SBOM is not lockstep.');
  const componentRefs = new Set(sbom.components.map((component) => component['bom-ref']));
  const releaseReference = `breakdown-local-release@${releaseVersion}`;
  const releaseDependencies = sbom.dependencies.find(
    (dependency) => dependency.ref === releaseReference,
  );
  invariant(releaseDependencies !== undefined, 'SBOM omits release-set dependencies.');
  const primaryReferences = [];
  for (const inspected of packages) {
    const artifactName = `${inspected.definition.fileStem}-${releaseVersion}.tgz`;
    const component = componentForArtifact(sbom, artifactName);
    inspectComponentHashes(component, candidateBytes.get(artifactName), artifactName);
    primaryReferences.push(component['bom-ref']);
    invariant(
      [...componentRefs].some(
        (reference) =>
          reference.includes(encodeURIComponent(inspected.manifest.name)) ||
          reference.includes(inspected.manifest.name.replace('@', '%40')),
      ),
      `SBOM omits ${inspected.manifest.name}.`,
    );
    for (const dependency of dependencyRecords(inspected.shrinkwrap ?? { packages: {} })) {
      invariant(
        sbom.components.some(
          (component) =>
            component.name === dependency.name && component.version === dependency.version,
        ),
        `SBOM omits ${dependency.name}@${dependency.version}.`,
      );
    }
    const dependencyRow = sbom.dependencies.find(
      (dependency) => dependency.ref === component['bom-ref'],
    );
    const directReferences = Object.entries(inspected.manifest.dependencies ?? {})
      .map(([name, version]) => {
        const directComponent = sbom.components.find(
          (candidate) => candidate.name === name && candidate.version === version,
        );
        invariant(directComponent !== undefined, `SBOM omits direct component ${name}@${version}.`);
        return directComponent['bom-ref'];
      })
      .sort();
    invariant(
      JSON.stringify([...(dependencyRow?.dependsOn ?? [])].sort()) ===
        JSON.stringify(directReferences),
      `SBOM direct dependency graph differs for ${inspected.manifest.name}.`,
    );
  }
  for (const fileName of [
    `breakdown-contracts-${releaseVersion}.tar.gz`,
    `breakdown-contracts-${releaseVersion}.zip`,
    `breakdown-skills-${releaseVersion}.tar.gz`,
    `breakdown-skills-${releaseVersion}.zip`,
  ]) {
    const component = componentForArtifact(sbom, fileName);
    invariant(component?.type === 'file', `SBOM does not model ${fileName} as a file.`);
    invariant(component?.version === releaseVersion, `SBOM is not lockstep for ${fileName}.`);
    inspectComponentHashes(component, candidateBytes.get(fileName), fileName);
    primaryReferences.push(component['bom-ref']);
  }
  invariant(
    JSON.stringify([...releaseDependencies.dependsOn].sort()) ===
      JSON.stringify(primaryReferences.sort()),
    'SBOM release set does not depend on every primary artifact exactly once.',
  );
  const expectedExternalGraph = new Map();
  for (const inspected of packages) {
    for (const record of dependencyGraphRecords(inspected.shrinkwrap ?? { packages: {} })) {
      const component = sbom.components.find(
        (candidate) => candidate.name === record.name && candidate.version === record.version,
      );
      invariant(
        component !== undefined,
        `SBOM omits dependency graph component ${record.name}@${record.version}.`,
      );
      const expectedDependencies = expectedExternalGraph.get(component['bom-ref']) ?? new Set();
      for (const dependency of record.dependencies) {
        const dependencyComponent = sbom.components.find(
          (candidate) =>
            candidate.name === dependency.name && candidate.version === dependency.version,
        );
        invariant(
          dependencyComponent !== undefined,
          `SBOM omits transitive component ${dependency.name}@${dependency.version}.`,
        );
        expectedDependencies.add(dependencyComponent['bom-ref']);
      }
      expectedExternalGraph.set(component['bom-ref'], expectedDependencies);
    }
  }
  for (const [reference, expectedDependencies] of expectedExternalGraph) {
    const dependencyRow = sbom.dependencies.find((dependency) => dependency.ref === reference);
    invariant(dependencyRow !== undefined, `SBOM omits dependency row ${reference}.`);
    invariant(
      JSON.stringify([...dependencyRow.dependsOn].sort()) ===
        JSON.stringify([...expectedDependencies].sort()),
      `SBOM transitive dependency graph differs for ${reference}.`,
    );
  }
}

function exactText(entries, path, expected, label) {
  const bytes = entries.get(path);
  invariant(bytes !== undefined, `${label} is absent.`);
  invariant(bytes.toString('utf8') === expected, `${label} content differs.`);
}

function sourceInputHash(provenance, path) {
  const input = provenance.source.source_inputs.find((candidate) => candidate.path === path);
  invariant(input !== undefined, `Provenance omits legal source ${path}.`);
  return input.sha256;
}

function inspectLegalMaterial({ contracts, packages, provenance, releaseVersion, sbom, skills }) {
  const contractPrefix = contracts.archiveRoot;
  const canonicalLicense = contracts.entries.get(`${contractPrefix}/LICENSE`);
  invariant(
    sha256(canonicalLicense) === apacheLicenseSha256,
    'Contracts archive does not contain the complete canonical Apache-2.0 license.',
  );
  invariant(
    sourceInputHash(provenance, 'local/contracts/LICENSE') === sha256(canonicalLicense),
    'Contracts license differs from its provenance input.',
  );
  exactText(contracts.entries, `${contractPrefix}/NOTICE`, contractsNotice(), 'Contracts NOTICE');
  exactText(
    contracts.entries,
    `${contractPrefix}/THIRD_PARTY_NOTICES.md`,
    contractsThirdPartyNotices(releaseVersion),
    'Contracts third-party notices',
  );
  exactText(
    contracts.entries,
    `${contractPrefix}/VERSION`,
    `${releaseVersion}\n`,
    'Contracts VERSION',
  );

  const skillsPrefix = skills.archiveRoot;
  invariant(
    skills.entries.get(`${skillsPrefix}/LICENSE`).equals(canonicalLicense),
    'Skills archive license differs from the canonical Apache-2.0 license.',
  );
  exactText(
    skills.entries,
    `${skillsPrefix}/NOTICE`,
    skillsNotice(releaseVersion),
    'Skills NOTICE',
  );
  exactText(
    skills.entries,
    `${skillsPrefix}/THIRD_PARTY_NOTICES.md`,
    skillsThirdPartyNotices(releaseVersion),
    'Skills third-party notices',
  );
  exactText(skills.entries, `${skillsPrefix}/VERSION`, `${releaseVersion}\n`, 'Skills VERSION');
  for (const path of skills.entries.keys()) {
    const relativePath = path.slice(skillsPrefix.length + 1);
    if (
      !relativePath.includes('/') ||
      !/(?:LICENSE|NOTICE|THIRD_PARTY_NOTICES\.md)$/.test(relativePath)
    ) {
      continue;
    }
    invariant(
      sourceInputHash(provenance, `local/skills/${relativePath}`) ===
        sha256(skills.entries.get(path)),
      `Skills legal file differs from its provenance input: ${relativePath}.`,
    );
    if (relativePath.endsWith('/LICENSE')) {
      invariant(
        sha256(skills.entries.get(path)) === apacheLicenseSha256,
        `Skill has an incomplete Apache-2.0 license: ${relativePath}.`,
      );
    }
  }

  for (const inspected of packages) {
    invariant(
      inspected.entries.get('package/LICENSE').equals(canonicalLicense),
      `${inspected.manifest.name} license differs from the canonical Apache-2.0 license.`,
    );
    exactText(
      inspected.entries,
      'package/NOTICE',
      packageNotice(inspected.manifest.name, releaseVersion),
      `${inspected.manifest.name} NOTICE`,
    );
    let dependencies;
    let dependencySource;
    if (inspected.manifest.name === '@breakdown-sh/core') {
      dependencies = Object.entries(inspected.manifest.dependencies ?? {}).map(
        ([name, version]) => {
          const component = sbom.components.find(
            (candidate) => candidate.name === name && candidate.version === version,
          );
          invariant(component !== undefined, `SBOM omits legal dependency ${name}@${version}.`);
          const license = component.licenses?.[0]?.license?.id;
          invariant(
            typeof license === 'string' && license.length > 0,
            `SBOM omits license for ${name}@${version}.`,
          );
          return {
            license,
            name,
            resolved: registryTarballUrl(name, version),
            version,
          };
        },
      );
      dependencySource = 'the final package manifest and installed lockfile input';
    } else {
      dependencies = dependencyRecords(inspected.shrinkwrap);
      dependencySource = "this package's final `npm-shrinkwrap.json` dependency tree";
    }
    exactText(
      inspected.entries,
      'package/THIRD_PARTY_NOTICES.md',
      thirdPartyNotices(releaseVersion, dependencies, dependencySource),
      `${inspected.manifest.name} third-party notices`,
    );
  }
}

function candidateDigest(subjects) {
  const inventory = subjects
    .map((subject) => `${subject.digest.sha256}  ${subject.name}`)
    .sort()
    .join('\n');
  return sha256(Buffer.from(`${inventory}\n`));
}

function inspectPlatformEvidence(manifest, provenance) {
  const platform = manifest.platform_conformance;
  invariant(
    platform?.state === 'pending-required-evidence',
    'Platform conformance must remain pending until retained matrix evidence exists.',
  );
  invariant(
    platform.support_claim.includes('No maintained-platform support claim'),
    'Candidate incorrectly claims maintained-platform support.',
  );
  const expectedTuples = [
    ['linux-glibc', 'x64'],
    ['linux-glibc', 'arm64'],
    ['macos', 'x64'],
    ['macos', 'arm64'],
    ['windows', 'x64'],
  ];
  invariant(
    JSON.stringify(platform.maintained_tuples.map((tuple) => [tuple.os, tuple.architecture])) ===
      JSON.stringify(expectedTuples),
    'Platform conformance has the wrong maintained tuples.',
  );
  const environment = provenance.builder?.environment;
  invariant(
    JSON.stringify(platform.current_build) === JSON.stringify(environment),
    'Release manifest and provenance disagree on the build environment.',
  );
  for (const value of [
    environment?.os?.platform,
    environment?.os?.release,
    environment?.os?.version,
    environment?.architecture,
    environment?.node,
    environment?.filesystem?.type,
    environment?.filesystem?.block_size,
    environment?.runner?.provider,
    environment?.runner?.name,
    environment?.runner?.os,
    environment?.runner?.architecture,
  ]) {
    invariant(typeof value === 'string' && value.length > 0, 'Build environment is incomplete.');
  }
  invariant(
    environment.corpus_revision?.file === 'local/contracts/MANIFEST.json' &&
      /^[0-9a-f]{64}$/.test(environment.corpus_revision.sha256),
    'Build environment has no exact corpus revision.',
  );
  invariant(
    environment.candidate_digest?.algorithm === 'SHA-256' &&
      environment.candidate_digest.content === candidateDigest(provenance.subjects),
    'Build environment has the wrong candidate digest.',
  );
  const retainedEvidence = platform.required_retained_evidence.join(' ').toLowerCase();
  for (const field of [
    'os',
    'architecture',
    'node patch',
    'filesystem',
    'runner',
    'corpus revision',
    'candidate digest',
  ]) {
    invariant(retainedEvidence.includes(field), `Platform evidence omits ${field}.`);
  }
}

async function inspectInstalledProject(candidateDirectory, packageFileNames, releaseVersion) {
  const toolsRoot = await mkdtemp(join(tmpdir(), 'breakdown-candidate-tools-'));
  const projectRoot = await mkdtemp(join(tmpdir(), 'breakdown-candidate-project-'));
  try {
    await writeFile(
      join(projectRoot, 'breakdown.yaml'),
      `schema_version: breakdown.workflow.v1
id: candidate-smoke
name: Candidate smoke
nodes:
  - id: result
    name: Result
    prompt: Produce a Result.
`,
    );
    await runPackageArtifactCommand(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-package-lock',
        '--no-save',
        '--engine-strict',
        '--audit=false',
        '--fund=false',
        ...packageFileNames.map((fileName) => join(candidateDirectory, fileName)),
      ],
      { cwd: toolsRoot },
    );
    const installedFiles = await filesBelow(join(toolsRoot, 'node_modules'));
    invariant(
      !installedFiles.some(
        (path) => path.endsWith('.node') || path.endsWith('/node') || path.endsWith('/node.exe'),
      ),
      'Installed dependency tree contains a native addon or bundled Node runtime.',
    );
    for (const packageJsonPath of installedFiles.filter((path) => path.endsWith('/package.json'))) {
      const installedManifest = parseJson(
        await readFile(packageJsonPath),
        `installed manifest ${packageJsonPath}`,
      );
      for (const scriptName of installLifecycleScripts) {
        invariant(
          installedManifest.scripts?.[scriptName] === undefined,
          `${installedManifest.name ?? packageJsonPath} contains ${scriptName}.`,
        );
      }
    }
    const cliPath = join(toolsRoot, 'node_modules', '@breakdown-sh', 'cli', 'dist', 'index.js');
    const version = await execFileAsync(process.execPath, [cliPath, '--version'], {
      cwd: toolsRoot,
    });
    invariant(version.stdout === `${releaseVersion}\n`, 'Installed CLI reports wrong version.');
    const validation = await execFileAsync(
      process.execPath,
      [cliPath, 'workflow', 'validate', '--project', projectRoot, '--json'],
      { cwd: toolsRoot },
    );
    invariant(validation.stderr === '', 'Installed CLI validation wrote stderr.');
    invariant(JSON.parse(validation.stdout).ok === true, 'Installed CLI rejected smoke project.');
    invariant(
      JSON.stringify(await readdir(projectRoot)) === JSON.stringify(['breakdown.yaml']),
      'CLI required or created forbidden project metadata.',
    );
  } finally {
    await rm(toolsRoot, { force: true, recursive: true });
    await rm(projectRoot, { force: true, recursive: true });
  }
}

export async function inspectReleaseCandidate({
  candidateDirectory,
  releaseVersion,
  runInstalledSmoke = true,
}) {
  const expectedFileNames = [
    'SHA256SUMS',
    `breakdown-contracts-${releaseVersion}.tar.gz`,
    `breakdown-contracts-${releaseVersion}.zip`,
    `breakdown-provenance-inputs-${releaseVersion}.json`,
    `breakdown-release-${releaseVersion}.json`,
    `breakdown-sbom-${releaseVersion}.cdx.json`,
    ...packageArtifactDefinitions.map(
      (definition) => `${definition.fileStem}-${releaseVersion}.tgz`,
    ),
    `breakdown-skills-${releaseVersion}.tar.gz`,
    `breakdown-skills-${releaseVersion}.zip`,
  ].sort();
  const actualFileNames = (await readdir(candidateDirectory)).sort();
  invariant(
    JSON.stringify(actualFileNames) === JSON.stringify(expectedFileNames),
    'Candidate file inventory is incomplete or contains unexpected files.',
  );

  const candidateBytes = new Map();
  for (const fileName of actualFileNames) {
    candidateBytes.set(fileName, await readFile(join(candidateDirectory, fileName)));
  }
  const checksumLines = candidateBytes.get('SHA256SUMS').toString('utf8').trimEnd().split('\n');
  const checksumFiles = [];
  for (const line of checksumLines) {
    const match = /^([0-9a-f]{64})  ([a-zA-Z0-9._-]+)$/.exec(line);
    invariant(match !== null, `Malformed SHA256SUMS line: ${line}`);
    const [, expectedHash, fileName] = match;
    invariant(fileName !== 'SHA256SUMS', 'SHA256SUMS must not hash itself.');
    invariant(candidateBytes.has(fileName), `SHA256SUMS names absent file ${fileName}.`);
    invariant(
      sha256(candidateBytes.get(fileName)) === expectedHash,
      `Checksum mismatch for ${fileName}.`,
    );
    checksumFiles.push(fileName);
  }
  invariant(
    JSON.stringify(checksumFiles.sort()) ===
      JSON.stringify(actualFileNames.filter((name) => name !== 'SHA256SUMS')),
    'SHA256SUMS does not cover every other candidate file exactly once.',
  );

  const manifestName = `breakdown-release-${releaseVersion}.json`;
  const manifest = parseJson(candidateBytes.get(manifestName), 'release manifest');
  invariant(manifest.release_version === releaseVersion, 'Release manifest is not lockstep.');
  invariant(
    JSON.stringify(manifest.channel) === JSON.stringify(releaseChannel(releaseVersion)),
    'Release manifest has the wrong stable or prerelease channels.',
  );
  invariant(manifest.license_scope?.license === 'Apache-2.0', 'License scope is not Apache-2.0.');
  for (const phrase of ['hosted', 'branding', 'user-authored', 'third-party']) {
    invariant(
      manifest.license_scope.excluded.some((entry) => entry.includes(phrase)),
      `License scope does not exclude ${phrase}.`,
    );
  }
  const manifestArtifactNames = manifest.artifacts.map((artifact) => artifact.file).sort();
  invariant(
    JSON.stringify(manifestArtifactNames) ===
      JSON.stringify(
        actualFileNames.filter((name) => name !== 'SHA256SUMS' && name !== manifestName),
      ),
    'Release manifest does not inventory every payload artifact.',
  );
  for (const artifact of manifest.artifacts) {
    const bytes = candidateBytes.get(artifact.file);
    invariant(artifact.bytes === bytes.byteLength, `${artifact.file} byte count differs.`);
    invariant(artifact.hashes.sha256 === sha256(bytes), `${artifact.file} SHA-256 differs.`);
    invariant(artifact.hashes.sha512 === sha512(bytes), `${artifact.file} SHA-512 differs.`);
  }

  const inspectedPackages = packageArtifactDefinitions.map((definition) =>
    inspectPackageArchive(
      candidateBytes.get(`${definition.fileStem}-${releaseVersion}.tgz`),
      definition,
      releaseVersion,
    ),
  );
  const expectedDistTag = releaseChannel(releaseVersion).npm_dist_tag;
  for (const inspected of inspectedPackages) {
    invariant(
      inspected.manifest.publishConfig?.access === 'public' &&
        inspected.manifest.publishConfig?.provenance === true &&
        inspected.manifest.publishConfig?.tag === expectedDistTag,
      `${inspected.manifest.name} has the wrong public provenance or npm channel.`,
    );
  }
  inspectPackageArchitecture(inspectedPackages);
  const coreIntegrity = `sha512-${Buffer.from(
    sha512(candidateBytes.get(`breakdown-sh-core-${releaseVersion}.tgz`)),
    'hex',
  ).toString('base64')}`;
  for (const inspected of inspectedPackages.filter(
    (entry) => entry.manifest.name !== '@breakdown-sh/core',
  )) {
    invariant(
      inspected.shrinkwrap.packages['node_modules/@breakdown-sh/core'].integrity === coreIntegrity,
      `${inspected.manifest.name} shrinkwrap does not authenticate the candidate core tarball.`,
    );
  }

  const contracts = inspectArchivePair({
    candidatePath: candidateBytes,
    releaseVersion,
    schemaVersion: 'breakdown.contracts-manifest.v1',
    stem: 'breakdown-contracts',
  });
  invariant(
    ![...contracts.entries.keys()].some((path) => path.endsWith('.test.ts')),
    'Contracts archive includes tests.',
  );
  inspectExpectedPackages(contracts, inspectedPackages, releaseVersion);
  const skills = inspectArchivePair({
    candidatePath: candidateBytes,
    releaseVersion,
    schemaVersion: 'breakdown.skills-archive-manifest.v1',
    stem: 'breakdown-skills',
  });
  inspectCanonicalSkillManifest(skills);

  const sbomName = `breakdown-sbom-${releaseVersion}.cdx.json`;
  const sbom = parseJson(candidateBytes.get(sbomName), 'SBOM');
  inspectSbom(sbom, inspectedPackages, candidateBytes, releaseVersion);
  const provenanceName = `breakdown-provenance-inputs-${releaseVersion}.json`;
  const provenance = parseJson(candidateBytes.get(provenanceName), 'provenance inputs');
  invariant(provenance.release_version === releaseVersion, 'Provenance inputs are not lockstep.');
  invariant(provenance.source?.clean === true, 'Release source was not recorded as clean.');
  invariant(
    provenance.source.clean_scope === 'entire-git-worktree',
    'Release cleanliness does not cover the entire Git worktree.',
  );
  for (const subject of provenance.subjects) {
    const bytes = candidateBytes.get(subject.name);
    invariant(bytes !== undefined, `Provenance names absent subject ${subject.name}.`);
    invariant(subject.digest.sha256 === sha256(bytes), `${subject.name} provenance differs.`);
    invariant(subject.digest.sha512 === sha512(bytes), `${subject.name} provenance differs.`);
  }
  for (const input of provenance.source.source_inputs) {
    invariant(!input.path.startsWith('/'), `Provenance leaks absolute path ${input.path}.`);
    invariant(/^[0-9a-f]{64}$/.test(input.sha256), `Provenance hash is invalid for ${input.path}.`);
  }
  invariant(
    provenance.source.source_inputs.some(
      (input) => input.path === 'scripts/standalone-validator.mjs',
    ),
    'Provenance omits the standalone validator generator input.',
  );
  inspectLegalMaterial({
    contracts,
    packages: inspectedPackages,
    provenance,
    releaseVersion,
    sbom,
    skills,
  });
  inspectPlatformEvidence(manifest, provenance);
  inspectSecrets(candidateBytes, 'candidate');

  if (runInstalledSmoke) {
    await inspectInstalledProject(
      candidateDirectory,
      packageArtifactDefinitions.map(
        (definition) => `${definition.fileStem}-${releaseVersion}.tgz`,
      ),
      releaseVersion,
    );
  }
  return {
    schema_version: 'breakdown.release-inspection.v1',
    release_version: releaseVersion,
    status: 'passed',
    candidate_files: actualFileNames.length,
    manifest_artifacts: manifest.artifacts.length,
    package_dependency_components: parseJson(candidateBytes.get(sbomName), 'SBOM').components
      .length,
    installed_project_smoke: runInstalledSmoke ? 'passed' : 'skipped',
  };
}

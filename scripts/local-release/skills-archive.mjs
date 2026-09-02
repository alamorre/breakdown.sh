import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

import { buildTarGzip, buildZip } from './contracts-archive.mjs';
import { filesBelow, sha256 } from './filesystem.mjs';

const skillNames = [
  'setup-breakdown',
  'author-breakdown',
  'critique-breakdown',
  'run-breakdown',
  'summarize-breakdown-run',
];

const vendoredManifestName = 'VENDORED_SKILLS.json';
const vendoredLicenseName = 'LICENSE_MATTPOCOCK_SKILLS.txt';

export function skillsNotice(releaseVersion) {
  return `Breakdown Local Skills
Copyright 2026 Adam Lamorre

This archive contains the canonical portable Agent Skills for Breakdown Local ${releaseVersion},
plus the engineering skills recorded in ${vendoredManifestName}.
`;
}

export function skillsThirdPartyNotices(releaseVersion) {
  return `# Third-Party Notices

Document kind: License and notice material

Document version: ${releaseVersion}

This archive incorporates nine skills from https://github.com/mattpocock/skills at revision
6654f6b60cd9d5be8b54c6fafe44346dabeb3b76 under the MIT License. The complete upstream license is
included as \`${vendoredLicenseName}\`; \`${vendoredManifestName}\` records every source path,
upstream digest, local digest, and Breakdown adaptation.

Setup guidance also references the external \`skills@1.5.20\` installer as an optional installation
mechanism. That installer is not bundled and remains under its own license.
`;
}

function classify(path) {
  if (path === 'LICENSE') return { media_type: 'text/plain; charset=utf-8', role: 'license' };
  if (path === 'NOTICE') return { media_type: 'text/plain; charset=utf-8', role: 'notice' };
  if (path === 'THIRD_PARTY_NOTICES.md') {
    return { media_type: 'text/markdown; charset=utf-8', role: 'third-party-notices' };
  }
  if (path === 'VERSION') return { media_type: 'text/plain; charset=utf-8', role: 'version' };
  if (path === vendoredLicenseName) {
    return { media_type: 'text/plain; charset=utf-8', role: 'license' };
  }
  if (path === vendoredManifestName) {
    return { media_type: 'application/json', role: 'provenance' };
  }
  if (path.endsWith('/LICENSE')) {
    return { media_type: 'text/plain; charset=utf-8', role: 'license' };
  }
  if (path.endsWith('/NOTICE')) {
    return { media_type: 'text/plain; charset=utf-8', role: 'notice' };
  }
  const extension = extname(path);
  const mediaTypes = {
    '.json': 'application/json',
    '.md': 'text/markdown; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.sh': 'text/x-shellscript; charset=utf-8',
    '.txt': 'text/plain; charset=utf-8',
    '.yaml': 'application/yaml',
  };
  const mediaType = mediaTypes[extension];
  if (mediaType === undefined) {
    throw new Error(`The skills archive has no media type for ${path}.`);
  }
  return {
    media_type: mediaType,
    role: path.endsWith('/SKILL.md')
      ? 'skill'
      : path.includes('/agents/')
        ? 'agent-metadata'
        : path.includes('/assets/')
          ? 'asset'
          : path.includes('/references/')
            ? 'reference'
            : path.includes('/scripts/')
              ? 'script'
              : 'reference',
  };
}

export async function buildSkillsArtifacts({
  outputPath,
  releaseVersion,
  skillsRoot,
  vendoredSkillsRoot,
}) {
  const vendoredManifestBytes = await readFile(join(vendoredSkillsRoot, vendoredManifestName));
  const vendoredManifest = JSON.parse(vendoredManifestBytes.toString('utf8'));
  if (vendoredManifest.schema_version !== 'breakdown.vendored-skills.v1') {
    throw new Error('The vendored skill manifest has an unsupported schema version.');
  }
  const payload = new Map([
    ['LICENSE', await readFile(join(skillsRoot, 'setup-breakdown', 'LICENSE'))],
    ['NOTICE', Buffer.from(skillsNotice(releaseVersion))],
    ['THIRD_PARTY_NOTICES.md', Buffer.from(skillsThirdPartyNotices(releaseVersion))],
    ['VERSION', Buffer.from(`${releaseVersion}\n`)],
    [vendoredLicenseName, await readFile(join(vendoredSkillsRoot, vendoredLicenseName))],
    [vendoredManifestName, vendoredManifestBytes],
  ]);
  for (const skillName of skillNames) {
    const skillRoot = join(skillsRoot, skillName);
    for (const absolutePath of await filesBelow(skillRoot)) {
      const path = `${skillName}/${relative(skillRoot, absolutePath).replaceAll('\\', '/')}`;
      payload.set(path, await readFile(absolutePath));
    }
  }
  for (const skill of vendoredManifest.skills) {
    const skillRoot = join(vendoredSkillsRoot, skill.name);
    for (const absolutePath of await filesBelow(skillRoot)) {
      const path = `${skill.name}/${relative(skillRoot, absolutePath).replaceAll('\\', '/')}`;
      payload.set(path, await readFile(absolutePath));
    }
  }

  const sortedPayload = new Map([...payload].sort(([left], [right]) => left.localeCompare(right)));
  const entries = [...sortedPayload].map(([path, bytes]) => ({
    path,
    ...classify(path),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  }));
  const manifestBytes = Buffer.from(
    `${JSON.stringify(
      {
        schema_version: 'breakdown.skills-archive-manifest.v1',
        release_version: releaseVersion,
        manifest_integrity:
          'Every payload entry is hashed here. The outer release manifest and SHA256SUMS authenticate this manifest.',
        entries,
      },
      null,
      2,
    )}\n`,
  );
  const archiveRoot = `breakdown-skills-${releaseVersion}`;
  const archiveEntries = [
    [`${archiveRoot}/MANIFEST.json`, manifestBytes],
    ...[...sortedPayload].map(([path, bytes]) => [`${archiveRoot}/${path}`, bytes]),
  ];
  const tarName = `${archiveRoot}.tar.gz`;
  const zipName = `${archiveRoot}.zip`;
  await writeFile(join(outputPath, tarName), buildTarGzip(archiveEntries));
  await writeFile(join(outputPath, zipName), buildZip(archiveEntries));
  return { manifestBytes, tarName, zipName };
}

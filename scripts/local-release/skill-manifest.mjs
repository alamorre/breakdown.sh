import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { filesBelow, sha256 } from './filesystem.mjs';

export async function skillManifestBytes({ skillsRoot, releaseVersion }) {
  const manifestPath = join(
    skillsRoot,
    'setup-breakdown',
    'assets',
    'skill-pack-manifest.json',
  );
  const current = JSON.parse(await readFile(manifestPath, 'utf8'));
  const skillNames = [
    'setup-breakdown',
    'author-breakdown',
    'critique-breakdown',
    'run-breakdown',
    'summarize-breakdown-run',
  ];
  const skills = [];
  for (const name of skillNames) {
    const root = join(skillsRoot, name);
    const paths = (await filesBelow(root))
      .map((path) => relative(root, path).replaceAll('\\', '/'))
      .filter(
        (path) => !(name === 'setup-breakdown' && path === 'assets/skill-pack-manifest.json'),
      )
      .sort((left, right) => left.localeCompare(right));
    const files = [];
    for (const path of paths) {
      files.push({
        path,
        sha256: sha256(await readFile(join(root, path))),
      });
    }
    skills.push({ name, files });
  }
  return Buffer.from(
    `${JSON.stringify(
      {
        schema_version: 'breakdown.skill-pack-manifest.v1',
        release_version: releaseVersion,
        manifest_integrity:
          'The release archive authenticates this manifest; its inventory covers every other canonical skill payload byte.',
        skills,
        supported_hosts: current.supported_hosts,
      },
      null,
      2,
    )}\n`,
  );
}

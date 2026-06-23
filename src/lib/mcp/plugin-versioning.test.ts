import { describe, expect, it } from 'vitest';
import path from 'path';
import { pathToFileURL } from 'url';

type BumpLevel = 'major' | 'minor' | 'patch';

type VersionUtils = {
  bumpSemver: (version: string, level: BumpLevel) => string;
  evaluatePluginVersionGuard: (input: {
    changedFiles: string[];
    baseVersion: string;
    currentVersion: string;
  }) => { ok: boolean; message: string; pluginReleaseFiles: string[] };
  isPluginReleaseFile: (filePath: string) => boolean;
};

type VersionScript = {
  readBumpLevel: (argv: string[]) => string | null;
};

const utils = (await import(
  pathToFileURL(path.join(process.cwd(), 'scripts/plugin-version-utils.mjs')).href
)) as VersionUtils;
const versionScript = (await import(
  pathToFileURL(path.join(process.cwd(), 'scripts/plugin-version.mjs')).href
)) as VersionScript;

describe('plugin versioning utilities', () => {
  it('bumps semver versions by requested level', () => {
    expect(utils.bumpSemver('1.2.3', 'patch')).toBe('1.2.4');
    expect(utils.bumpSemver('1.2.3', 'minor')).toBe('1.3.0');
    expect(utils.bumpSemver('1.2.3', 'major')).toBe('2.0.0');
  });

  it('rejects invalid versions', () => {
    expect(() => utils.bumpSemver('1.2', 'patch')).toThrow('Invalid semver version');
    expect(() => utils.bumpSemver('1.2.3-beta.1', 'patch')).toThrow('Invalid semver version');
  });

  it('reads bump level alongside optional flags', () => {
    expect(versionScript.readBumpLevel(['--', 'patch'])).toBe('patch');
    expect(versionScript.readBumpLevel(['--manifest', '/tmp/plugin.json', 'minor'])).toBe(
      'minor',
    );
    expect(versionScript.readBumpLevel(['--level', 'major'])).toBe('major');
  });

  it('identifies plugin release package files', () => {
    expect(utils.isPluginReleaseFile('plugins/breakdown/.codex-plugin/plugin.json')).toBe(true);
    expect(utils.isPluginReleaseFile('./plugins/breakdown/skills/evaluate-graph/SKILL.md')).toBe(
      true,
    );
    expect(utils.isPluginReleaseFile('.agents/plugins/marketplace.json')).toBe(true);
    expect(utils.isPluginReleaseFile('docs/codex-plugin.md')).toBe(false);
    expect(utils.isPluginReleaseFile('src/app/page.tsx')).toBe(false);
  });

  it('allows non-plugin changes without a candidate version bump', () => {
    const result = utils.evaluatePluginVersionGuard({
      changedFiles: ['src/app/page.tsx', 'docs/codex-plugin.md'],
      baseVersion: '1.0.0',
      currentVersion: '1.0.0',
    });

    expect(result.ok).toBe(true);
    expect(result.pluginReleaseFiles).toEqual([]);
  });

  it('requires plugin release changes to increase the candidate version', () => {
    expect(
      utils.evaluatePluginVersionGuard({
        changedFiles: ['plugins/breakdown/README.md'],
        baseVersion: '1.0.0',
        currentVersion: '1.0.0',
      }).ok,
    ).toBe(false);

    expect(
      utils.evaluatePluginVersionGuard({
        changedFiles: ['plugins/breakdown/README.md'],
        baseVersion: '1.0.0',
        currentVersion: '0.9.9',
      }).ok,
    ).toBe(false);

    expect(
      utils.evaluatePluginVersionGuard({
        changedFiles: ['plugins/breakdown/README.md'],
        baseVersion: '1.0.0',
        currentVersion: '1.0.1',
      }).ok,
    ).toBe(true);
  });
});

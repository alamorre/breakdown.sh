export const PLUGIN_MANIFEST_PATH = 'plugins/breakdown/.codex-plugin/plugin.json';

export const PLUGIN_RELEASE_FILE_PATHS = ['.agents/plugins/marketplace.json'];

export const PLUGIN_RELEASE_FILE_PREFIXES = ['plugins/breakdown/'];

export const BUMP_LEVELS = ['major', 'minor', 'patch'];

export function normalizeRepoPath(filePath) {
  return filePath.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function parseSemver(version) {
  if (typeof version !== 'string') {
    return null;
  }

  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

export function formatSemver(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

export function bumpSemver(version, level) {
  const parsed = parseSemver(version);
  if (!parsed) {
    throw new Error(`Invalid semver version: ${version}`);
  }

  if (!BUMP_LEVELS.includes(level)) {
    throw new Error(`Invalid bump level: ${level}. Use ${BUMP_LEVELS.join(', ')}.`);
  }

  if (level === 'major') {
    return formatSemver({ major: parsed.major + 1, minor: 0, patch: 0 });
  }

  if (level === 'minor') {
    return formatSemver({ major: parsed.major, minor: parsed.minor + 1, patch: 0 });
  }

  return formatSemver({ ...parsed, patch: parsed.patch + 1 });
}

export function compareSemver(leftVersion, rightVersion) {
  const left = parseSemver(leftVersion);
  const right = parseSemver(rightVersion);
  if (!left || !right) {
    throw new Error(`Cannot compare invalid semver values: ${leftVersion}, ${rightVersion}`);
  }

  for (const part of ['major', 'minor', 'patch']) {
    if (left[part] > right[part]) return 1;
    if (left[part] < right[part]) return -1;
  }

  return 0;
}

export function isPluginReleaseFile(filePath) {
  const normalized = normalizeRepoPath(filePath);

  return (
    PLUGIN_RELEASE_FILE_PATHS.includes(normalized) ||
    PLUGIN_RELEASE_FILE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

export function getPluginReleaseFileChanges(changedFiles) {
  return changedFiles.map(normalizeRepoPath).filter(isPluginReleaseFile);
}

export function evaluatePluginVersionGuard({ changedFiles, baseVersion, currentVersion }) {
  if (!parseSemver(currentVersion)) {
    return {
      ok: false,
      pluginReleaseFiles: [],
      message: `Current plugin version must be valid x.y.z semver. Received: ${currentVersion}`,
    };
  }

  const pluginReleaseFiles = getPluginReleaseFileChanges(changedFiles);
  if (pluginReleaseFiles.length === 0) {
    return {
      ok: true,
      pluginReleaseFiles,
      message: `No plugin release files changed. Current plugin version ${currentVersion} is valid.`,
    };
  }

  if (!parseSemver(baseVersion)) {
    return {
      ok: false,
      pluginReleaseFiles,
      message: `Base plugin version must be valid x.y.z semver. Received: ${baseVersion}`,
    };
  }

  const comparison = compareSemver(currentVersion, baseVersion);
  if (comparison <= 0) {
    return {
      ok: false,
      pluginReleaseFiles,
      message: `Plugin release files changed, so plugin version must increase from ${baseVersion}. Current version is ${currentVersion}.`,
    };
  }

  return {
    ok: true,
    pluginReleaseFiles,
    message: `Plugin release files changed and plugin version increased from ${baseVersion} to ${currentVersion}.`,
  };
}

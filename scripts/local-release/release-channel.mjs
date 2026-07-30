export function releaseChannel(releaseVersion) {
  const prerelease = releaseVersion.includes('-');
  return {
    stability: prerelease ? 'prerelease' : 'stable',
    npm_dist_tag: prerelease ? 'next' : 'latest',
    github_prerelease: prerelease,
    immutable_tag: `breakdown-local-v${releaseVersion}`,
  };
}

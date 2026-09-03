# Publishing the npm packages

The repository has one npm release path: manually run **Publish npm packages** from `main` in
GitHub Actions. The workflow builds, packs, and publishes these packages in dependency order:

1. `@breakdown-sh/core`
2. `@breakdown-sh/cli`
3. `@breakdown-sh/mcp`

The packages use npm trusted publishing. The npm settings for all three packages must name:

- repository `alamorre/breakdown.sh`;
- workflow `local-stable-publication.yml`; and
- environment `breakdown-local-stable`.

No npm token or trust-inspection artifact is required by the workflow.

## Release a version

1. Update the version in all three package manifests. Keep the internal `@breakdown-sh/core`
   dependency versions in the CLI and MCP manifests aligned with that version.
2. Merge the version change to `main` and let the normal PR checks pass.
3. Open **Actions → Publish npm packages → Run workflow**, select `main`, and run it.

The action installs dependencies, builds the three packages, creates ordinary npm tarballs, and
runs `npm publish` for each package with the `latest` tag. It does not run a release controller,
inspect npm's trusted-publisher configuration, download prior artifacts, require ceremony receipts,
or create a GitHub Release.

The workflow deliberately keeps the filename and environment already registered with npm. If npm
reports an OIDC authentication error, check those two strings in each package's npm settings; do
not add an inspection workflow in front of publishing.

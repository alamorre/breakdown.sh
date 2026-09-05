# Develop Breakdown Local

Install Node 24 and the pnpm version pinned by `package.json`, then run:

```sh
corepack enable
pnpm install
pnpm check
```

Linux glibc and macOS on x64/arm64 are maintained. Use a local disk with private permissions and
atomic rename support. Windows and remote/synchronized filesystems are unsupported for Run storage.
There are no hosted credentials, environment files, Next.js build, or web server in this path.

| Command | Purpose |
| --- | --- |
| `pnpm build` | Build core, CLI, and MCP in dependency order |
| `pnpm test` | Build and run Local suites once with coverage |
| `pnpm test:watch` | Build, then watch the Local tests |
| `pnpm lint` | ESLint for Local code and tooling |
| `pnpm typecheck` | Check Local packages and repository test/tool types |
| `pnpm check` | Reproduce PR CI, including the dependency audit |
| `pnpm local:docs:generate` | Regenerate current reference/manifest output |
| `pnpm local:docs:check` | Check generated output without writing |

The documentation artifact suite already checks generated output during `pnpm test`; CI does not
run it a second time. CLI tests collect subprocess V8 coverage and exercise installed tarballs.
The release packaging test uses a temporary checkout of **HEAD**, installs offline, and checks an
installed candidate. Commit your changes locally before relying on that test as final packaging
validation. It creates local artifacts only. Independent fixtures, filesystem races, hostile-input,
resume/staleness, and protocol-byte checks remain part of the test suite.

For focused iteration, use `pnpm build` followed by `pnpm exec vitest run PATH/TO/TEST`.
Package-local `pnpm --filter @breakdown-sh/cli test` (and core/MCP equivalents) remain available.
Rebuild after runtime changes when using watch mode: CLI/MCP tests launch compiled entrypoints.

See [architecture](architecture.md), [contribution/sign-off guidance](../CONTRIBUTING.md), and
[the simple npm publication path](npm-publishing.md). Optional qualification tools are documented
under [scripts/local-release](../scripts/local-release/README.md); they are not publication gates.
Hosted operator instructions are available through [the archive](adr/0005-archive-hosted-product.md).

# Breakdown Local

Breakdown turns a workflow in `breakdown.yaml` into file-backed Runs that a coding agent can
inspect, execute, and resume. The deterministic core manages validation and durable state; your
Agent Host performs the work under your authority. Use the CLI or optional local stdio MCP adapter
with the five portable [Agent Skills](local/skills/).

Local requires Node 24 and a reliable local filesystem on Linux or macOS. It needs no account,
database, hosted credentials, or Git repository in your project. Your chosen agent/provider may
use a network; Local storage does not imply offline inference.

## Start using Local

Follow [getting started](docs/getting-started.md) for installation and a disposable example.
The [contract index](local/contracts/README.md) defines public behavior and file formats.

## Contribute

Use Node 24 and pnpm 11.3.0 (pinned in `package.json`):

```sh
corepack enable
pnpm install
pnpm check
```

`pnpm check` runs the same Local checks as PR CI: lint, typechecking, package builds, tests with
coverage (including packaging and security), generated-document checks, and the high-severity
dependency audit. Installation and the audit need registry access; neither requires credentials.
There is no web server or `.env` setup. `pnpm build` builds core, CLI, and MCP; `pnpm test` builds
and tests Local with coverage. See [contributing](CONTRIBUTING.md),
[development commands](docs/local-development.md), and [architecture](docs/architecture.md).

## Documentation and history

[Documentation index](docs/README.md) · [Roadmap](docs/roadmap.md) ·
[Publish npm packages](docs/npm-publishing.md) · [License scope](local/LICENSE-SCOPE.md)

The hosted application, remote plugin, migrations, and operator instructions are archived at
[`a784e61955b1635827c8a22acaea4377a1207e07`](https://github.com/alamorre/breakdown.sh/tree/a784e61955b1635827c8a22acaea4377a1207e07).
See the [archive decision and recovery command](docs/adr/0005-archive-hosted-product.md).

Dependency updates retain the seven-day release cooldown and reviewed overrides in
`pnpm-workspace.yaml`. Publication remains the single manual Actions path from #269.

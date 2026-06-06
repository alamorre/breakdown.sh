# breakdown.sh

Breakdown is a hosted/headless reasoning workflow service for coding agents. Agents running in any
project can connect to hosted Breakdown through public discovery metadata, setup sessions, remote
MCP, and headless REST. You do not need to clone this repository for normal service usage.

Use this repository when you are contributing to Breakdown, self-hosting it, or testing Codex plugin
packaging.

## Use Hosted Breakdown From Any Project

Start from your own repo, terminal, or agent console:

1. Discover integration metadata with `GET https://www.breakdown.sh/api` or
   `GET https://www.breakdown.sh/api/integrations/headless-onboarding`.
2. Create an agent setup session with
   `POST https://www.breakdown.sh/api/integrations/agent-setup-sessions`.
3. Have the signed-in human open the returned approval URL and verify the setup code.
4. Exchange the approved setup secret for a scoped `bdk_...` token.
5. Connect MCP at `https://www.breakdown.sh/api/mcp` or use REST under
   `https://www.breakdown.sh/api/headless`.

`401 Missing bearer token` means the request reached Breakdown without an approved token. Create and
approve a setup session or set `BREAKDOWN_API_TOKEN`; it does not mean you should clone this repo.

See the public docs:

- `/docs/getting-started`: hosted integration quickstart
- `/mcp`: MCP, REST, setup sessions, scopes, and troubleshooting
- `/docs/codex-plugin`: public Codex plugin install, token setup, and local override guidance

## Local Development

Use this path only when you are changing Breakdown or running a self-hosted/local copy.

Enable Corepack and install dependencies with the pinned pnpm version:

```bash
corepack enable
pnpm install
```

Runtime configuration is managed in Doppler. Use `.env.local.example` as the variable inventory, but
do not put real secret values in the repo.

For first-time setup:

```bash
brew install gnupg
brew install dopplerhq/cli/doppler
doppler login
doppler setup
pnpm dev:secrets
```

Open [http://localhost:3000](http://localhost:3000) after the dev server starts.

See [docs/local-development.md](docs/local-development.md) and
[docs/secrets-management.md](docs/secrets-management.md) for contributor and operator details.

## Codex Plugin

Codex can install the public Breakdown plugin from this repository's Git marketplace:

```bash
codex plugin marketplace add alamorre/breakdown.sh --ref main --sparse .agents/plugins --sparse plugins/breakdown
codex plugin add breakdown@breakdown
```

Codex and other MCP-capable agents can also connect directly to the hosted MCP endpoint without a
plugin or repository checkout:

```toml
[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"
```

The plugin package lives at `plugins/breakdown` and reads `BREAKDOWN_API_TOKEN` from the Codex
process environment. See [docs/codex-plugin.md](docs/codex-plugin.md) for install, first-run token
setup, validation, and local override guidance.

## Package Security

This project uses pnpm with a seven-day release cooldown. Dependency resolution is configured in
`pnpm-workspace.yaml` with `minimumReleaseAge: 10080`, strict fallback behavior, and no bypass for
registry metadata that is missing publish times.

Run `pnpm run audit:high` before dependency changes. The PR checks include the same high-severity
audit, and patched transitive dependency overrides live in `pnpm-workspace.yaml`.

# breakdown.sh

> **Canonical product (1.0+): [Breakdown Local](docs/roadmap.md)** — directory-native, `breakdown.yaml` + CLI + local MCP + 5 skills, file-local secrets (`.env.local.example` inventory, no Doppler). Hosted SaaS is legacy/out-of-scope for the local corpus; see [`docs/roadmap.md`](docs/roadmap.md) and [`docs/adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md`](docs/adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md). This README's hosted sections remain for self-host/operators and Codex plugin users; for Local, start with `docs/roadmap.md` and `local/README.md` (or `docs/local-development.md`).

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

Runtime configuration is file-local. Use `.env.local.example` as the variable inventory — copy it to `.env.local` and fill in values locally; do not put real secret values in the repo. Validate with `pnpm secrets:check`. No Doppler, no Vercel env sync, and no `doppler setup` are required for ordinary development or for Breakdown Local usage.

For first-time setup:

```bash
cp .env.local.example .env.local
# edit .env.local with your Clerk/Supabase/Google Drive values
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) after the dev server starts.

> **Hosted-legacy note (self-host only):** Operators self-hosting the SaaS app under `src/` may sync env from their own secrets manager (Doppler, Vault, 1Password, Vercel dashboard, or plain env files). That path is explicitly labeled `hosted-legacy / self-host only` and is not required for Breakdown Local. See [`docs/roadmap.md`](docs/roadmap.md), [`docs/adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md`](docs/adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md), and [`docs/secrets-management.md`](docs/secrets-management.md) (Appendix A).

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

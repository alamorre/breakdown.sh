# Local Development

Use this contributor path when you are changing Breakdown, self-hosting it, or testing repo-local
integration scaffolding. Hosted MCP and REST users should start with
[Getting Started](getting-started.md) instead.

> **Canonical direction:** [Roadmap](roadmap.md) — Breakdown Local (#142) is the 1.0+ product (Wayfinder #124). Hosted SaaS is legacy/out-of-scope for the local corpus; see [ADR 0004](adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md). Secrets are file-local only (`.env.local.example` inventory, no Doppler).

## Install

Breakdown uses the pnpm version pinned in `package.json`. Enable Corepack, then install
dependencies from the repo root.

```bash
corepack enable
pnpm install
```

## Configure Environment Variables

Secrets are file-local only. Use `.env.local.example` as the variable inventory. Real values live in untracked local files (`.env.local`) and are never committed. No Doppler, no Vercel env sync, and no `doppler setup` are required for ordinary development or for Breakdown Local usage.

For the standard local workflow:

```bash
cp .env.local.example .env.local
# edit .env.local with your Clerk/Supabase/Google Drive values
pnpm secrets:check
pnpm dev
```

Validate that all required variables are present with:

```sh
pnpm secrets:check
```

> **Hosted-legacy note (self-host only):** Operators who self-host the SaaS app under `src/` may sync env from their own secrets manager (Doppler, Vault, 1Password, Vercel dashboard, or plain env files) and inject via standard env vars. That hosted-legacy path is documented in [Secrets Management — Appendix A](secrets-management.md#appendix-a-hosted-legacy-self-host-only-doppler--vercel-sync) and is not required for Breakdown Local or ordinary development.

## Run The App

Open [http://localhost:3000](http://localhost:3000) after the dev server starts. Use the sign-in
flow to reach the dashboard and graph editor.

## Useful Checks

Before sending changes for review, run the focused checks for the work you touched.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Package Security

Dependency resolution uses pnpm with a seven-day release cooldown. Run the high-severity audit
before dependency changes.

```bash
pnpm run audit:high
```

See [Secrets Management](secrets-management.md) for the fuller file-local model and [Roadmap](roadmap.md) for product direction.

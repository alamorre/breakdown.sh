# Secrets Management

> **Canonical model (Breakdown Local): file-local only.** `.env.local.example` is the variable inventory. Real values live in untracked local files; no Doppler, no Vercel env sync, no GitHub OIDC Doppler fetch is required for Local. Hosted operator sync exists only in [Appendix A — hosted-legacy / self-host only](#appendix-a-hosted-legacy--self-host-only-doppler--vercel-sync). See [Roadmap](roadmap.md) and [ADR 0004](adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md).

This document covers Breakdown Local contributors and self-host operators. It is not required for ordinary hosted MCP/API integration from another project.

Hosted service users and off-repo coding agents should connect through setup sessions,
`https://www.breakdown.sh/api/mcp`, and scoped `bdk_...` Bearer tokens instead.

## Secrets Model — File-Local Only (Canonical)

`.env.local.example` is the complete inventory. Copy it to `.env.local` (untracked), fill in values locally, and validate:

```sh
cp .env.local.example .env.local
# edit .env.local
pnpm secrets:check
pnpm dev
```

Real values are never committed. `.env.local` is git-ignored; there is no canonical `doppler.yaml`, no `doppler setup`, and no `doppler run -- ...` wrapper for Local paths. Canonical npm scripts are `dev`, `build`, `start`, `ci`; the retired `dev:secrets` / `build:secrets` / `start:secrets` / `ci:secrets` wrappers were removed in #205.

`INTEGRATION_TOKEN_ENCRYPTION_KEY` must decode to 32 bytes. Generate a value with:

```sh
openssl rand -base64 32
```

`NEXT_PUBLIC_*` values are public browser configuration, but they still belong in `.env.local` per environment. Next.js inlines these values at build time, so rebuild after changing any `NEXT_PUBLIC_*` value.

AI provider API keys are user-managed in Settings and stored encrypted in Supabase. Do not add shared provider API keys to a shared env file or to a hosted sync.

## Required Variables

Every local `.env.local` must define these variables when exercising the SaaS app:

| Group                          | Variables                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Clerk                          | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`     |
| Supabase                       | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`                                      |
| Supabase migrations            | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`                                                       |
| Stored integration credentials | `INTEGRATION_TOKEN_ENCRYPTION_KEY`                                                                                            |
| Google Drive                   | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY`, `NEXT_PUBLIC_GOOGLE_DRIVE_APP_ID` |

## GitHub Actions Supabase Migrations (Hosted-Legacy)

> **Hosted-legacy / self-host only.** The `Supabase Migrations` workflow (`supabase-migrations.yml`) is a hosted SaaS maintenance workflow (`workflow_dispatch` only, defaults to `dry_run: true`). It is not required for Breakdown Local.

The workflow reads Supabase migration credentials directly from **GitHub Environment secrets** (no Doppler OIDC fetch). Configure the chosen GitHub Environment with secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, and `SUPABASE_PROJECT_REF`, then dispatch with the target environment.

Each dispatch requires the caller to pick the GitHub Environment that holds those secrets. Use matching names such as `development`, `staging`, and `production`. Add required reviewers to the `production` GitHub Environment before using it for non-dry-run migrations.

Use the default dry run first and review the migration output. Set `include_all: true` only when intentionally passing `--include-all` to `supabase db push`.

## Updating Or Rotating A Secret

1. Update the value in the local `.env.local` (and in each deployed environment's env store, if you self-host).
2. Redeploy the environment if the value is consumed at build time or starts a long-lived server process.
3. Run the smoke test for the affected integration.
4. Remove or revoke the old credential in the upstream provider.

## Manual Setup Checklist

- [ ] Copy `.env.local.example` to `.env.local` and fill in values.
- [ ] Run `pnpm secrets:check` and `pnpm dev` locally.
- [ ] Configure deployed environments (if self-hosting) via your hosting env store — not Doppler sync.
- [ ] Redeploy after changing any `NEXT_PUBLIC_*` value.

---

## Appendix A — Hosted-Legacy / Self-Host Only: Doppler & Vercel Sync

> **This appendix is hosted-legacy / self-host only. It is not the canonical Local model and is not required for Breakdown Local.**

Operators who previously used Doppler as source of truth may continue to do so for the hosted SaaS app by syncing Doppler configs to Vercel (`dev` → local, `stg` → Preview, `prd` → Production) via Doppler's Vercel integration. The retired canonical file was `doppler.yaml` (`project: breakdown-sh`, `config: dev`) and the retired scripts were `dev:secrets` / `build:secrets` / `start:secrets` / `ci:secrets` (`doppler run -- ...`). The retired workflow step was `dopplerhq/secrets-fetch-action@v2.0.0` with `DOPPLER_SERVICE_IDENTITY_ID` OIDC. These remain documented here only for self-host operators who retain a Doppler workspace; new Local work should not introduce Doppler.

If you retain Doppler for hosted self-hosting, the prior workflow was:

```sh
brew install gnupg
brew install dopplerhq/cli/doppler
doppler login
doppler setup  # previously preselected breakdown-sh / dev via doppler.yaml
pnpm dev:secrets  # now replaced by pnpm dev (file-local)
```

Do not make follow-up edits directly in the Vercel environment variable UI unless recovering from an incident, and redeploy after changing any `NEXT_PUBLIC_*` value.

`grep -r doppler` intentionally hits this appendix, `docs/adr/0004-*`, and `docs/roadmap.md` — all labeled hosted-legacy — rather than accidental residue.

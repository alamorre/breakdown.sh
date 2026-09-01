# Breakdown Roadmap — Single Source of Truth

> **Canonical product:** **Breakdown Local** (`#142`) — directory-native, one `breakdown.yaml`, immutable Runs/StepArtifacts, filesystem-first CLI + 6-tool local stdio MCP + 5 portable Agent Skills. No accounts, DB, or hosted service required. See `docs/adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md`.

Hosted SaaS (`specs.md` era: Clerk/Supabase/Vercel) is **legacy / out of scope** for the Local corpus. The SaaS code remains in the repo for maintainers/self-hosters but does not define product direction. Any future hosted revival requires a new ADR.

## Where to look

| Question | Answer |
|---|---|
| What is Breakdown's current direction? | This file (`docs/roadmap.md`). |
| Why is Local canonical and SaaS legacy? | `docs/adr/0004-*.md` (cites #124, #142, #129, #187). |
| How are secrets managed? | File-local only — `.env.local.example` is the inventory; no Doppler, no Vercel env sync, no GitHub OIDC Doppler fetch for Local. See `docs/secrets-management.md`. |
| I found `doppler` in grep — is it still needed? | No, except intentional documentation. `doppler.yaml` and `package.json` `*:secrets` scripts were removed in #205. Remaining `doppler` mentions are in this roadmap, ADR 0004, and a hosted-legacy appendix in `docs/secrets-management.md` / workflow comment — all labeled `hosted-legacy / self-host only`. |
| Original product spec? | `specs.md` (historical hosted spec). For current roadmap, this file takes precedence. Top-of-file pointer in `specs.md:9` links here. |

## Product models

### Breakdown Local (canonical — 1.0+)

Defined by Wayfinder #124 and build #142 (+ #143-#166). Projects are ordinary directories with one `breakdown.yaml` (strict flat `breakdown.workflow.v1`). The deterministic core validates the definition, hashes declared file Inputs, creates immutable `outputs/<run-id>/` history (`run.md` + snapshot + `steps/`), and derives scheduling/completion. Execution is via the `breakdown` CLI or the optional local stdio MCP adapter (6 tools); agents use the 5 portable skills. All state lives on the local filesystem under an explicit project root; Git is external and optional. Security boundary (#129): project content is untrusted data, core does not execute project code or shell strings, Breakdown-owned files are private (`0700`/`0600`), and no telemetry/credential discovery/publication side effect is added.

Closer analogy: a `mattpocock/skills`-style skills directory — a portable, host-neutral local toolkit — not a hosted workflow service.

### Hosted SaaS (legacy / out of scope for Local)

The hosted Next.js + Clerk + Supabase + Vercel application (`src/`, `supabase/`, `docs/secrets-management.md` hosted appendix, `.github/workflows/supabase-migrations.yml`) is **retained for maintainers and self-hosters only**, not as the canonical product. It is excluded from Local qualification and does not impose Doppler, Vercel, or Supabase on Local users. Self-host operators may use any secrets manager (Doppler, Vault, 1Password, Vercel dashboard, or plain env files) via standard GitHub Environment secrets/env vars; that choice is documented only in the hosted-legacy appendix.

## Secrets model

**Local (canonical):** file-local only. `.env.local.example` is the inventory; copy to `.env.local` and fill in values locally. Validate with `pnpm secrets:check`. No `doppler login`, no `doppler setup`, no `doppler run -- ...`, no Vercel env sync, no GitHub OIDC Doppler fetch. The core never syncs secrets to a hosting provider.

**Hosted-legacy (self-host only):** if you self-host the SaaS app, manage env in your chosen secrets manager and inject via standard `NEXT_PUBLIC_*` / `SUPABASE_*` / `INTEGRATION_TOKEN_ENCRYPTION_KEY` env vars. The Supabase migration workflow reads those secrets from the GitHub Environment (not Doppler OIDC). See `docs/secrets-management.md` Appendix A for the hosted operator path (labeled `hosted-legacy`).

## Retirement scope (#205)

| Area | Before | After |
|---|---|---|
| Secrets source of truth | Doppler project `breakdown-sh` (`doppler.yaml` + `doppler login/setup/run`) | File-local `.env.local.example` inventory; no Doppler. |
| `package.json` scripts | `dev:secrets`, `build:secrets`, `start:secrets`, `ci:secrets` (all `doppler run -- ...`) | Removed; canonical scripts are `dev`, `build`, `start`, `ci` + `secrets:check`. |
| `README.md` / `docs/local-development.md` setup | Doppler install + `doppler setup` + `pnpm dev:secrets` | `cp .env.local.example .env.local` + `pnpm dev` (file-local). |
| `docs/secrets-management.md` | Doppler-as-source-of-truth + Doppler→Vercel sync tables | File-local model; hosted operator sync only in explicit Appendix A (`hosted-legacy`). |
| `src/app/docs/**` | Rendered Doppler guidance | Updated to match file-local model. |
| `.github/workflows/supabase-migrations.yml` | `dopplerhq/secrets-fetch-action` OIDC + `doppler_project`/`doppler_config`/`DOPPLER_SERVICE_IDENTITY_ID` | Reads `SUPABASE_ACCESS_TOKEN`/`SUPABASE_DB_PASSWORD`/`SUPABASE_PROJECT_REF` directly from GitHub Environment secrets; no `id-token: write` needed; comment labels remaining note as hosted-legacy. |
| `scripts/check-env.mjs` hint | `Load secrets with Doppler, for example: pnpm dev:secrets` | `Copy .env.local.example to .env.local and fill in missing values` |

Remaining `doppler` string matches are intentional documentation — ADR 0004, this roadmap, and the hosted-legacy appendix — not accidental residue.

## Milestones

| Milestone | Scope | Status |
|---|---|---|
| **Wayfinder #124** | 15 decisions (#125-#141) defining Local's workflow, run, security, CLI/MCP, skills, distribution | **Done** |
| **Local MVP #142** | Core + CLI + MCP + 5 skills + contracts + conformance (#143-#166) | **Done** (under release qualification) |
| **Release deferral #187** | Supported Host certification deferred (`supported_hosts: []`) | **Accepted** — ADR 0002 |
| **1.0 stable publication (#167/#190)** | Immutable archives + attested `latest`/`next` channels | **Pending** — blocked until qualification passes post-#205 |
| **Supported Host qualification #188** | Real Agent Host rows beyond deferred empty set | **Deferred** — requires new ADR/workflow per ADR 0002 |
| **SaaS/hosted revival (if any)** | New ADR defining coexistence, plus Doppler/hosted docs if needed | **Out of scope** unless proposed |

## Non-goals (still out of scope per #124)

Hosted/SaaS parity, accounts, authentication, Supabase/DB persistence, remote coordination/leases, multi-user execution, canvas/UI changes, Git-managed publication, GitMCP project reads — all remain out of scope for Breakdown Local.

## References

- ADR 0004 — `docs/adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md`
- Wayfinder #124, Local MVP #142, Security boundary #129, Release deferral #187
- `specs.md` (historical hosted spec) — top-of-file pointer now links here
- `docs/secrets-management.md` (file-local) + Appendix A (hosted-legacy)
- `docs/README.md` visibility table (this roadmap listed as `public`)

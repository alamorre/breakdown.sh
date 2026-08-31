# Declare Breakdown Local as canonical 1.0+ product and retire Doppler/hosted assumptions

Status: Accepted for issue #205

## Context

The repository has drifted between two product models:

- **Hosted SaaS** — `specs.md`, `implementation_plan.md`, `README.md`, `docs/secrets-management.md`, Clerk + Supabase + Vercel, Doppler as source of truth via `doppler.yaml` + `dev:secrets`/`build:secrets`/`ci:secrets` + `.github/workflows/supabase-migrations.yml` `dopplerhq/secrets-fetch-action` (OIDC).
- **Breakdown Local** — Wayfinder map #124 + 14 decisions #125-#141 + implementation #142-#166: directory-native, one `breakdown.yaml`, immutable Runs/StepArtifacts, filesystem-first CLI + 6-tool local stdio MCP + 5 portable Agent Skills, no account/DB/hosted service.

Wayfinder #124 explicitly scopes SaaS out ("Hosted/SaaS parity, accounts, authentication, Supabase/database persistence, remote coordination ... out of scope"), but no roadmap doc or ADR reconciled the two. The SaaS code, Doppler wiring, and SaaS-centric docs remained, so new contributors reasonably assumed Doppler/Vercel/Supabase are still required. Issue reporter noted the intended direction is closer to a `mattpocock/skills`-style skills directory — that intent existed nowhere in `docs/`, `docs/adr/`, or `specs.md:9`.

Without a single source of truth, alignment will drift: hosted infra gets re-added, secrets get added to Doppler instead of staying file-local, and Local's "no telemetry / no credential discovery / project content untrusted" boundary (#129) erodes.

Related: #124 (Wayfinder map), #142 (Local MVP), #129 (security/privacy boundary), #187 / #188 (release deferral and Supported Host), #205 (this decision).

## Decision

### 1. Product canonical

**Breakdown Local (#142) is the canonical 1.0+ product.** The directory-native contract — one `breakdown.yaml`, file-backed Workflow Inputs, append-only Runs/StepArtifacts, deterministic resume, shared core + CLI + 6-tool local stdio MCP + 5 portable skills, no accounts/DB/hosted service — is the sole definition of "Breakdown" for the local corpus, documentation, and release qualification.

**Hosted SaaS is legacy / out of scope for the Local corpus.** The Next.js + Clerk + Supabase + Vercel application under `src/`, `supabase/`, and associated deployment docs remains in the repository for maintainers and self-hosters, but it is not the canonical product, not required to use or qualify Breakdown Local, and not where new product direction is recorded. Future hosted work, if any, requires a new ADR that explicitly defines coexistence.

This replaces the implicit dual-truth with one pointer: `docs/roadmap.md`.

### 2. Secrets model

For Breakdown Local, **secrets are file-local only**:

- `.env.local.example` is the complete variable inventory. Real values live in untracked local files (`.env.local`, `~/.config/breakdown/...`, or operator-chosen local file) and are never committed.
- No Doppler, no Vercel env sync, no GitHub OIDC Doppler fetch is required or expected on any Local path.
- `pnpm dev`, `pnpm build`, `pnpm test`, and `pnpm secrets:check` read from the local environment; there are no canonical `*:secrets` wrappers.
- The Local core itself adds no telemetry, network upload, credential discovery, or publication side effect (#129). Credentials never enter Workflow Definitions, Work Packets, Results, or diagnostics.

For the hosted legacy slice, operators who self-host the SaaS app may still sync env via their own secrets manager (Doppler, 1Password, Vault, Vercel dashboard, or plain `.env` files). That choice is operator-local and explicitly labeled **hosted-legacy / self-host only** wherever it appears. It does not define the Local secrets model.

### 3. Retirement scope

The following residue of the old model is retired from the canonical Local path and, where retained, isolated behind an explicit hosted-legacy label:

| Artifact | Action | Reason |
|---|---|---|
| `doppler.yaml` | **Removed** | Doppler project/config binding for the canonical repo; no Local path needs `doppler setup`. |
| `package.json` `dev:secrets` / `build:secrets` / `start:secrets` / `ci:secrets` | **Removed** | Doppler-wrapped scripts; canonical scripts are `dev`, `build`, `start`, `ci`. |
| `README.md` Doppler setup block | **Replaced** with file-local env setup + pointer to `docs/roadmap.md` and `docs/secrets-management.md` | Agents must not infer `doppler setup` for ordinary Local usage. |
| `docs/local-development.md` Doppler section | **Replaced** with file-local setup | Same rationale. |
| `docs/secrets-management.md` Doppler-as-source-of-truth narrative + Doppler→Vercel sync table | **Rewritten** file-local inventory model; hosted operator sync retained only in an explicit appendix labeled hosted-legacy | Local's "no Doppler/Vercel sync" boundary. |
| `src/app/docs/local-development/page.tsx` and `src/app/docs/deployment/page.tsx` Doppler references | **Replaced** to match the file-local model | Avoid stale hosted docs being rendered as canonical. |
| `scripts/check-env.mjs` hint `Load secrets with Doppler ...` | **Reworded** to file-local guidance (`cp .env.local.example .env.local`) | Keep validation but point at the correct model. |
| `.github/workflows/supabase-migrations.yml` `dopplerhq/secrets-fetch-action` + `doppler_project`/`doppler_config` inputs + `DOPPLER_SERVICE_IDENTITY_ID` / OIDC `id-token: write` | **Removed**; workflow now reads migration secrets directly from GitHub Environment secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`) | No OIDC fetch for Local; hosted migration remains usable via standard GitHub secrets without a Doppler dependency. Labeled in-workflow as hosted-legacy. |
| `specs.md:9` and `docs/README.md` | **Updated** to point at `docs/roadmap.md` and this ADR | Single source of truth for direction. |

Any future re-introduction of Doppler, Vercel env sync, or OIDC secret fetch for a Local path requires a new ADR.

### 4. Coexistence rule

If hosted and Local must coexist, hosted lives under an explicit `hosted/` or `legacy/` flag and never redefines the Local contract, file layout, or secrets boundary. The hosted slice is then documented as **self-host only** and excluded from Local qualification (`local-platform-qualification`, `local-release-*` workflows).

## Consequences

- `docs/roadmap.md` becomes the single source of truth for product direction; `specs.md:9` and `docs/README.md` point at it.
- `grep -r doppler` returns only intentional documentation (this ADR, `docs/roadmap.md`, and the hosted-legacy appendix in `docs/secrets-management.md` / workflow comment). Accidental residue is gone.
- Contributors and agents do not need `doppler login`/`doppler setup` for ordinary Local usage. Self-host operators still have a documented path that does not leak into Local docs.
- Breakdown Local's "file-local, no sync, project content untrusted" boundary (#129) is preserved; publishing remains opt-in and local.
- Tag `1.0` qualification (#187 deferred host policy) is unaffected. A future Supported Host or hosted revival requires issues #188 / new ADR.

## Alternatives considered

- **Keep Doppler as canonical and label Local as variant** — rejected; contradicts #124's scoped-out SaaS and would re-anchor secrets to an external service for every Local project.
- **Keep dual truth with per-doc disclaimers** — rejected; silent dual truth is what caused #205.
- **Move hosted code to a separate repository** — deferred; retained in-repo but explicitly out-of-scope canonical, avoiding an immediate history rewrite.

## References

- #124 Chart the local Breakdown MVP to an implementation-ready specification
- #142 Build Breakdown Local MVP (with #143-#166)
- #129 Define the local security and privacy boundary
- #187 / #188 Release deferral and Supported Host
- `docs/roadmap.md` — single source of truth linked from `README.md` and `docs/README.md`

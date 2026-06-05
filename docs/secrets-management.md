# Secrets Management

This operator document is for people self-hosting Breakdown, running the hosted app, or
contributing to the repo. It is not required for ordinary hosted MCP/API integration from another
project.

Hosted service users and off-repo coding agents should connect through setup sessions,
`https://www.breakdown.sh/api/mcp`, and scoped `bdk_...` bearer tokens instead.

This project uses Doppler as the source of truth for environment variables and secrets. Keep
`.env.local.example` in the repo as the variable inventory only; real values belong in Doppler.

## Doppler Structure

Create a Doppler project named `breakdown-sh` and use the default root configs:

| App environment   | Doppler config | Consumer                               |
| ----------------- | -------------- | -------------------------------------- |
| Local development | `dev`          | `pnpm dev:secrets` via the Doppler CLI |
| Staging           | `stg`          | Vercel Preview environment sync        |
| Production        | `prd`          | Vercel Production environment sync     |

Doppler creates `dev`, `stg`, and `prd` by default for new projects. Use branch
configs only for short-lived overrides; promote stable changes back to the root
config.

## Required Variables

Every config must define these variables:

| Group                          | Variables                                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Clerk                          | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`     |
| Supabase                       | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`                                      |
| Supabase migrations            | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`                                                       |
| Stored integration credentials | `INTEGRATION_TOKEN_ENCRYPTION_KEY`                                                                                            |
| Google Drive                   | `GOOGLE_DRIVE_CLIENT_ID`, `GOOGLE_DRIVE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY`, `NEXT_PUBLIC_GOOGLE_DRIVE_APP_ID` |

`INTEGRATION_TOKEN_ENCRYPTION_KEY` must decode to 32 bytes. Generate a value
with:

```sh
openssl rand -base64 32
```

`NEXT_PUBLIC_*` values are public browser configuration, but they still belong
in Doppler so each environment has one source of truth. Next.js inlines these
values at build time, so staging and production must receive them before
`next build` runs.

AI provider API keys are user-managed in Settings and stored encrypted in
Supabase. Do not add shared provider API keys to Doppler or Vercel.

## Local Development

Install and authenticate the Doppler CLI once:

```sh
brew install gnupg
brew install dopplerhq/cli/doppler
doppler login
```

From the repository root, bind this directory to the `breakdown-sh` project and
`dev` config:

```sh
doppler setup
```

The checked-in `doppler.yaml` preselects `project: breakdown-sh` and
`config: dev`. After setup, run the app with:

```sh
pnpm dev:secrets
```

Validate that all required variables are present with:

```sh
doppler run -- pnpm secrets:check
```

## Staging And Production

Connect Doppler to Vercel with one sync per environment:

| Vercel environment | Doppler config |
| ------------------ | -------------- |
| Preview            | `stg`          |
| Production         | `prd`          |

Use Vercel's Sensitive environment variable type for synced values. After each
sync is configured, Doppler should be the place where values are added, edited,
removed, or rotated. Do not make follow-up edits directly in the Vercel
environment variable UI unless you are recovering from an incident.

After changing any `NEXT_PUBLIC_*` value, redeploy the affected Vercel
environment so the browser bundle is rebuilt with the new value.

## GitHub Actions Supabase Migrations

Repo admins can manually run the `Supabase Migrations` workflow from GitHub
Actions when local Supabase CLI access is unavailable. The workflow is
`workflow_dispatch` only, defaults to `dry_run: true`, and applies migrations
only when `dry_run` is explicitly set to `false`.

The workflow fetches Supabase migration credentials from Doppler at runtime.
Choose the GitHub Environment and Doppler config in the workflow inputs. Use
matching names such as `development` + `dev`, `staging` + `stg`, and
`production` + `prd`.

Each Doppler config that should support migrations must define:

| Doppler secret          | Purpose                                            |
| ----------------------- | -------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | Supabase personal access token for CLI management. |
| `SUPABASE_DB_PASSWORD`  | Remote Postgres password used by `supabase link`.  |
| `SUPABASE_PROJECT_REF`  | Deterministic target project reference for CI.     |

Each GitHub Environment that can run migrations needs one non-secret variable:

| Environment variable          | Purpose                                                                 |
| ----------------------------- | ----------------------------------------------------------------------- |
| `DOPPLER_SERVICE_IDENTITY_ID` | Doppler service account identity id authorized for GitHub Actions OIDC. |

Configure a Doppler service account identity for this repository and allow the
workflow to fetch the target Doppler project/config through GitHub OIDC. The
workflow grants `id-token: write` for this exchange, then uses Doppler's
official secrets fetch action to inject the migration secrets into the job.
Add required reviewers to the `production` GitHub Environment before using it
for non-dry-run migrations.

Use the default dry run first and review the migration output. Set
`include_all: true` only when intentionally passing `--include-all` to
`supabase db push`.

## Updating Or Rotating A Secret

1. Update the value in the relevant Doppler config.
2. Confirm Doppler syncs the change to Vercel for `stg` and `prd`, when
   applicable.
3. Redeploy the environment if the value is consumed at build time or starts a
   long-lived server process.
4. Run the smoke test for the affected integration.
5. Remove or revoke the old credential in the upstream provider.

## Manual Setup Checklist

- [ ] Create or sign in to the Doppler workspace.
- [ ] Create the `breakdown-sh` project.
- [ ] Import local development values into `dev`.
- [ ] Import staging values into `stg`.
- [ ] Import production values into `prd`.
- [ ] Run `doppler setup` locally from this repo and verify `pnpm dev:secrets`.
- [ ] Configure the Doppler Vercel sync for Preview from `stg`.
- [ ] Configure the Doppler Vercel sync for Production from `prd`.
- [ ] Remove any duplicate manually managed Vercel variables after sync is
      verified.
- [ ] Redeploy Preview and Production.

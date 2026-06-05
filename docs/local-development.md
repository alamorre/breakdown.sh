# Local Development

Use this contributor path when you are changing Breakdown, self-hosting it, or testing repo-local
integration scaffolding. Hosted MCP and REST users should start with
[Getting Started](getting-started.md) instead.

## Install

Breakdown uses the pnpm version pinned in `package.json`. Enable Corepack, then install
dependencies from the repo root.

```bash
corepack enable
pnpm install
```

## Configure Environment Variables

Use `.env.local.example` as the variable inventory. Real values should live in Doppler or another
secrets manager rather than being committed to the repo.

For the standard local workflow, install Doppler, authenticate, bind the repo to the development
config, and run the app through Doppler.

```bash
brew install gnupg
brew install dopplerhq/cli/doppler
doppler login
doppler setup
pnpm dev:secrets
```

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

See [Secrets Management](secrets-management.md) for the fuller self-hosting and production setup
model.

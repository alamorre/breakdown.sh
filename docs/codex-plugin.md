# Codex Plugin

Breakdown now includes a repo-local Codex plugin scaffold at `plugins/breakdown`. The plugin is intended to make Breakdown graphs available inside Codex with less manual setup while preserving the same scoped-token safety model used by the public MCP endpoint.

## What Exists

- `plugins/breakdown/.codex-plugin/plugin.json` declares the plugin metadata.
- `plugins/breakdown/.mcp.json` connects to the hosted Streamable HTTP MCP endpoint at `https://www.breakdown.sh/api/mcp`.
- `plugins/breakdown/skills/` bundles Breakdown-specific workflows for graph evaluation, node-type changes, and Supabase migrations.
- `.agents/plugins/marketplace.json` exposes the repo-local plugin entry for Codex plugin discovery.

## Authentication

The plugin expects a Breakdown integration token in the `BREAKDOWN_API_TOKEN` environment variable. Users create tokens from Settings under MCP Access. Tokens use the `bdk_...` prefix, are shown once, and can be scoped to the minimum graph and run permissions needed by the client.

## Current Setup

1. Sign in to Breakdown and create an MCP Access token.
2. Export the token before starting Codex:

   ```bash
   export BREAKDOWN_API_TOKEN=bdk_...
   ```

3. Install or view the repo-local plugin from `.agents/plugins/marketplace.json`.
4. Ask Codex to list Breakdown graphs or use one of the bundled graph prompts.

For local app development, either use the hosted MCP endpoint with a hosted token or point the plugin MCP URL at `http://localhost:3000/api/mcp` while `pnpm dev` is running.

## Remaining Product Work

The scaffold is useful for local and repo-based development, but a polished public plugin still needs:

- installation and update docs for Codex users outside this checkout
- final marketplace naming, icon, screenshots, and release metadata
- an onboarding path that helps users create or paste `BREAKDOWN_API_TOKEN`
- verification of remote MCP behavior in a fresh Codex profile
- a decision on whether hosted OAuth connector registration should replace bearer-token setup later

Track that work in [GitHub issue #74](https://github.com/alamorre/breakdown.sh/issues/74).

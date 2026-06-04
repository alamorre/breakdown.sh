# Codex Plugin

Breakdown now includes a repo-local Codex plugin scaffold at `plugins/breakdown`. The plugin is intended to make Breakdown graphs available inside Codex with less manual setup while preserving the same scoped-token safety model used by the public MCP endpoint.

## What Exists

- `plugins/breakdown/.codex-plugin/plugin.json` declares the plugin metadata.
- `plugins/breakdown/.mcp.json` connects to the hosted Streamable HTTP MCP endpoint at `https://www.breakdown.sh/api/mcp`.
- `plugins/breakdown/skills/` bundles Breakdown-specific workflows for graph evaluation, node-type changes, and Supabase migrations.
- `.agents/plugins/marketplace.json` exposes the `breakdown` marketplace entry for Codex plugin discovery.

## Authentication

The plugin expects a Breakdown integration token in the `BREAKDOWN_API_TOKEN` environment variable. Users create tokens from Settings under MCP Access. Tokens use the `bdk_...` prefix, are shown once, and can be scoped to the minimum graph and run permissions needed by the client.

## Install From A Local Checkout

Use this path when you have the `breakdown.sh` repo on the same machine as Codex:

```bash
cd /path/to/breakdown.sh
codex plugin marketplace add "$(pwd)"
codex plugin add breakdown@breakdown
```

The marketplace command points Codex at this repository. The plugin install command installs the `breakdown` plugin from the `breakdown` marketplace declared in `.agents/plugins/marketplace.json`.

## Install From Git

After the plugin has merged to `main`, a Codex user can install the marketplace directly from Git without cloning the full repo first:

```bash
codex plugin marketplace add alamorre/breakdown.sh --ref main --sparse .agents/plugins --sparse plugins/breakdown
codex plugin add breakdown@breakdown
```

The sparse paths fetch the marketplace manifest and the plugin source directory. Use a branch or tag instead of `main` while testing unreleased changes.

## Connect Codex To Breakdown

1. Sign in to Breakdown.
2. Open Settings and create an MCP Access token.
3. Choose the narrowest scopes the agent needs, such as `graphs:read` for read-only use or graph and run scopes for editing and execution.
4. Copy the raw `bdk_...` token when it is shown.
5. Export the token before starting Codex:

   ```bash
   export BREAKDOWN_API_TOKEN=bdk_...
   ```

6. Start a new Codex thread so the plugin skills and MCP server are loaded.
7. Ask Codex to list Breakdown graphs, read a graph, or turn a goal into a Breakdown DAG.

## MCP Without The Plugin

Coding agents that support MCP but do not use Codex plugins can connect directly to the same endpoint. Use the MCP configuration examples on `/mcp` with:

```text
https://www.breakdown.sh/api/mcp
```

and the same `BREAKDOWN_API_TOKEN` value.

## Local App Development

For local app development, run the app and use a local token:

```bash
pnpm dev
export BREAKDOWN_API_TOKEN=bdk_...
```

Then point the agent at `http://localhost:3000/api/mcp`. For a one-off Codex session, use the direct MCP configuration from `/mcp`; for plugin testing, make an uncommitted local edit to `plugins/breakdown/.mcp.json` and switch the URL back before committing.

## Verify The Connection

After installing the plugin and starting a fresh thread, ask Codex to list available Breakdown tools or list graphs. The MCP tool list should include tools such as `list_graphs`, `get_graph`, `create_external_run`, and `submit_step_result`.

For command-line verification from the repo:

```bash
pnpm headless:verify
pnpm --filter @breakdown/mcp build
```

## Remaining Product Work

The scaffold is useful for local and repo-based development, but a polished public plugin still needs:

- final marketplace naming, icon, screenshots, and release metadata
- verification of remote MCP behavior in a fresh Codex profile
- a decision on whether hosted OAuth connector registration should replace bearer-token setup later
- submission or distribution through any hosted Codex marketplace, if one is desired

Track that work in [GitHub issue #74](https://github.com/alamorre/breakdown.sh/issues/74).

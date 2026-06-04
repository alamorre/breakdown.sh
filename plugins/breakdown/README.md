# Breakdown Codex Plugin

This repo-local Codex plugin connects Codex to breakdown.sh reasoning graphs through:

- `plugins/breakdown/.mcp.json`, which points at the hosted Streamable HTTP MCP endpoint.
- `plugins/breakdown/skills/`, which bundles Breakdown-specific development workflows.
- `.agents/plugins/marketplace.json`, which makes the plugin discoverable from this checkout.

## Environment

Create a scoped token in Breakdown settings and expose it before starting Codex:

```bash
export BREAKDOWN_API_TOKEN=bdk_...
```

The default MCP server URL is:

```text
https://www.breakdown.sh/api/mcp
```

For local development against a running app, use the MCP instructions in `/mcp` or temporarily point
the server URL at `http://localhost:3000/api/mcp`.

## Verification

From the repo root:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/breakdown
pnpm --filter @breakdown/mcp build
pnpm headless:verify
```

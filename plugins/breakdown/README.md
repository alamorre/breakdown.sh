# Breakdown Codex Plugin

This repo-local Codex plugin is for contributors and packaging tests. It is not required for normal
Breakdown service usage.

For agents running in another project, use direct hosted MCP/API instead:

```toml
[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"
```

Create and approve a setup session, exchange it for a scoped `bdk_...` token, and set
`BREAKDOWN_API_TOKEN` before starting Codex. See the public `/mcp` page or
`docs/getting-started.md` for the default hosted flow.

## What This Plugin Contains

- `plugins/breakdown/.mcp.json`, which points at the hosted Streamable HTTP MCP endpoint.
- `plugins/breakdown/skills/`, which bundles Breakdown-specific development workflows.
- `.agents/plugins/marketplace.json`, which makes the plugin discoverable from this checkout.

## Environment

Create an agent setup session and ask the signed-in user to approve the returned URL:

```bash
curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Codex","providerName":"OpenAI"}'
```

After approval, exchange the returned setup secret at the returned exchange URL. Use the exchange
response token before starting Codex:

```bash
export BREAKDOWN_API_TOKEN=bdk_...
```

Manual token creation in Breakdown settings under MCP Access is still supported as a fallback.

## Install In Codex For Plugin Testing

Use these commands only when testing this repo-local plugin scaffold.

From a local checkout:

```bash
cd /path/to/breakdown.sh
codex plugin marketplace add "$(pwd)"
codex plugin add breakdown@breakdown
```

From Git after the plugin has merged:

```bash
codex plugin marketplace add alamorre/breakdown.sh --ref main --sparse .agents/plugins --sparse plugins/breakdown
codex plugin add breakdown@breakdown
```

Start a new Codex thread after installing so the plugin skills and MCP tools are loaded.

## Verification

From the repo root:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/breakdown
pnpm --filter @breakdown/mcp build
pnpm headless:verify
```

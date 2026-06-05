# Breakdown Codex Plugin

This repo-local Codex plugin connects Codex to breakdown.sh reasoning graphs through:

- `plugins/breakdown/.mcp.json`, which points at the hosted Streamable HTTP MCP endpoint.
- `plugins/breakdown/skills/`, which bundles Breakdown-specific development workflows.
- `.agents/plugins/marketplace.json`, which makes the plugin discoverable from this checkout.

## Environment

Create an agent setup session and ask the signed-in user to approve the returned URL:

```bash
curl "$BREAKDOWN_BASE_URL/api/integrations/agent-setup-sessions" \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Codex","providerName":"OpenAI"}'
```

After approval, exchange the returned setup secret at the returned exchange URL. Use the exchange
response token before starting Codex:

```bash
export BREAKDOWN_API_TOKEN=bdk_...
```

Manual token creation in Breakdown settings under MCP Access is still supported as a fallback.

The default MCP server URL is:

```text
https://www.breakdown.sh/api/mcp
```

For local development against a running app, use the MCP instructions in `/mcp` or temporarily point
the server URL at `http://localhost:3000/api/mcp`.

## Install In Codex

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

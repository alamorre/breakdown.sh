# Codex Plugin

Codex can use Breakdown directly through hosted MCP today. The repo-local plugin scaffold is for
contributors and packaging tests, not the default path for agents running in another project.

## Choose The Right Path

| Path             | Use                   | When                                                                                            |
| ---------------- | --------------------- | ----------------------------------------------------------------------------------------------- |
| Default          | Direct hosted MCP/API | Use setup sessions and `https://www.breakdown.sh/api/mcp` from any project. No checkout needed. |
| Optional         | Public Codex plugin   | Use the hosted plugin path after marketplace packaging ships. Track that work in issue #74.     |
| Contributor only | Repo-local plugin     | Use local checkout or sparse Git install only when developing Breakdown or testing packaging.   |

Do not clone or sparse-install the Breakdown repo unless you are working on Breakdown itself,
self-hosting it, or validating plugin packaging.

## Default: Connect Directly To Hosted MCP

1. Create an agent setup session at
   `https://www.breakdown.sh/api/integrations/agent-setup-sessions`.
2. Open the returned approval URL while signed in to Breakdown.
3. Verify the setup code and approve the requested scopes.
4. Exchange the setup secret for a scoped `bdk_...` token.
5. Configure Codex or another MCP-capable client with `https://www.breakdown.sh/api/mcp`.

```toml
[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"
```

Set `BREAKDOWN_API_TOKEN` to the approved token before starting the client. For the full
setup-session flow, see the public `/mcp` page.

## Authentication

Codex can create an agent setup session, ask the signed-in user to approve it in Breakdown, then
exchange the setup secret for a scoped `bdk_...` token. The user does not need to copy the raw token.

```bash
curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Codex","providerName":"OpenAI"}'
```

Open the returned approval URL, verify the setup code, then exchange the returned setup secret at
the returned exchange URL. Manual token creation from Settings under MCP Access remains available as
a fallback.

## Optional: Public Codex Plugin

The public plugin path is not yet shipped. Once it is published, it should wrap the same hosted MCP
endpoint and setup-session flow so agents can connect without cloning this repository.

Track that work in [GitHub issue #74](https://github.com/alamorre/breakdown.sh/issues/74).

## Contributor Only: Repo-Local Plugin

The scaffold in this repository is useful for local development, testing, and the first marketplace
packaging pass. These files are not required for normal Breakdown service usage:

- `plugins/breakdown/.codex-plugin/plugin.json` declares the plugin metadata.
- `plugins/breakdown/.mcp.json` connects to the hosted Streamable HTTP MCP endpoint.
- `plugins/breakdown/skills/` bundles Breakdown-specific workflows.
- `.agents/plugins/marketplace.json` exposes the `breakdown` marketplace entry.

### Install From A Local Checkout

Use this only when the Breakdown repo is already on the same machine because you are changing or
testing Breakdown.

```bash
cd /path/to/breakdown.sh
codex plugin marketplace add "$(pwd)"
codex plugin add breakdown@breakdown
```

### Install From Git For Plugin Testing

Sparse Git install fetches only the marketplace manifest and plugin source directory. It is for
plugin packaging tests, not the default hosted integration path.

```bash
codex plugin marketplace add alamorre/breakdown.sh --ref main --sparse .agents/plugins --sparse plugins/breakdown
codex plugin add breakdown@breakdown
```

### Local App Development

For local app development, run the app and point the client at the local MCP endpoint.

```bash
pnpm dev
export BREAKDOWN_API_TOKEN=bdk_...
```

Then use `http://localhost:3000/api/mcp`. For plugin testing, make an uncommitted local edit to
`plugins/breakdown/.mcp.json` and switch the URL back before committing.

## Verify The Connection

After installing the plugin and starting a fresh thread, ask Codex to list available Breakdown tools
or list graphs. The MCP tool list should include tools such as `list_graphs`, `get_graph`,
`create_external_run`, and `submit_step_result`.

For command-line verification from the repo:

```bash
pnpm headless:verify
pnpm --filter @breakdown/mcp build
```

## Troubleshooting

`401 Missing bearer token` means the client reached Breakdown without an approved token. Create and
approve a setup session or set `BREAKDOWN_API_TOKEN`; do not clone the repository just to inspect
plugin files.

## Remaining Product Work

The scaffold is useful for local and repo-based development, but a polished public plugin still
needs:

- final marketplace naming, icon, screenshots, and release metadata
- verification of remote MCP behavior in a fresh Codex profile
- a decision on whether hosted OAuth connector registration should replace bearer-token setup later
- submission or distribution through any hosted Codex marketplace, if one is desired

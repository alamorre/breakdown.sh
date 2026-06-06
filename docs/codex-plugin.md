# Codex Plugin

The Breakdown Codex plugin is the polished public package for connecting Codex to hosted
Breakdown reasoning graphs. It wraps the same Streamable HTTP MCP endpoint used by direct
clients: `https://www.breakdown.sh/api/mcp`.

The first public release intentionally uses scoped `BREAKDOWN_API_TOKEN` bearer tokens. Hosted
OAuth connector registration can be added later if Codex marketplace distribution requires it, but
tokens keep the Git marketplace, local checkout, and self-hosted paths consistent today.

## Choose The Right Path

| Path                  | Use                         | When                                                                                               |
| --------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| Public Codex plugin   | Git marketplace plugin      | Use from Codex when you want the packaged skills, assets, prompts, MCP tools, and graph resources. |
| Direct hosted MCP/API | Manual MCP or REST config   | Use from any MCP-capable client, automation, or coding agent that does not need the Codex plugin.  |
| Local/self-hosted     | Local MCP endpoint override | Use only when contributing to Breakdown, testing a local app, or running a self-hosted deployment. |

Do not clone the Breakdown repo just to use hosted Breakdown. Install the plugin from Git, or point
your MCP client directly at the hosted endpoint.

## Install The Public Plugin

Install the repo marketplace and plugin from Git. The sparse flags fetch only the marketplace
manifest and plugin package.

```bash
codex plugin marketplace add alamorre/breakdown.sh --ref main --sparse .agents/plugins --sparse plugins/breakdown
codex plugin add breakdown@breakdown
```

For a tagged release, replace `--ref main` with the release tag. Start a new Codex thread after
installing or updating so the plugin skills, prompts, assets, and MCP server config are loaded.

The plugin package includes:

- `plugins/breakdown/.codex-plugin/plugin.json` for marketplace metadata, icon, logo, screenshots,
  starter prompts, and bundled capability declarations.
- `plugins/breakdown/.mcp.json` for hosted Streamable HTTP MCP with
  `Authorization: Bearer ${BREAKDOWN_API_TOKEN}`.
- `plugins/breakdown/skills/` for Breakdown development and graph evaluation workflows.
- `.agents/plugins/marketplace.json` for the Git marketplace entry.

## First-Run Authentication

Create a scoped token before starting the Codex process that will load the plugin.

1. Create an agent setup session at
   `https://www.breakdown.sh/api/integrations/agent-setup-sessions`.
2. Open the returned approval URL while signed in to Breakdown.
3. Verify the setup code and approve only the scopes needed for the plugin session.
4. Exchange the setup secret for a scoped `bdk_...` token.
5. Set `BREAKDOWN_API_TOKEN` in the shell, launcher, or environment manager that starts Codex.

```bash
curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Codex","providerName":"OpenAI"}'
```

Manual token creation from Settings under MCP Access remains available as a fallback. Raw tokens are
shown once; store them outside the repository and never commit them.

Recommended scopes:

| Workflow                | Minimum scopes                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Read graphs             | `graphs:read`                                                                                |
| Author and patch graphs | `graphs:read`, `graphs:write`                                                                |
| Internal Breakdown runs | `graphs:read`, `runs:execute`, plus `runs:cancel` only when cancellation is needed           |
| External evaluator runs | `graphs:read`, `runs:external_execute`, `runs:write_results`                                 |
| Full graph operations   | `graphs:read`, `graphs:write`, `runs:execute`, `runs:external_execute`, `runs:write_results` |

Revoke plugin tokens from Settings under MCP Access. Revoked, missing, malformed, or unknown tokens
fail closed with `401`.

## MCP Surface

The plugin exposes hosted MCP tools for:

- graph CRUD: `list_graphs`, `get_graph`, `create_graph`, `update_graph`, `delete_graph`
- node and edge editing: `create_node`, `update_node`, `delete_node`, `connect_nodes`,
  `update_edge`, `delete_edge`
- workflow import/export and patch previews: `export_graph`, `import_graph`,
  `get_workflow_manifest`, `apply_graph_patch`
- internal runs: `run_node`, `run_graph`, `get_run_status`, `cancel_run`
- external evaluator runs: `create_external_run`, `get_next_step`, `get_step_context`,
  `submit_step_result`, `mark_step_blocked`, `finalize_external_run`, `summarize_run_delta`

It also exposes graph resources such as `breakdown://graphs`,
`breakdown://graphs/{graphId}`, workflow manifests, graph nodes, latest run status, external runs,
and external step context.

Destructive tools advertise destructive annotations and confirmation metadata. Clients should
still ask before deleting graphs, deleting nodes or edges, replacing imports, applying destructive
patches, or cancelling active runs. Use `apply_graph_patch` with `dryRun=true` before applying
graph mutations.

## Verify The Plugin

After installation, start a fresh Codex thread and ask it to list Breakdown graphs. That exercises
the Git marketplace package, env-var token injection, hosted MCP connection, `tools/list`, and a
read-only graph path.

From a repo checkout, run:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/breakdown
pnpm exec vitest run src/lib/mcp/codex-plugin-release.test.ts src/app/api/mcp/route.test.ts
pnpm lint
pnpm typecheck
```

`src/app/api/mcp/route.test.ts` covers token failure behavior, Streamable HTTP initialization,
tool schemas, safety annotations, scope failures, and graph listing with a bearer-token actor.
`src/lib/mcp/codex-plugin-release.test.ts` keeps the marketplace entry, manifest assets, hosted
MCP config, public-install docs, and local override guidance aligned.

## Direct Hosted MCP

Use this path when a client does not need the packaged Codex plugin:

```toml
[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"
```

Set `BREAKDOWN_API_TOKEN` to the approved token before starting the client. For the full
setup-session flow, see the public `/mcp` page.

## Local Or Self-Hosted Override

The committed plugin config always points at the hosted MCP endpoint. For local development, do not
edit and commit `plugins/breakdown/.mcp.json`.

Use one of these override paths instead:

- Prefer direct MCP config while developing the app:

  ```toml
  [mcp_servers.breakdown]
  url = "http://localhost:3000/api/mcp"
  bearer_token_env_var = "BREAKDOWN_API_TOKEN"
  ```

- For plugin packaging tests, copy `plugins/breakdown` to a throwaway directory outside the repo,
  change that copy's `.mcp.json` to `http://localhost:3000/api/mcp`, and install the throwaway
  marketplace entry.

Run the app before using the local endpoint:

```bash
pnpm dev
export BREAKDOWN_API_TOKEN=bdk_...
```

## Troubleshooting

`401 Missing bearer token` means the client reached Breakdown without an approved token. Create and
approve a setup session or set `BREAKDOWN_API_TOKEN` in the environment that starts Codex.

`403 Missing required scope` means the token is valid but too narrow for the requested tool. Create
a new token with the minimum additional scope needed.

If Codex still cannot see the plugin after install or update, start a new thread so Codex reloads
plugin skills and MCP server definitions.

If local development calls unexpectedly hit production, check for a committed `.mcp.json` edit and
switch to the direct local MCP config above.

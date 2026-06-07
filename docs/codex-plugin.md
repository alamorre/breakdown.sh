# Codex Plugin

The Breakdown Codex plugin is the polished public package for connecting Codex to hosted
Breakdown reasoning graphs. It wraps the same Streamable HTTP MCP endpoint used by direct
clients: `https://www.breakdown.sh/api/mcp`.

The first public release uses human-approved setup sessions that mint scoped bearer tokens for the
Codex plugin. Hosted OAuth connector registration can be added later if Codex marketplace
distribution requires it, but setup sessions keep the Git marketplace, local checkout, Codex
Desktop, and self-hosted paths consistent today without asking users to paste raw tokens into chat.

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

## One-Time Persistent Setup

Use the approval-session path as the default. It gives agents a browser approval URL and setup code,
then returns a scoped token after the signed-in user approves. Persist the exchanged token in the
user-level Codex plugin authentication store or launcher secret store that starts Codex Desktop. Do
not store tokens in repo-local `.codex/config.toml`, committed files, issue comments, or chat.

1. Install the plugin from Git and start a new Codex thread so Codex loads the plugin package.
2. Create an agent setup session at
   `https://www.breakdown.sh/api/integrations/agent-setup-sessions`.
3. Open the returned approval URL while signed in to Breakdown.
4. Verify the setup code and approve only the scopes needed for the plugin session.
5. Exchange the setup secret for a scoped `bdk_...` token.
6. Persist the token in the user-level Codex or launcher secret store that starts Codex Desktop.
7. Run `diagnose_breakdown_setup` from Codex and confirm `state: "ready"`.

```bash
curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Codex","providerName":"OpenAI"}'
```

Manual token creation from Settings under MCP Access remains available as an advanced fallback. Raw
tokens are shown once; store them outside the repository and never commit them. If a client cannot
persist plugin auth yet, set `BREAKDOWN_API_TOKEN` in the environment that starts Codex.

### Advanced Fallback: OS-Level Token Storage

Use these locations only when Codex cannot persist plugin authentication itself. Keep the Codex MCP
server config in the user-level Codex config file and keep the raw token in the OS user environment.

Codex config file paths:

| OS      | Path                               |
| ------- | ---------------------------------- |
| macOS   | `~/.codex/config.toml`             |
| Linux   | `~/.codex/config.toml`             |
| Windows | `%USERPROFILE%\.codex\config.toml` |

The Codex config should reference the environment variable, not the raw token:

```toml
[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"
```

On macOS, persist the token for GUI-launched Codex Desktop with this LaunchAgent file:

`~/Library/LaunchAgents/sh.breakdown.codex-env.plist`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>sh.breakdown.codex-env</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/launchctl</string>
    <string>setenv</string>
    <string>BREAKDOWN_API_TOKEN</string>
    <string>bdk_your_token_here</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
```

Load or reload it, then quit and reopen Codex Desktop:

```bash
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/sh.breakdown.codex-env.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/sh.breakdown.codex-env.plist
```

On Linux desktops that use the systemd user environment, persist the token with this file:

`~/.config/environment.d/breakdown-codex.conf`

```ini
BREAKDOWN_API_TOKEN=bdk_your_token_here
```

Then log out and back in before launching Codex so the desktop session inherits the updated user
environment. For terminal-launched Codex CLI sessions, exporting `BREAKDOWN_API_TOKEN` in that shell
also works for that process tree.

On Windows, there is no plaintext file path for the user environment. The persistent location is the
current user's environment registry key:

`HKEY_CURRENT_USER\Environment`, value name `BREAKDOWN_API_TOKEN`

Set it from PowerShell, then quit and reopen Codex Desktop. If Codex still cannot see it, sign out
and back in so Explorer and newly launched apps inherit the updated user environment.

```powershell
[Environment]::SetEnvironmentVariable('BREAKDOWN_API_TOKEN', 'bdk_your_token_here', 'User')
```

Recommended scopes:

| Workflow                | Minimum scopes                                                                               |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Read graphs             | `graphs:read`                                                                                |
| Author and patch graphs | `graphs:read`, `graphs:write`                                                                |
| Internal Breakdown runs | `graphs:read`, `runs:execute`, plus `runs:cancel` only when cancellation is needed           |
| External evaluator runs | `graphs:read`, `runs:external_execute`, `runs:write_results`                                 |
| Full graph operations   | `graphs:read`, `graphs:write`, `runs:execute`, `runs:external_execute`, `runs:write_results` |

Revoke plugin tokens from Settings under MCP Access. Revoked, missing, malformed, or unknown tokens
are reported separately by `diagnose_breakdown_setup` and
`GET https://www.breakdown.sh/api/integrations/codex/diagnostics`.

## Connection Check

Ask Codex to run `diagnose_breakdown_setup` after plugin setup. A ready response confirms the MCP
server is loaded, the token is valid, the external-evaluator tools are present, and the token has
the scopes needed for `get_next_step`, `submit_step_result`, and `mark_step_blocked`.

If `diagnose_breakdown_setup` is missing from the tool list, the plugin or MCP server is not loaded
in the current Codex session. Start a new Codex thread after install/update and check that the
Breakdown plugin is enabled.

Agents that can call HTTP directly can also request diagnostics without scraping docs:

```bash
curl https://www.breakdown.sh/api/integrations/codex/diagnostics \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Accept: application/json"
```

Without a bearer token, the diagnostics endpoint returns `state: "missing_token"` rather than
forcing the agent to infer the problem from a generic MCP failure.

## Release-Test Authentication

Plugin release smoke tests should use a durable release-test token instead of one-time approval
URLs. Create or rotate the token from `/settings` under **MCP Access** -> **Release Testing**, then
store the copied raw value as `BREAKDOWN_RELEASE_TEST_TOKEN` in GitHub Actions or the agent runtime
secret store.

The release-test preset uses `graphs:read`, `graphs:write`, `runs:external_execute`, and
`runs:write_results`. Settings identifies the token purpose, shows last-used metadata, and supports
rotation or revocation from a phone-friendly screen.

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

After installation, start a fresh Codex thread and ask it to run `diagnose_breakdown_setup`, then
list Breakdown graphs. That exercises the Git marketplace package, persistent token availability,
hosted MCP connection, `tools/list`, external-evaluator tool discovery, and a read-only graph path.

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

`diagnose_breakdown_setup` is missing means the plugin or MCP server is not installed, enabled, or
loaded in this Codex session. Install/enable the plugin and start a new Codex thread.

`state: "missing_token"` means the client reached Breakdown without an approved token. Create and
approve a setup session, then persist the exchanged token in the user-level Codex or launcher secret
store. Use `BREAKDOWN_API_TOKEN` only as an advanced fallback for clients without persistent plugin
auth.

`state: "invalid_token"`, `state: "revoked_token"`, or `state: "expired_token"` means the token
is present but cannot be used. Rotate or recreate the token from Settings under MCP Access.

`403 Missing required scope` means the token is valid but too narrow for the requested tool. Create
a new token with the minimum additional scope needed. `state: "missing_scope"` in diagnostics lists
the exact missing scopes.

If Codex still cannot see the plugin after install or update, start a new thread so Codex reloads
plugin skills and MCP server definitions.

If local development calls unexpectedly hit production, check for a committed `.mcp.json` edit and
switch to the direct local MCP config above.

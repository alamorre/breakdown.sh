# Breakdown Codex Plugin

This is the public Codex plugin package for Breakdown. It connects Codex to hosted Breakdown
reasoning graphs through Streamable HTTP MCP at `https://www.breakdown.sh/api/mcp`.

The plugin ships with marketplace metadata, icon/logo/screenshot assets, bundled Breakdown skills,
a setup diagnostic tool, and a hosted MCP config for Breakdown.

## Install From Git

```bash
codex plugin marketplace add alamorre/breakdown.sh --ref main --sparse .agents/plugins --sparse plugins/breakdown
codex plugin add breakdown@breakdown
```

For a release tag, replace `--ref main` with that tag. Start a new Codex thread after installing or
updating the plugin.

## One-Time Setup

Create an agent setup session and ask the signed-in user to approve the returned URL. Store the
exchanged token in the user-level Codex plugin authentication store or launcher secret store that
starts Codex Desktop. Do not store tokens in repo-local `.codex/config.toml`, committed files, or
chat.

```bash
curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Codex","providerName":"OpenAI"}'
```

After approval, exchange the returned setup secret at the returned exchange URL. Then start a new
Codex thread and run:

```bash
diagnose_breakdown_setup
```

The diagnostic response should report `state: "ready"` and confirm external-evaluator tools such
as `get_next_step`, `submit_step_result`, and `mark_step_blocked`. If your client cannot persist
plugin auth yet, `BREAKDOWN_API_TOKEN` remains an advanced fallback; set it in the environment that
starts Codex, not in the repository.

Advanced fallback locations:

- Codex config reference only, no raw token: `~/.codex/config.toml` on macOS/Linux or
  `%USERPROFILE%\.codex\config.toml` on Windows, with `bearer_token_env_var = "BREAKDOWN_API_TOKEN"`.
- macOS GUI-launched Codex Desktop token file:
  `~/Library/LaunchAgents/sh.breakdown.codex-env.plist`.
- Windows user environment token location: `HKEY_CURRENT_USER\Environment`, value name
  `BREAKDOWN_API_TOKEN`. Set it with PowerShell:
  `[Environment]::SetEnvironmentVariable('BREAKDOWN_API_TOKEN', 'bdk_your_token_here', 'User')`.

Manual token creation in Breakdown settings under MCP Access is also supported as a fallback. Store
raw tokens outside the repository, grant only the scopes needed for the session, and revoke plugin
tokens from Settings under MCP Access when they are no longer needed.

## MCP Surface

Expected hosted MCP capabilities include:

- graph CRUD, import/export, workflow manifests, and patch previews
- internal graph and node runs
- external-evaluator runs where Codex fetches step context, performs work, and submits results
- graph resources for graph lists, graph detail, manifests, nodes, run status, and external runs
- `diagnose_breakdown_setup` for token, scope, and external-evaluator readiness checks

Destructive tools carry destructive annotations and confirmation metadata. Clients should still ask
before deleting, replacing imports, applying destructive patches, or cancelling runs.

## Local Development Override

The committed `.mcp.json` intentionally points at the hosted endpoint. Do not commit a localhost URL
to this package.

When developing Breakdown locally, prefer a direct MCP config outside the plugin:

```toml
[mcp_servers.breakdown]
url = "http://localhost:3000/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"
```

For plugin packaging tests against a local app, copy this plugin directory to a throwaway location
outside the repo and edit the copy's `.mcp.json`.

## Verification

From the repo root:

```bash
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/breakdown
pnpm exec vitest run src/lib/mcp/codex-plugin-release.test.ts src/app/api/mcp/route.test.ts
pnpm --filter @breakdown/mcp build
```

From Codex, run `diagnose_breakdown_setup`. If that tool is missing, the plugin or MCP server is not
loaded in the current Codex session. If it reports `missing_token`, `invalid_token`,
`revoked_token`, `expired_token`, or `missing_scope`, follow the response's `setup.nextSteps`.

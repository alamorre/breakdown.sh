# Getting Started

Breakdown is a hosted reasoning workflow service for coding agents running in other projects. The
default integration path is a durable scoped `bdk_...` token with hosted MCP or headless REST.
Agents can also create short-lived setup sessions that a signed-in human approves in the browser;
the exchanged token is durable until revoked, rotated, or expired by policy. Do not clone
`alamorre/breakdown.sh` for normal service usage.

Clone this repository only when you are contributing to Breakdown, self-hosting it, or testing
Codex plugin packaging.

## Public Integration Surfaces

| Surface            | Endpoint                                                              |
| ------------------ | --------------------------------------------------------------------- |
| Discovery metadata | `GET https://www.breakdown.sh/api`                                    |
| Agent onboarding   | `GET https://www.breakdown.sh/api/integrations/headless-onboarding`   |
| Setup sessions     | `POST https://www.breakdown.sh/api/integrations/agent-setup-sessions` |
| Codex diagnostics  | `GET https://www.breakdown.sh/api/integrations/codex/diagnostics`     |
| Remote MCP         | `https://www.breakdown.sh/api/mcp`                                    |
| Headless REST      | `https://www.breakdown.sh/api/headless`                               |

## Quickstart For Coding Agents

1. Start in your own repo, terminal, or agent console.
2. Read public discovery metadata from `GET /api` or
   `GET /api/integrations/headless-onboarding`.
3. Use a durable token from `/settings` -> **MCP Access**, or create an agent setup session.
4. For setup sessions, ask the signed-in human to open the approval URL and verify the setup code.
5. Exchange the approved setup secret for a scoped `bdk_...` token.
6. Persist the token in the host client or user-level launcher secret store that starts the agent.
7. Run `diagnose_breakdown_setup` or `GET /api/integrations/codex/diagnostics` to confirm the token,
   scopes, and external-evaluator tool surface.
8. Connect MCP at `https://www.breakdown.sh/api/mcp` or use REST under
   `https://www.breakdown.sh/api/headless`.
9. Persist graphs, reasoning steps, citations, blocked data gaps, and external-run state in
   Breakdown.

Create a setup session:

```bash
curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Codex","providerName":"OpenAI"}'
```

The response includes an approval URL, user code, exchange URL, and exchange secret. Open the
approval URL while signed in to Breakdown, compare the setup code, and approve the requested scopes.

Exchange the approved setup secret:

```bash
curl "$EXCHANGE_URL" \
  -H "Content-Type: application/json" \
  -d "{\"exchangeSecret\":\"$EXCHANGE_SECRET\"}"
```

Use the response token in the host client or user-level launcher secret store. For direct client
setup, create the token in `/settings` -> **MCP Access** and copy it once. `BREAKDOWN_API_TOKEN` is
the supported environment variable for clients that cannot persist plugin auth directly.

For Codex Desktop fallback setup, put the MCP server reference in `~/.codex/config.toml` on
macOS/Linux or `%USERPROFILE%\.codex\config.toml` on Windows, and store the raw token in the OS user
environment. On macOS, use `~/Library/LaunchAgents/sh.breakdown.codex-env.plist`. On Linux, use
`~/.config/environment.d/breakdown-codex.conf`. On Windows, use `HKEY_CURRENT_USER\Environment`
with value name `BREAKDOWN_API_TOKEN`.

## MCP Client Configuration

```toml
[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"
```

## Headless REST

```bash
curl https://www.breakdown.sh/api/headless/graphs \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Accept: application/json"
```

## Current Data And Blocked Steps

External-evaluator runs use the host agent's tools and connectors for each step. If a step needs
current data, market data, web search, workspace files, or another connector the host does not have,
mark the step blocked instead of fabricating an answer.

## Troubleshooting

Run `diagnose_breakdown_setup` from MCP or call
`GET https://www.breakdown.sh/api/integrations/codex/diagnostics` for a machine-readable setup
state. `missing_token`, `invalid_token`, `revoked_token`, `expired_token`, and `missing_scope` are
reported separately.

`401 Missing bearer token` means the request reached Breakdown but did not include a token. Create a
durable token from `/settings` -> **MCP Access**, or create and approve a setup session, exchange it
for a `bdk_...` token, and persist it before retrying. It does not mean the agent should clone this
repository.

For contributor setup, see [Local Development](local-development.md). For full MCP details, see the
public `/mcp` page.

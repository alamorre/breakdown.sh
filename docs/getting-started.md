# Getting Started

Breakdown is a hosted reasoning workflow service for coding agents running in other projects. The
default integration path is public discovery metadata, setup-session approval, a scoped `bdk_...`
token, and hosted MCP or headless REST. Do not clone `alamorre/breakdown.sh` for normal service
usage.

Clone this repository only when you are contributing to Breakdown, self-hosting it, or testing the
repo-local plugin scaffold.

## Public Integration Surfaces

| Surface            | Endpoint                                                              |
| ------------------ | --------------------------------------------------------------------- |
| Discovery metadata | `GET https://www.breakdown.sh/api`                                    |
| Agent onboarding   | `GET https://www.breakdown.sh/api/integrations/headless-onboarding`   |
| Setup sessions     | `POST https://www.breakdown.sh/api/integrations/agent-setup-sessions` |
| Remote MCP         | `https://www.breakdown.sh/api/mcp`                                    |
| Headless REST      | `https://www.breakdown.sh/api/headless`                               |

## Quickstart For Coding Agents

1. Start in your own repo, terminal, or agent console.
2. Read public discovery metadata from `GET /api` or
   `GET /api/integrations/headless-onboarding`.
3. Create an agent setup session.
4. Ask the signed-in human to open the approval URL and verify the setup code.
5. Exchange the approved setup secret for a scoped `bdk_...` token.
6. Connect MCP at `https://www.breakdown.sh/api/mcp` or use REST under
   `https://www.breakdown.sh/api/headless`.
7. Persist graphs, reasoning steps, citations, blocked data gaps, and external-run state in
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

Use the response token as `BREAKDOWN_API_TOKEN`.

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

`401 Missing bearer token` means the request reached Breakdown but did not include an approved
token. Create and approve a setup session, exchange it for a `bdk_...` token, and set
`BREAKDOWN_API_TOKEN` before retrying. It does not mean the agent should clone this repository.

For contributor setup, see [Local Development](local-development.md). For full MCP details, see the
public `/mcp` page.

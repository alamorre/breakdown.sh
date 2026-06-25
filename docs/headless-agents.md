# Headless Agents

Breakdown can be used as a hosted DAG and reasoning workflow layer through public discovery
metadata, setup-session approval, headless REST routes, and a Streamable HTTP MCP endpoint. The
default path is for a coding agent running in any project to connect to hosted Breakdown without
cloning this repository.

Clone or sparse-install `alamorre/breakdown.sh` only when you are contributing to Breakdown,
self-hosting it, or testing Codex plugin packaging.

## Hosted Agent Quickstart

1. Start in your own repo, terminal, or agent console.
2. Discover integration metadata:

   ```text
   GET https://www.breakdown.sh/api
   GET https://www.breakdown.sh/api/integrations/headless-onboarding
   ```

3. Connect with a durable `bdk_...` token from `/settings` -> **MCP Access**, or create an agent
   setup session when the agent should initiate browser approval:

   ```bash
   curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \
     -H "Content-Type: application/json" \
     -d '{"clientName":"Codex","providerName":"OpenAI"}'
   ```

4. Ask the signed-in human to open the returned approval URL and verify the setup code.
5. Exchange the approved setup secret for a scoped `bdk_...` token when using an agent setup
   session.
6. Connect MCP at `https://www.breakdown.sh/api/mcp` or REST under
   `https://www.breakdown.sh/api/headless`.
7. Persist graphs, reasoning steps, citations, blocked data gaps, and external-run state in
   Breakdown.

`401 Missing bearer token` means the request reached Breakdown without a token. Create a durable MCP
connection token from `/settings` -> **MCP Access**, create and approve a setup session, or set
`BREAKDOWN_API_TOKEN`; it does not mean the agent should clone the repo or simulate a Breakdown run
outside Breakdown.

MCP client configuration:

```toml
[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"
```

Headless REST check:

```bash
curl https://www.breakdown.sh/api/headless/graphs \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Accept: application/json"
```

## Tokens

Headless REST and MCP calls use opaque bearer tokens with the `bdk_...` prefix. Raw tokens are shown once. Breakdown stores only a token hash plus metadata.

### Durable Client Connection

For persistent clients, create a named token once, copy the raw credential once, and store it in the
client or launcher secret store. A `bdk_...` token remains valid until revoked, rotated, or until
its optional expiry. This is the recommended path when a user is configuring Codex, Claude, Cursor,
OpenAI API, or another MCP-capable client directly.

1. Sign in to Breakdown.
2. Open `/settings`.
3. Use **MCP Client Connections** under **MCP Access**.
4. Choose Codex, Claude, Cursor, OpenAI API, or Other to load the client-specific snippet.
5. Copy the raw token when it is shown. It is displayed once.
6. Configure the MCP client with `https://www.breakdown.sh/api/mcp` and bearer authentication.

```toml
[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"
```

Raw tokens are never shown again after creation. Rotate or revoke the token from Settings under
**MCP Access** if it is exposed, lost, no longer needed, or missing required scopes.

Settings keeps client-specific snippets, copy-once credentials, last-used status, and rotation
beside the named connection. It also shows a `?access_token=...` URL fallback for clients that
cannot set headers; prefer bearer headers because URLs are easier to leak.

### Agent-Native Setup

A coding agent can request a scoped setup session without the user copying a token into chat. The
user signs in to Breakdown, approves the session in the browser, and the agent exchanges its setup
secret for a copy-once durable `bdk_...` integration token response.

Create a setup session:

```bash
curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \
  -H "Content-Type: application/json" \
  -d '{"clientName":"Codex","providerName":"OpenAI"}'
```

The response includes:

- `approveUrl`: open this in the signed-in browser.
- `userCode`: compare this with the code shown in the approval page.
- `exchangeSecret`: keep this in the agent session only.
- `exchangeUrl`: call this after approval.

Exchange the approved session:

```bash
curl "$EXCHANGE_URL" \
  -H "Content-Type: application/json" \
  -d "{\"exchangeSecret\":\"$EXCHANGE_SECRET\"}"
```

The exchange response includes the raw `token`, `sessionContext.authorizationHeader`, the MCP URL,
and the headless REST base URL. Use that token as `BREAKDOWN_API_TOKEN` for the MCP client process.
Local verification scripts can use the same variable when you are contributing to Breakdown. The
user can revoke the resulting token from Settings under MCP Access.

Discovery metadata is available at:

```text
GET /api
GET /api/integrations/headless-onboarding
GET /api/integrations/agent-setup-sessions
```

The older session-authenticated bootstrap endpoint remains available for bridges that already have the signed-in browser session cookie.

### Manual Token Creation

Create a token in the app when you need a durable client connection:

1. Sign in to Breakdown.
2. Open `/settings`.
3. Use **MCP Access** to create a token.
4. Copy the raw `bdk_...` token when it is shown.

Create a token from the local CLI when Supabase service-role env vars are available:

```bash
pnpm headless:token -- --user-id user_123 --name "Local MCP"
```

Create a narrowed token:

```bash
pnpm headless:token -- \
  --user-id user_123 \
  --name "Read-only MCP" \
  --scopes graphs:read
```

Use the token:

```bash
export BREAKDOWN_API_TOKEN=bdk_...
```

### Release-Test Token

Pre-merge plugin smoke tests should use a durable token instead of a one-time setup approval URL.
In the app, open `/settings` and use **MCP Access** -> **Release Testing** to create or rotate a
release-test token. The preset scopes are:

- `graphs:read`
- `graphs:write`
- `runs:external_execute`
- `runs:write_results`

Copy the raw token once and store it as `BREAKDOWN_RELEASE_TEST_TOKEN` in GitHub Actions or the
agent runtime secret store. The token list identifies release-test tokens by purpose, shows
last-used metadata, and lets you rotate or revoke the token from the same settings screen. Raw
tokens are never shown again after creation.

Scopes:

| Scope                   | Allows                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| `graphs:read`           | List, read, export, and inspect workflow manifests.                        |
| `graphs:write`          | Create, update, delete, import, and patch graphs, nodes, and edges.        |
| `runs:execute`          | Run nodes or graphs internally using the user's configured model provider. |
| `runs:external_execute` | Create, read, and finalize external-evaluator runs.                        |
| `runs:write_results`    | Submit or block external step results.                                     |
| `runs:cancel`           | Cancel internal graph runs.                                                |

External step packets include `executionPrompt`, `promptContract`, `outputContract`, upstream text
and `structuredOutput`, and submission requirements. Headless agents should execute
`executionPrompt`, then submit `output`, `structuredOutput` matching `outputContract.schema`, and
citations with the exact `contextVersion`. When required current data or sources are unavailable,
mark the step blocked or include explicit `structuredOutput.dataGaps` rather than relying on stale
model memory.

Revocation:

- In the app, return to `/settings` and revoke the token from **MCP Access**.
- The backing storage sets `integration_tokens.revoked_at`.
- Revoked, missing, malformed, or unknown tokens fail closed with `401`.

Quick auth check:

```bash
curl https://www.breakdown.sh/api/headless/graphs \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Accept: application/json"
```

## Local Development And Self-Hosting

Use this path when you are running your own Breakdown app, contributing to the project, or testing
repo-local integrations. It is not required for hosted Breakdown usage.

Prerequisites:

- Node and pnpm from `package.json`.
- The app environment needed for local Supabase access.
- A signed-in Breakdown user id, such as `user_...`, for CLI token creation.

Install and start the app:

```bash
pnpm install
pnpm dev
```

Set the local base URL used by scripts and the MCP package:

```bash
export BREAKDOWN_BASE_URL=http://localhost:3000
```

When using the local scripts, the dev server should be reachable at `BREAKDOWN_BASE_URL`. The
scripts do not provision hosted services and do not call any vendor market-data provider.

## Claude Desktop MCP

Build the stdio MCP package:

```bash
pnpm --filter @breakdown/mcp build
```

Claude Desktop-style config:

```json
{
  "mcpServers": {
    "breakdown": {
      "command": "node",
      "args": ["/absolute/path/to/breakdown.sh/packages/breakdown-mcp/dist/index.js"],
      "env": {
        "BREAKDOWN_BASE_URL": "http://localhost:3000",
        "BREAKDOWN_API_TOKEN": "bdk_..."
      }
    }
  }
}
```

After restarting Claude Desktop, ask it to list Breakdown graphs or use the `decompose_reasoning_chain` prompt. Destructive MCP tools include destructive annotations and confirmation text, but clients should still ask before deleting, replacing imports, applying destructive patches, or cancelling runs.

## Remote MCP And Hosted Consoles

The Streamable HTTP MCP endpoint is:

```text
POST /api/mcp
GET /api/mcp
DELETE /api/mcp
```

Hosted example:

```bash
curl https://www.breakdown.sh/api/mcp \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

Hosted or desktop agent consoles can discover onboarding metadata:

```text
GET https://www.breakdown.sh/api/integrations/headless-onboarding
```

Prefer setup sessions for new agents. Bridges that already have the signed-in browser session cookie
can still bootstrap a one-time bearer token:

```text
POST https://www.breakdown.sh/api/integrations/headless-onboarding
```

Minimal body:

```json
{
  "clientName": "Claude Desktop",
  "providerName": "Anthropic"
}
```

The response includes the raw bearer token once, the `/api/mcp` URL, the `/api/headless` REST base URL, and an authorization header value. OAuth-compatible consent screens, hosted marketplace registration, and vendor-specific setup are intentionally deferred; this endpoint keeps the local and self-hosted path provider-neutral.

Hosted console guidance:

- Use `/api/mcp` over HTTPS when the host supports Streamable HTTP MCP.
- Use bearer tokens for this checkpoint.
- Use external-evaluator mode when the host has its own web, filing, market-data, or workspace connectors.
- If the host lacks required current-data tools, mark the step blocked instead of fabricating data.

## REST Envelope

Successful responses:

```json
{ "data": {}, "error": null }
```

Errors:

```json
{
  "data": null,
  "error": { "code": "forbidden", "message": "Missing required scope: graphs:write" }
}
```

Use `Idempotency-Key` on create/import/patch/result requests when an agent may retry.

## Core REST Routes

Graph CRUD:

- `GET /api/headless/graphs`
- `POST /api/headless/graphs`
- `GET /api/headless/graphs/:graphId`
- `PATCH /api/headless/graphs/:graphId`
- `DELETE /api/headless/graphs/:graphId`

Node and edge CRUD:

- `POST /api/headless/graphs/:graphId/nodes`
- `PATCH /api/headless/nodes/:nodeId`
- `DELETE /api/headless/nodes/:nodeId`
- `POST /api/headless/graphs/:graphId/edges`
- `PATCH /api/headless/edges/:edgeId`
- `DELETE /api/headless/edges/:edgeId`

Workflow helpers:

- `GET /api/headless/graphs/:graphId/export`
- `POST /api/headless/graphs/import`
- `POST /api/headless/workflows/import-and-run`
- `GET /api/headless/graphs/:graphId/manifest`
- `POST /api/headless/graphs/:graphId/apply-patch`

Internal runner:

- `POST /api/headless/nodes/:nodeId/run`
- `POST /api/headless/graphs/:graphId/run`
- `GET /api/headless/graphs/:graphId/run-status`
- `POST /api/headless/graphs/:graphId/run-cancel`

External evaluator:

- `POST /api/headless/graphs/:graphId/external-runs`
- `GET /api/headless/external-runs/:runId`
- `GET /api/headless/external-runs/:runId/next-step`
- `GET /api/headless/external-runs/:runId/steps/:stepId/context`
- `POST /api/headless/external-runs/:runId/steps/:stepId/result`
- `POST /api/headless/external-runs/:runId/steps/:stepId/block`
- `POST /api/headless/external-runs/:runId/finalize`

## Internal-Run Examples

Internal runs execute with the user's configured model provider. They are useful when Breakdown should do the model work itself. For local verification without model calls, poll run status.

Create a graph:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/graphs" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: graph-$(uuidgen)" \
  -d '{"name":"Internal runner example","description":"Local headless graph"}'
```

Run a graph internally after adding nodes:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/graphs/$GRAPH_ID/run" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"runId":"local-run-1"}'
```

Poll status:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/graphs/$GRAPH_ID/run-status" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Accept: application/json"
```

Cancel queued work:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/graphs/$GRAPH_ID/run-cancel" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## External-Evaluator Examples

External-evaluator mode keeps reasoning in the host console:

1. Create or import a graph.
2. Create an external run.
3. Fetch the next ready step.
4. Fetch step context.
5. Use host-console tools/connectors to do the work.
6. Submit output and citations, or block the step with required data.
7. Finalize the run.

Import a local example graph and start the run in one call:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/workflows/import-and-run" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: import-run-$(uuidgen)" \
  -d "{
    \"importGraph\": $(cat examples/headless/create-improve-summarize.graph.json),
    \"externalRun\": {
      \"clientName\": \"Claude Desktop\",
      \"providerName\": \"Anthropic\",
      \"metadata\": { \"goal\": \"Improve and summarize a researched answer\" }
    }
  }"
```

Fetch the next step:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/external-runs/$RUN_ID/next-step" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN"
```

Fetch context:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/external-runs/$RUN_ID/steps/$STEP_ID/context" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN"
```

Submit a result using `examples/headless/external-step-result.json` as the body after replacing the context version:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/external-runs/$RUN_ID/steps/$STEP_ID/result" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: result-$(uuidgen)" \
  -d @examples/headless/external-step-result.json
```

Block a step when host tools or current data are unavailable:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/external-runs/$RUN_ID/steps/$STEP_ID/block" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: block-$(uuidgen)" \
  -d '{
    "contextVersion": "REPLACE_WITH_CONTEXT_VERSION",
    "reason": "Required current filings connector is unavailable in this console.",
    "requiredData": ["latest filing", "current market data"],
    "clientName": "Claude Desktop",
    "providerName": "Anthropic"
  }'
```

Finalize:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/external-runs/$RUN_ID/finalize" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"allowIncomplete":true}'
```

## Create, Improve, Summarize Workflow

Use the checked-in example graph for a generic create/improve/summarize DAG:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/graphs/import" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: graph-import-$(uuidgen)" \
  -d @examples/headless/create-improve-summarize.graph.json
```

Replace `REPLACE_WITH_SUMMARIZE_NODE_ID` in the patch example with the real `summarize-delta` node id from the import response or graph readback. Then preview the improvement patch:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/graphs/$GRAPH_ID/apply-patch" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: patch-preview-$(uuidgen)" \
  -d @examples/headless/improve.patch.json
```

Apply the same patch only after reviewing the preview:

```bash
curl "$BREAKDOWN_BASE_URL/api/headless/graphs/$GRAPH_ID/apply-patch" \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: patch-apply-$(uuidgen)" \
  -d @examples/headless/improve-apply.patch.json
```

MCP prompts that support this workflow:

- `decompose_reasoning_chain`: turn a goal into a DAG outline.
- `extend_graph_from_research`: propose a dry-run graph patch from findings.
- `follow_breakdown_graph`: execute a graph through external-evaluator steps.
- `refresh_sources_and_propagate`: refresh stale/current-data nodes and downstream reasoning.
- `summarize_graph_delta`: summarize changed outputs, blocked steps, citations, and open questions.

## Financial And Current-Data Workflows

Do not add a first-party market-data provider for the external-console flow. For stock, market, filing, or current-events work, the graph should include current-data nodes that instruct the host console to use its available tools/connectors. If those tools are unavailable, the host should submit an explicit data-gap result or block the step before producing any conclusion.

## Local Verification

With a dev server running and `BREAKDOWN_API_TOKEN` set, run the full local interface verification:

```bash
pnpm headless:verify
```

The verification script covers:

- token authentication failure for an invalid bearer token
- graph, node, and edge CRUD
- graph patch dry-run preview and apply
- internal run status polling
- external step context, result submission, blocking, and finalization
- Streamable HTTP MCP `tools/list` schema wiring

For a smaller external-run smoke:

```bash
pnpm headless:smoke -- --goal "Research a public company with current evidence" --mode block
pnpm headless:smoke -- --goal "Research a public company with current evidence" --mode submit
```

The smoke imports a generic two-step DAG, starts an external run, fetches the first step context, blocks or submits that step depending on `--mode`, finalizes with `allowIncomplete`, and prints the saved graph/run ids.

CI-oriented checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm --filter @breakdown/mcp typecheck
pnpm --filter @breakdown/mcp build
```

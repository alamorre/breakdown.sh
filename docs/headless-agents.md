# Headless Agents

Breakdown can be used as a headless DAG and reasoning workflow layer through REST routes, a local stdio MCP server, and a Streamable HTTP MCP endpoint.

## First-Time External Console Onboarding

Hosted or desktop agent consoles can discover the generic onboarding contract:

```text
GET https://your-breakdown-host/api/integrations/headless-onboarding
```

The response includes sign-in/sign-up URLs, the session bootstrap endpoint, the Streamable HTTP MCP URL, the headless REST base URL, and the default external-console scopes:

- `graphs:read`
- `graphs:write`
- `runs:external_execute`
- `runs:write_results`

After the user signs in to Breakdown in a browser session, the console or bridge can bootstrap usable credentials without asking the user to manually create a Settings token:

```text
POST https://your-breakdown-host/api/integrations/headless-onboarding
```

Minimal body:

```json
{
  "clientName": "Claude Desktop",
  "providerName": "Anthropic"
}
```

The response returns a raw bearer token once, the `/api/mcp` URL, the `/api/headless` REST base URL, and the authorization header value to use in the console integration.

The same bootstrap call can also import a generic DAG and start an external-evaluator run:

```json
{
  "clientName": "Codex",
  "workflow": {
    "importGraph": {
      "mode": "create",
      "graph": {
        "name": "External console research",
        "description": "A generic external-evaluator DAG."
      },
      "nodes": [
        {
          "id": "current-evidence",
          "name": "Gather current evidence",
          "nodeType": "external-current-data",
          "prompt": "Use host-console tools for current facts. If unavailable, block this step as a data gap.",
          "metadata": {
            "requiresCurrentData": true,
            "hostToolInstructions": "Use available host-console tools. Do not rely on model memory for current facts."
          },
          "position": { "x": 0, "y": 0 }
        }
      ],
      "edges": []
    }
  }
}
```

This path is intentionally provider-neutral. OAuth metadata, consent screens, and hosted marketplace registration can sit on top of it later; this checkpoint keeps the local and self-hosted path testable.

## Local Setup

For local development you can still create an integration token from the app:

1. Sign in to Breakdown.
2. Open `/settings`.
3. Use **MCP Access** to create a token.
4. Copy the raw `bdk_...` token when it is shown. It is only displayed once.

For local development, the script path is still available when you have Supabase service-role env vars:

```bash
pnpm headless:token -- --user-id user_123 --name "Local MCP"
```

Store the raw token as `THESIS_API_TOKEN`.

Start the app:

```bash
pnpm dev
```

Build the local MCP server:

```bash
pnpm --filter @breakdown/thesis-mcp build
```

Claude Desktop-style config:

```json
{
  "mcpServers": {
    "breakdown": {
      "command": "node",
      "args": ["/absolute/path/to/breakdown.sh/packages/thesis-mcp/dist/index.js"],
      "env": {
        "THESIS_BASE_URL": "http://localhost:3000",
        "THESIS_API_TOKEN": "bdk_..."
      }
    }
  }
}
```

## Remote MCP Endpoint

The local/testable remote MCP route is:

```text
POST http://localhost:3000/api/mcp
GET http://localhost:3000/api/mcp
DELETE http://localhost:3000/api/mcp
```

It uses the official MCP SDK WebStandard Streamable HTTP transport in stateless mode. Local smoke tests use JSON responses for request/response calls, while `GET` remains available for Streamable HTTP clients that open an SSE stream.

Send the integration token as a bearer token:

```bash
curl http://localhost:3000/api/mcp \
  -H 'Authorization: Bearer bdk_...' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

Invalid, revoked, or missing bearer tokens return `401` with a `WWW-Authenticate` header. Tool calls still enforce their required scopes; for example, a token with only `graphs:read` can list/read graphs but write tools return MCP tool errors without mutating data.

### Hosted Console Notes

- Claude, Codex, OpenAI/ChatGPT, Gemini, and other hosted consoles should use the same `/api/mcp` Streamable HTTP endpoint once the app is deployed behind HTTPS.
- Bearer tokens are the first supported credential path. OAuth-compatible authorization metadata, consent screens, dashboard UX, deployment wiring, and production secret setup are intentionally deferred.
- Destructive tools include MCP `destructiveHint` annotations and confirmation text in descriptions/metadata. Clients should still ask the user before deleting graphs, nodes, edges, replacing imports, applying destructive patches, or cancelling runs.
- External-evaluator tools are preferred when the host console has its own web, filing, market-data, or connector tools. If a host lacks required current-data tools, mark the step blocked instead of fabricating data.

### Cross-Console Paths

- ChatGPT/OpenAI-style hosted consoles: use the onboarding metadata endpoint for discovery, send users through the sign-in/sign-up URL, then use the session bootstrap response to configure `/api/mcp` or REST calls. Native OAuth/app-store registration is deferred.
- Claude Desktop and Codex: use the local stdio MCP server or the Streamable HTTP MCP endpoint. The `import_graph_and_create_external_run` tool creates a DAG and starts the external-evaluator run in one call.
- Claude.ai, Gemini, and Gemini-like hosted consoles: prefer the same Streamable HTTP MCP endpoint when supported. If the host requires a bridge, preserve the same bearer-token and headless REST semantics.
- Consoles with market data, web, filing, workspace, or other connectors should perform current-data steps in the host console and submit cited results back. Consoles without the required tools should mark those steps blocked with required data.

## Token Scopes

- `graphs:read`: list/read/export graphs and manifests.
- `graphs:write`: create/update/delete graphs, nodes, edges, imports, and patches.
- `runs:execute`: run nodes/graphs internally through Breakdown's configured model provider.
- `runs:external_execute`: create/read/finalize external-evaluator runs.
- `runs:write_results`: submit or block external step results.
- `runs:cancel`: cancel internal graph runs.

Revocation is stored by setting `integration_tokens.revoked_at`; revoked tokens fail closed.

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

## Core Routes

- `GET /api/headless/graphs`
- `POST /api/headless/graphs`
- `GET /api/headless/graphs/:graphId`
- `PATCH /api/headless/graphs/:graphId`
- `DELETE /api/headless/graphs/:graphId`
- `POST /api/headless/graphs/:graphId/nodes`
- `PATCH /api/headless/nodes/:nodeId`
- `DELETE /api/headless/nodes/:nodeId`
- `POST /api/headless/graphs/:graphId/edges`
- `PATCH /api/headless/edges/:edgeId`
- `DELETE /api/headless/edges/:edgeId`
- `GET /api/headless/graphs/:graphId/export`
- `POST /api/headless/graphs/import`
- `POST /api/headless/workflows/import-and-run`
- `GET /api/headless/graphs/:graphId/manifest`
- `POST /api/headless/graphs/:graphId/apply-patch`

## Internal Runner

- `POST /api/headless/nodes/:nodeId/run`
- `POST /api/headless/graphs/:graphId/run`
- `GET /api/headless/graphs/:graphId/run-status`
- `POST /api/headless/graphs/:graphId/run-cancel`

Internal runs use the user's configured model provider. Data-source and stale-upstream protections are preserved.

## External Evaluator

External-evaluator mode keeps reasoning in the host console:

1. Create a run: `POST /api/headless/graphs/:graphId/external-runs`.
2. Fetch the next ready step: `GET /api/headless/external-runs/:runId/next-step`.
3. Fetch context: `GET /api/headless/external-runs/:runId/steps/:stepId/context`.
4. Use the host console's tools/connectors to perform the step.
5. Submit output/citations with the returned `contextVersion`.
6. Mark the step blocked if required tools/current data are unavailable.
7. Finalize the run.

Routes:

- `GET /api/headless/external-runs/:runId`
- `GET /api/headless/external-runs/:runId/next-step`
- `GET /api/headless/external-runs/:runId/steps/:stepId/context`
- `POST /api/headless/external-runs/:runId/steps/:stepId/result`
- `POST /api/headless/external-runs/:runId/steps/:stepId/block`
- `POST /api/headless/external-runs/:runId/finalize`

## Financial/Stock Analysis

Do not add a first-party market-data provider for the external-console flow. If a user asks a console to analyze a stock, the console should create a generic DAG with current-data steps that tell the host agent to use available host tools such as FMP, filings/search, or market-data connectors. If unavailable, the step should be blocked or recorded as a data gap before any investment conclusion is produced.

## Local Smoke

With a dev server running and `THESIS_API_TOKEN` set, run a no-console external-evaluator smoke:

```bash
pnpm headless:smoke -- --goal "Research a public company with current evidence" --mode block
```

The smoke imports a generic two-step DAG, starts an external run, fetches the first step context, blocks or submits that step depending on `--mode`, finalizes with `allowIncomplete`, and prints the saved graph/run ids.

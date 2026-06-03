# Headless Agents

Breakdown can be used as a headless DAG and reasoning workflow layer through REST routes, a local stdio MCP server, and a Streamable HTTP MCP endpoint.

## Local Setup

Create an integration token:

```bash
pnpm headless:token -- --user-id user_123 --name "Local MCP"
```

The script prints the raw token once. Store it as `THESIS_API_TOKEN`.

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

Do not add a first-party market-data provider for the external-console flow. Add current-data steps that tell the host agent to use available host tools such as FMP, filings/search, or market-data connectors. If unavailable, the step should be blocked or recorded as a data gap.

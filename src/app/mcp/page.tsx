import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'MCP Access | breakdown.sh',
  description:
    'How to connect MCP-capable AI clients to breakdown.sh reasoning graphs.',
};

const endpointRows = [
  ['MCP server URL', '/api/mcp'],
  ['Transport', 'Streamable HTTP MCP'],
  ['Authentication', 'Authorization: Bearer bdk_...'],
  ['Token management', '/settings -> MCP Access'],
];

const scopes = [
  ['graphs:read', 'List, inspect, export, and read workflow manifests.'],
  ['graphs:write', 'Create, update, import, patch, and delete graphs, nodes, and edges.'],
  ['runs:execute', 'Ask Breakdown to run graph nodes with the configured model provider.'],
  ['runs:external_execute', 'Create and drive external-evaluator runs from a host console.'],
  ['runs:write_results', 'Submit external step results or mark required data as blocked.'],
  ['runs:cancel', 'Cancel queued internal graph work.'],
];

const toolGroups = [
  ['Graphs', 'list_graphs, get_graph, create_graph, update_graph, delete_graph'],
  ['Nodes and edges', 'create_node, update_node, delete_node, connect_nodes, update_edge, delete_edge'],
  ['Workflow shape', 'export_graph, import_graph, get_workflow_manifest, apply_graph_patch'],
  ['Internal runs', 'run_node, run_graph, get_run_status, cancel_run'],
  [
    'External runs',
    'create_external_run, get_next_step, get_step_context, submit_step_result, mark_step_blocked, finalize_external_run',
  ],
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/40 p-4 text-sm leading-6">
      <code>{children}</code>
    </pre>
  );
}

export default function McpPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto w-full max-w-4xl px-6 py-12 sm:py-16">
        <header className="border-b pb-8">
          <Link
            href="/"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            breakdown.sh
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">
            Connect an AI client with MCP
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            Breakdown exposes a Streamable HTTP MCP endpoint so external AI clients can
            read, edit, and run reasoning graphs with a scoped bearer token.
          </p>
        </header>

        <div className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
          <h2>What Works Today</h2>
          <p>
            Any client that supports remote MCP over Streamable HTTP and can send a bearer
            token can connect to Breakdown. That includes local agent consoles, self-hosted
            bridges, and ChatGPT-style clients when they provide a custom MCP server URL
            with an authorization header.
          </p>
          <p>
            Breakdown does not yet ship a public marketplace listing or OAuth consent flow
            for hosted connector directories. If a client requires OAuth-only connector
            registration, this endpoint is the MCP server to register later, but the current
            public path is bearer-token based.
          </p>

          <div className="not-prose mt-6 grid gap-2 rounded-md border p-4">
            {endpointRows.map(([label, value]) => (
              <div
                key={label}
                className="grid gap-1 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]"
              >
                <div className="font-medium">{label}</div>
                <div className="break-words font-mono text-muted-foreground">{value}</div>
              </div>
            ))}
          </div>

          <h2>Connect a Remote MCP Client</h2>
          <ol>
            <li>
              Sign in to Breakdown and open <Link href="/settings">Settings</Link>.
            </li>
            <li>
              In <strong>MCP Access</strong>, create a token. Choose the narrowest scopes
              that match what the client should do.
            </li>
            <li>
              Copy the token immediately. Breakdown only shows the raw <code>bdk_...</code>{' '}
              value once.
            </li>
            <li>
              In your MCP client, add the server URL for this deployment:
              <CodeBlock>{`https://www.breakdown.sh/api/mcp`}</CodeBlock>
            </li>
            <li>
              Configure bearer authentication:
              <CodeBlock>{`Authorization: Bearer bdk_your_token_here`}</CodeBlock>
            </li>
            <li>
              Ask the client to list Breakdown tools or list your graphs. A successful
              connection should expose tools such as <code>list_graphs</code>,{' '}
              <code>get_graph</code>, and <code>create_external_run</code>.
            </li>
          </ol>

          <h2>Use Codex or Another Config-Based Client</h2>
          <p>
            Clients that read MCP server configuration usually need a URL plus an
            environment variable containing the token. For example:
          </p>
          <CodeBlock>{`[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"`}</CodeBlock>
          <p>
            Then set <code>BREAKDOWN_API_TOKEN</code> to the token created in Settings
            before starting the client.
          </p>

          <h2>Use Claude Desktop Locally</h2>
          <p>
            For local desktop clients that prefer stdio MCP, run the bundled MCP package
            against a local or hosted Breakdown app:
          </p>
          <CodeBlock>{`{
  "mcpServers": {
    "breakdown": {
      "command": "node",
      "args": ["/absolute/path/to/breakdown.sh/packages/breakdown-mcp/dist/index.js"],
      "env": {
        "BREAKDOWN_BASE_URL": "https://www.breakdown.sh",
        "BREAKDOWN_API_TOKEN": "bdk_your_token_here"
      }
    }
  }
}`}</CodeBlock>

          <h2>Scopes</h2>
          <div className="not-prose mt-4 overflow-hidden rounded-md border">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="border-b px-4 py-3 font-medium">Scope</th>
                  <th className="border-b px-4 py-3 font-medium">Allows</th>
                </tr>
              </thead>
              <tbody>
                {scopes.map(([scope, description]) => (
                  <tr key={scope} className="border-b last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{scope}</td>
                    <td className="px-4 py-3 text-muted-foreground">{description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2>Available Tools</h2>
          <p>
            MCP tools are grouped around graph editing, workflow execution, and external
            evaluator runs where the host client performs each step with its own connectors.
          </p>
          <div className="not-prose mt-4 grid gap-3">
            {toolGroups.map(([label, tools]) => (
              <div key={label} className="rounded-md border p-4">
                <h3 className="text-sm font-medium">{label}</h3>
                <p className="mt-2 break-words font-mono text-xs leading-5 text-muted-foreground">
                  {tools}
                </p>
              </div>
            ))}
          </div>

          <h2>How External Evaluator Runs Work</h2>
          <p>
            External-evaluator mode lets the MCP client keep the model work in its own
            environment while Breakdown stores the graph, step state, outputs, citations,
            and blocked data gaps.
          </p>
          <ol>
            <li>Create or import a graph.</li>
            <li>Create an external run for that graph.</li>
            <li>Fetch the next ready step and its context.</li>
            <li>Use the available host-client tools to do the work.</li>
            <li>Submit the result with citations, or mark the step blocked.</li>
            <li>Finalize the run when steps are submitted or intentionally blocked.</li>
          </ol>

          <h2>Safety Model</h2>
          <ul>
            <li>Tokens are scoped and can be revoked from Settings.</li>
            <li>Raw tokens are shown once and stored by Breakdown only as hashes.</li>
            <li>Destructive tools advertise destructive annotations and confirmation text.</li>
            <li>Clients should confirm before deleting graphs, replacing imports, applying destructive patches, or cancelling runs.</li>
            <li>Current-data steps should be blocked when the host client lacks the required connector or live data access.</li>
          </ul>

          <h2>REST and Bootstrap Metadata</h2>
          <p>
            MCP clients can also discover integration metadata at{' '}
            <code>/api/integrations/headless-onboarding</code>. The headless REST API lives
            under <code>/api/headless</code> and uses the same bearer tokens and scopes.
          </p>
          <CodeBlock>{`curl https://www.breakdown.sh/api/mcp \\
  -H "Authorization: Bearer bdk_your_token_here" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`}</CodeBlock>
        </div>
      </article>
    </main>
  );
}

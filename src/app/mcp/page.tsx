import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsBreadcrumb } from '@/components/docs/DocsBreadcrumb';
import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'MCP Access | breakdown.sh',
  description: 'How to connect MCP-capable AI clients to hosted breakdown.sh reasoning graphs.',
};

const endpointRows = [
  ['Discovery metadata', 'GET https://www.breakdown.sh/api'],
  ['Agent onboarding', 'GET https://www.breakdown.sh/api/integrations/headless-onboarding'],
  ['Setup sessions', 'POST https://www.breakdown.sh/api/integrations/agent-setup-sessions'],
  ['Codex diagnostics', 'GET https://www.breakdown.sh/api/integrations/codex/diagnostics'],
  ['MCP server URL', 'https://www.breakdown.sh/api/mcp'],
  ['Transport', 'Streamable HTTP MCP'],
  ['Headless REST', 'https://www.breakdown.sh/api/headless'],
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
  ['Setup', 'diagnose_breakdown_setup'],
  ['Graphs', 'list_graphs, get_graph, create_graph, update_graph, delete_graph'],
  [
    'Nodes and edges',
    'create_node, update_node, delete_node, connect_nodes, update_edge, delete_edge',
  ],
  ['Workflow shape', 'export_graph, import_graph, get_workflow_manifest, apply_graph_patch'],
  ['Internal runs', 'run_node, run_graph, get_run_status, cancel_run'],
  [
    'External runs',
    'create_external_run, get_next_step, get_step_context, submit_step_result, mark_step_blocked, finalize_external_run',
  ],
];

export default function McpPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto w-full max-w-4xl px-6 py-12 sm:py-16">
        <header className="border-b pb-8">
          <DocsBreadcrumb />
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">
            Connect an AI client with MCP
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            Breakdown exposes a hosted Streamable HTTP MCP endpoint so agents in other projects can
            read, edit, and run reasoning graphs with scoped bearer tokens.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>Default Hosted Path</h2>
          <p>
            Start from your own repo or agent console. Discover Breakdown through public metadata,
            create a durable MCP token from Settings under MCP Access, or create a setup session
            that a signed-in human approves in the browser. Both paths produce a{' '}
            <code>bdk_...</code> token for the hosted MCP endpoint. Do not clone the Breakdown repo
            for normal service usage.
          </p>
          <p>
            Clone or sparse-install this repository only when you are contributing to Breakdown,
            self-hosting it, or testing Codex plugin packaging.
          </p>
        </DocsProse>

        <div className="not-prose mt-6 grid gap-2 rounded-md border p-4">
          {endpointRows.map(([label, value]) => (
            <div key={label} className="grid gap-1 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]">
              <div className="font-medium">{label}</div>
              <div className="break-words font-mono text-muted-foreground">{value}</div>
            </div>
          ))}
        </div>

        <DocsProse className="mt-8">
          <h2>Remote MCP Quickstart</h2>
          <ol>
            <li>
              Read <code>GET /api</code> or <code>GET /api/integrations/headless-onboarding</code>{' '}
              for machine-readable setup metadata.
            </li>
            <li>
              Create a durable MCP token from <Link href="/settings">Settings</Link> under MCP
              Access, or create an agent setup session.
            </li>
            <li>
              For setup sessions, open the returned approval URL while signed in to Breakdown.
            </li>
            <li>Verify the setup code and approve the requested scopes.</li>
            <li>
              Have the agent exchange the setup secret for the scoped <code>bdk_...</code> token.
            </li>
            <li>
              Run <code>diagnose_breakdown_setup</code> or{' '}
              <code>GET /api/integrations/codex/diagnostics</code> to verify token, scopes, and
              external-evaluator tool readiness.
            </li>
            <li>
              Configure your MCP client with <code>https://www.breakdown.sh/api/mcp</code> and an{' '}
              <code>Authorization: Bearer bdk_...</code> header.
            </li>
            <li>
              Ask the client to list Breakdown tools or list your graphs. A successful connection
              should expose tools such as <code>list_graphs</code>, <code>get_graph</code>, and{' '}
              <code>create_external_run</code>.
            </li>
          </ol>

          <h2>Create A Durable Client Connection</h2>
          <p>
            For persistent clients, create a named token in <Link href="/settings">Settings</Link>{' '}
            under MCP Access, copy the raw <code>bdk_...</code> credential once, and store it in the
            client or launcher secret store. The token remains valid until revoked, rotated, or
            until its optional expiry.
          </p>
          <p>
            Use <code>https://www.breakdown.sh/api/mcp</code> as the server URL and send the token
            as <code>Authorization: Bearer bdk_...</code>. Issue{' '}
            <a href="https://github.com/alamorre/breakdown.sh/issues/116">#116</a> tracks a more
            Zapier-like Connect page with client-specific snippets, copy-once credentials, and
            rotation beside setup instructions.
          </p>

          <h2>Create And Approve A Setup Session</h2>
          <CodeBlock>{`curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \\
  -H "Content-Type: application/json" \\
  -d '{"clientName":"Codex","providerName":"OpenAI"}'`}</CodeBlock>
          <p>
            The create response includes an approval URL, setup code, exchange URL, and exchange
            secret. The user opens the approval URL in a signed-in browser, verifies the code, and
            approves the requested scopes. The agent then exchanges the approved setup secret:
          </p>
          <CodeBlock>{`curl "$EXCHANGE_URL" \\
  -H "Content-Type: application/json" \\
  -d "{\\"exchangeSecret\\":\\"$EXCHANGE_SECRET\\"}"`}</CodeBlock>
          <p>
            The exchange response includes the raw token once, the MCP URL, the headless REST base
            URL, and an authorization header value. The setup session is short-lived, but the
            exchanged token is durable until revoked, rotated, or until its optional expiry.
          </p>

          <h2>Configure A Client</h2>
          <p>
            Clients that read MCP server configuration usually need a URL plus an environment
            variable containing the token.
          </p>
          <CodeBlock>{`[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"`}</CodeBlock>
          <p>
            Then set <code>BREAKDOWN_API_TOKEN</code> to the durable <code>bdk_...</code> token
            before starting the client.
          </p>
          <p>
            For Codex Desktop fallback setup, the MCP server reference belongs in{' '}
            <code>~/.codex/config.toml</code> on macOS/Linux or{' '}
            <code>%USERPROFILE%\.codex\config.toml</code> on Windows. Do not put the raw token in
            that file; store it in the OS user environment.
          </p>
          <p>
            On macOS, persist the token for GUI-launched Codex Desktop with{' '}
            <code>~/Library/LaunchAgents/sh.breakdown.codex-env.plist</code>, then quit and reopen
            Codex Desktop.
          </p>
          <CodeBlock>{`<?xml version="1.0" encoding="UTF-8"?>
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
</plist>`}</CodeBlock>
          <CodeBlock>{`launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/sh.breakdown.codex-env.plist 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/sh.breakdown.codex-env.plist`}</CodeBlock>
          <p>
            On Linux desktops that use the systemd user environment, persist the token with{' '}
            <code>~/.config/environment.d/breakdown-codex.conf</code>, then log out and back in
            before launching Codex. For terminal-launched Codex CLI sessions, exporting{' '}
            <code>BREAKDOWN_API_TOKEN</code> in that shell also works for that process tree.
          </p>
          <CodeBlock>{`BREAKDOWN_API_TOKEN=bdk_your_token_here`}</CodeBlock>
          <p>
            On Windows, the persistent location is <code>HKEY_CURRENT_USER\Environment</code>, value
            name <code>BREAKDOWN_API_TOKEN</code>. Set it from PowerShell, then quit and reopen
            Codex Desktop. If Codex still cannot see it, sign out and back in.
          </p>
          <CodeBlock>{`[Environment]::SetEnvironmentVariable('BREAKDOWN_API_TOKEN', 'bdk_your_token_here', 'User')`}</CodeBlock>
          <CodeBlock>{`curl https://www.breakdown.sh/api/mcp \\
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \\
  -H "Accept: application/json, text/event-stream" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`}</CodeBlock>

          <h2>Release-Test Token</h2>
          <p>
            Pre-merge plugin smoke tests should use a durable release-test token instead of a
            one-time setup session. In <Link href="/settings">Settings</Link> under MCP Access, use
            Release Testing to create or rotate a token with <code>graphs:read</code>,{' '}
            <code>graphs:write</code>, <code>runs:external_execute</code>, and{' '}
            <code>runs:write_results</code>.
          </p>
          <p>
            Copy the raw token once and store it as <code>BREAKDOWN_RELEASE_TEST_TOKEN</code> in
            GitHub Actions or the agent runtime secret store. Release-test tokens identify their
            purpose in Settings, show last-used metadata, and can be rotated or revoked without
            accepting another approval URL.
          </p>

          <h2>REST And Bootstrap Metadata</h2>
          <p>
            MCP clients and agents can also discover integration metadata at <code>/api</code>,{' '}
            <code>/.well-known/ai-plugin.json</code>, <code>/openapi.json</code>, and{' '}
            <code>/api/integrations/headless-onboarding</code>. The headless REST API lives under{' '}
            <code>/api/headless</code> and uses the same bearer tokens and scopes.
          </p>
          <CodeBlock>{`curl https://www.breakdown.sh/api/headless/graphs \\
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \\
  -H "Accept: application/json"`}</CodeBlock>

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
            MCP tools are grouped around graph editing, workflow execution, and external evaluator
            runs where the host client performs each step with its own connectors.
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

          <h2>External Evaluator Runs</h2>
          <p>
            External-evaluator mode lets the MCP client keep the model work in its own environment
            while Breakdown stores the graph, step state, outputs, citations, and blocked data gaps.
          </p>
          <ol>
            <li>Create or import a graph.</li>
            <li>Create an external run for that graph.</li>
            <li>
              Claim the next runnable work packet with <code>get_next_step</code>.
            </li>
            <li>Use the available host-client tools to do the work.</li>
            <li>Submit the result with citations, or mark the step blocked.</li>
            <li>Finalize the run when steps are submitted or intentionally blocked.</li>
          </ol>

          <h2>Safety And Current Data</h2>
          <ul>
            <li>Tokens are scoped and can be revoked from Settings.</li>
            <li>Raw tokens are shown once and stored by Breakdown only as hashes.</li>
            <li>Destructive tools advertise destructive annotations and confirmation text.</li>
            <li>
              Clients should confirm before deleting graphs, replacing imports, applying destructive
              patches, or cancelling runs.
            </li>
            <li>
              Current-data or stock-analysis steps depend on host-agent tools such as web search,
              financial data, workspace files, or other connectors. If the host lacks the required
              tool, mark the step blocked instead of fabricating data.
            </li>
          </ul>

          <h2>Troubleshooting</h2>
          <p>
            Run <code>diagnose_breakdown_setup</code> from MCP or call{' '}
            <code>GET /api/integrations/codex/diagnostics</code> for a machine-readable setup state.
            Missing, invalid, revoked, expired, and under-scoped tokens are reported separately.
          </p>
          <p>
            <code>401 Missing bearer token</code> means the request reached Breakdown without an
            bearer token. Create a durable token from Settings under MCP Access, or create and
            approve a setup session, exchange it for a <code>bdk_...</code> token, and persist it
            before retrying. It does not mean the agent should clone this repository.
          </p>
          <p>
            <code>403 Missing required scope</code> means the token is valid but lacks the scope
            needed for that tool or route. Create a new token with the minimum additional scope
            needed.
          </p>

          <h2>Advanced Local Or Self-Hosted Use</h2>
          <p>
            Use local endpoints only when you are developing Breakdown, testing a self-hosted
            deployment, or validating Codex plugin packaging.
          </p>
          <CodeBlock>{`[mcp_servers.breakdown]
url = "http://localhost:3000/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"`}</CodeBlock>
          <p>
            For local desktop clients that require stdio MCP, build and run the bundled MCP package
            from a Breakdown checkout:
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
          <p>
            For Codex plugin-specific setup, see <Link href="/docs/codex-plugin">Codex Plugin</Link>
            .
          </p>
        </DocsProse>
      </article>
    </main>
  );
}

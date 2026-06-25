import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsBreadcrumb } from '@/components/docs/DocsBreadcrumb';
import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'Codex Plugin | breakdown.sh',
  description:
    'Install the Breakdown Codex plugin, configure durable MCP access, and verify hosted MCP access.',
};

const integrationPaths = [
  [
    'Public Codex plugin',
    'Git marketplace plugin',
    'Use from Codex when you want packaged skills, assets, prompts, MCP tools, and graph resources.',
  ],
  [
    'Direct hosted MCP/API',
    'Manual MCP or REST config',
    'Use from any MCP-capable client, automation, or coding agent that does not need the Codex plugin.',
  ],
  [
    'Local/self-hosted',
    'Local MCP endpoint override',
    'Use only when contributing to Breakdown, testing a local app, or running a self-hosted deployment.',
  ],
];

const pluginFiles = [
  ['Plugin manifest', 'plugins/breakdown/.codex-plugin/plugin.json'],
  ['MCP config', 'plugins/breakdown/.mcp.json'],
  ['Bundled skills', 'plugins/breakdown/skills/'],
  ['Release assets', 'plugins/breakdown/assets/'],
  ['Marketplace entry', '.agents/plugins/marketplace.json'],
];

const scopeRows = [
  ['Read graphs', 'graphs:read'],
  ['Author and patch graphs', 'graphs:read, graphs:write'],
  ['Internal runs', 'graphs:read, runs:execute, plus runs:cancel only when needed'],
  ['External evaluator runs', 'graphs:read, runs:external_execute, runs:write_results'],
  [
    'Full graph operations',
    'graphs:read, graphs:write, runs:execute, runs:external_execute, runs:write_results',
  ],
];

const toolGroups = [
  ['Setup', 'diagnose_breakdown_setup'],
  ['Graph CRUD', 'list_graphs, get_graph, create_graph, update_graph, delete_graph'],
  [
    'Nodes and edges',
    'create_node, update_node, delete_node, connect_nodes, update_edge, delete_edge',
  ],
  ['Workflow shape', 'export_graph, import_graph, get_workflow_manifest, apply_graph_patch'],
  ['Internal runs', 'run_node, run_graph, get_run_status, cancel_run'],
  [
    'External runs',
    'create_external_run, get_next_step, get_step_context, submit_step_result, mark_step_blocked, finalize_external_run, summarize_run_delta',
  ],
];

const resourceRows = [
  ['Graph list', 'breakdown://graphs'],
  ['Graph detail', 'breakdown://graphs/{graphId}'],
  ['Workflow manifest', 'breakdown://graphs/{graphId}/manifest'],
  ['Graph node', 'breakdown://graphs/{graphId}/nodes/{nodeId}'],
  ['Latest run status', 'breakdown://graphs/{graphId}/runs/latest'],
  ['External run', 'breakdown://external-runs/{runId}'],
  ['External step', 'breakdown://external-runs/{runId}/steps/{stepId}'],
];

export default function CodexPluginDocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto w-full max-w-4xl px-6 py-12 sm:py-16">
        <header className="border-b pb-8">
          <DocsBreadcrumb />
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Codex Plugin</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            Install the Breakdown Codex plugin to connect Codex to hosted reasoning graphs through
            durable scoped Streamable HTTP MCP credentials and human-approved setup sessions. Hosted
            OAuth connector registration can be added later if marketplace distribution requires it;
            durable <code>bdk_...</code> tokens keep Git marketplace, local checkout, Codex Desktop,
            and self-hosted paths consistent today.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>Choose The Right Path</h2>
          <p>
            Do not clone the Breakdown repo just to use hosted Breakdown. Install the plugin from
            Git, or point your MCP client directly at the hosted endpoint.
          </p>
        </DocsProse>

        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Path</th>
                <th className="border-b px-4 py-3 font-medium">Use</th>
                <th className="border-b px-4 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {integrationPaths.map(([label, name, description]) => (
                <tr key={label} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{label}</td>
                  <td className="px-4 py-3">{name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Install The Public Plugin</h2>
          <p>
            Install the repo marketplace and plugin from Git. The sparse flags fetch only the
            marketplace manifest and plugin package.
          </p>
          <CodeBlock>{`codex plugin marketplace add alamorre/breakdown.sh --ref main --sparse .agents/plugins --sparse plugins/breakdown
codex plugin add breakdown@breakdown`}</CodeBlock>
          <p>
            For a tagged release, replace <code>--ref main</code> with the release tag. Start a new
            Codex thread after installing or updating so the plugin skills, prompts, assets, and MCP
            server config are loaded.
          </p>

          <h2>Package Contents</h2>
        </DocsProse>

        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Part</th>
                <th className="border-b px-4 py-3 font-medium">Path</th>
              </tr>
            </thead>
            <tbody>
              {pluginFiles.map(([label, path]) => (
                <tr key={label} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{label}</td>
                  <td className="break-all px-4 py-3 font-mono text-xs text-muted-foreground">
                    {path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Recommended Hosted MCP Connection</h2>
          <p>
            Create a named Breakdown MCP connection once, copy the credential once, and store it in
            the client or launcher secret store that starts Codex. The resulting{' '}
            <code>bdk_...</code> token is durable until revoked, rotated, or until an optional
            expiry.
          </p>
          <ol>
            <li>Sign in to Breakdown.</li>
            <li>
              Open <Link href="/settings">Settings</Link> and use MCP Access to create a token named
              for the client.
            </li>
            <li>Grant the minimum scopes needed for the workflow.</li>
            <li>Copy the raw token when it is shown. It is displayed once.</li>
            <li>
              Store it outside the repository in the user-level Codex/plugin secret store or
              launcher secret store that starts Codex Desktop.
            </li>
            <li>
              Run <code>diagnose_breakdown_setup</code> and confirm{' '}
              <code>state: &quot;ready&quot;</code>.
            </li>
          </ol>
          <CodeBlock>{`[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"`}</CodeBlock>
          <p>
            Set <code>BREAKDOWN_API_TOKEN</code> to the copied <code>bdk_...</code> token in the
            environment or secret store used by the MCP client. Do not store raw tokens in
            repo-local <code>.codex/config.toml</code>, committed files, issue comments, or chat.
            Revoke or rotate client tokens from Settings under MCP Access. Issue{' '}
            <a href="https://github.com/alamorre/breakdown.sh/issues/116">#116</a> tracks a more
            Zapier-like Connect experience with client-specific snippets and copy-once credentials.
          </p>

          <h2>Agent-Native Setup Session</h2>
          <p>
            Use the approval-session path when an agent can start setup from inside the MCP client
            and the user can approve in the browser. The setup session is short-lived, but the
            exchanged <code>bdk_...</code> token is a normal integration token: it remains valid
            until revoked, rotated, or until its optional expiry.
          </p>
          <ol>
            <li>Install the plugin from Git and start a new Codex thread.</li>
            <li>
              Create an agent setup session at{' '}
              <code>https://www.breakdown.sh/api/integrations/agent-setup-sessions</code>.
            </li>
            <li>Open the returned approval URL while signed in to Breakdown.</li>
            <li>Verify the setup code and approve only the scopes needed for the session.</li>
            <li>
              Exchange the setup secret for a scoped <code>bdk_...</code> token.
            </li>
            <li>
              Persist the token in the user-level Codex or launcher secret store that starts Codex
              Desktop.
            </li>
            <li>
              Run <code>diagnose_breakdown_setup</code> and confirm{' '}
              <code>state: &quot;ready&quot;</code>.
            </li>
          </ol>
          <CodeBlock>{`curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \\
  -H "Content-Type: application/json" \\
  -d '{"clientName":"Codex","providerName":"OpenAI"}'`}</CodeBlock>
          <p>
            If <code>diagnose_breakdown_setup</code> reports <code>missing_token</code>, create a
            durable MCP connection from Settings or create and approve an agent setup session. Do
            not treat <code>missing_token</code> as permission to simulate a Breakdown run outside
            Breakdown unless the user explicitly asks for that fallback.
          </p>

          <h3>Advanced Fallback: OS-Level Token Storage</h3>
          <p>
            Use these locations only when Codex cannot persist plugin authentication itself. Keep
            the Codex MCP server config in the user-level Codex config file and keep the raw token
            in the OS user environment.
          </p>
          <p>
            Codex config file paths: <code>~/.codex/config.toml</code> on macOS and Linux, or{' '}
            <code>%USERPROFILE%\.codex\config.toml</code> on Windows. The config should reference
            the environment variable, not the raw token.
          </p>
          <CodeBlock>{`[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"`}</CodeBlock>
          <p>
            On macOS, persist the token for GUI-launched Codex Desktop with this LaunchAgent file:{' '}
            <code>~/Library/LaunchAgents/sh.breakdown.codex-env.plist</code>.
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
            On Windows, there is no plaintext file path for the user environment. The persistent
            location is <code>HKEY_CURRENT_USER\Environment</code>, value name{' '}
            <code>BREAKDOWN_API_TOKEN</code>. Set it from PowerShell, then quit and reopen Codex
            Desktop. If Codex still cannot see it, sign out and back in.
          </p>
          <CodeBlock>{`[Environment]::SetEnvironmentVariable('BREAKDOWN_API_TOKEN', 'bdk_your_token_here', 'User')`}</CodeBlock>
        </DocsProse>

        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Workflow</th>
                <th className="border-b px-4 py-3 font-medium">Minimum scopes</th>
              </tr>
            </thead>
            <tbody>
              {scopeRows.map(([workflow, scopes]) => (
                <tr key={workflow} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{workflow}</td>
                  <td className="break-words px-4 py-3 font-mono text-xs text-muted-foreground">
                    {scopes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <p>
            Revoke plugin tokens from Settings under MCP Access. Revoked, missing, malformed, or
            unknown tokens are reported separately by <code>diagnose_breakdown_setup</code> and{' '}
            <code>GET /api/integrations/codex/diagnostics</code>.
          </p>

          <h2>Connection Check</h2>
          <p>
            Ask Codex to run <code>diagnose_breakdown_setup</code> after plugin setup. A ready
            response confirms the MCP server is loaded, the token is valid, the external-evaluator
            tools are present, and the token has the scopes needed for <code>get_next_step</code>,{' '}
            <code>submit_step_result</code>, and <code>mark_step_blocked</code>.
          </p>
          <p>
            If <code>diagnose_breakdown_setup</code> is missing from the tool list, the plugin or
            MCP server is not loaded in the current Codex session. Start a new Codex thread after
            install or update and check that the Breakdown plugin is enabled.
          </p>
          <CodeBlock>{`curl https://www.breakdown.sh/api/integrations/codex/diagnostics \
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \
  -H "Accept: application/json"`}</CodeBlock>
          <p>
            Without a bearer token, the diagnostics endpoint returns{' '}
            <code>{'state: "missing_token"'}</code>
            so agents do not have to guess from a generic MCP failure.
          </p>

          <h2>Release-Test Authentication</h2>
          <p>
            Plugin release smoke tests should not depend on one-time approval URLs. Create or rotate
            a Release Testing token from <Link href="/settings">Settings</Link> under MCP Access,
            then store the copied value as <code>BREAKDOWN_RELEASE_TEST_TOKEN</code> in GitHub
            Actions or the agent runtime secret store.
          </p>
          <p>
            The release-test token is scoped to <code>graphs:read</code>, <code>graphs:write</code>,{' '}
            <code>runs:external_execute</code>, and <code>runs:write_results</code>. Settings shows
            its purpose, scopes, last-used time, and revoked state so it can be audited or rotated
            from a phone.
          </p>

          <h2>MCP Surface</h2>
          <p>
            The plugin exposes hosted MCP tools for graph editing, workflow execution, and external
            evaluator runs where Codex performs each step and writes results back.
          </p>
        </DocsProse>

        <div className="mt-6 grid gap-3">
          {toolGroups.map(([label, tools]) => (
            <div key={label} className="rounded-md border p-4">
              <h3 className="text-sm font-medium">{label}</h3>
              <p className="mt-2 break-words font-mono text-xs leading-5 text-muted-foreground">
                {tools}
              </p>
            </div>
          ))}
        </div>

        <DocsProse className="mt-8">
          <h2>Resources</h2>
          <p>
            Codex can also read graph resources for graph lists, graph detail, manifests, nodes, run
            status, external runs, and external step context.
          </p>
        </DocsProse>

        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Resource</th>
                <th className="border-b px-4 py-3 font-medium">URI</th>
              </tr>
            </thead>
            <tbody>
              {resourceRows.map(([label, uri]) => (
                <tr key={label} className="border-b last:border-b-0">
                  <td className="px-4 py-3 font-medium">{label}</td>
                  <td className="break-all px-4 py-3 font-mono text-xs text-muted-foreground">
                    {uri}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Safety</h2>
          <p>
            Destructive tools advertise destructive annotations and confirmation metadata. Clients
            should still ask before deleting graphs, deleting nodes or edges, replacing imports,
            applying destructive patches, or cancelling active runs. Use{' '}
            <code>apply_graph_patch</code> with <code>dryRun=true</code> before applying graph
            mutations.
          </p>

          <h2>Verify</h2>
          <p>
            After installation, start a fresh Codex thread and ask it to run{' '}
            <code>diagnose_breakdown_setup</code>, then list Breakdown graphs. That exercises the
            Git marketplace package, persistent token availability, hosted MCP connection,{' '}
            <code>tools/list</code>, external-evaluator tool discovery, and a read-only graph path.
          </p>
          <CodeBlock>{`python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py plugins/breakdown
pnpm exec vitest run src/lib/mcp/codex-plugin-release.test.ts src/app/api/mcp/route.test.ts
pnpm lint
pnpm typecheck`}</CodeBlock>

          <h2>Direct Hosted MCP</h2>
          <p>Use this path when a client does not need the packaged Codex plugin.</p>
          <CodeBlock>{`[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"`}</CodeBlock>
          <p>
            For the full setup-session flow, see <Link href="/mcp">MCP Access</Link>.
          </p>

          <h2>Local Or Self-Hosted Override</h2>
          <p>
            The committed plugin config always points at the hosted MCP endpoint. For local
            development, do not edit and commit <code>plugins/breakdown/.mcp.json</code>.
          </p>
          <p>Prefer direct MCP config while developing the app:</p>
          <CodeBlock>{`[mcp_servers.breakdown]
url = "http://localhost:3000/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"`}</CodeBlock>
          <p>
            For plugin packaging tests, create a throwaway copy of <code>plugins/breakdown</code>.
            Change that copy&apos;s <code>.mcp.json</code> to localhost, and install the throwaway
            marketplace entry.
          </p>

          <h2>Troubleshooting</h2>
          <p>
            <code>diagnose_breakdown_setup</code> is missing means the plugin or MCP server is not
            installed, enabled, or loaded in this Codex session. Install or enable the plugin and
            start a new Codex thread.
          </p>
          <p>
            <code>{'state: "missing_token"'}</code> means the client reached Breakdown without an
            bearer token. Create a durable MCP connection token from Settings under MCP Access, or
            create and approve an agent setup session, then persist the resulting token in the
            user-level Codex or launcher secret store. If the client cannot persist plugin auth yet,
            set <code>BREAKDOWN_API_TOKEN</code> in the environment that starts Codex.
          </p>
          <p>
            <code>{'state: "invalid_token"'}</code>, <code>{'state: "revoked_token"'}</code>, or{' '}
            <code>{'state: "expired_token"'}</code> means the token is present but cannot be used.
            Rotate or recreate the token from Settings under MCP Access.
          </p>
          <p>
            <code>403 Missing required scope</code> means the token is valid but too narrow for the
            requested tool. Create a new token with the minimum additional scope needed.{' '}
            <code>{'state: "missing_scope"'}</code> lists the exact missing scopes.
          </p>
          <p>
            If Codex cannot see the plugin after install or update, start a new thread so Codex
            reloads plugin skills and MCP server definitions.
          </p>
        </DocsProse>
      </article>
    </main>
  );
}

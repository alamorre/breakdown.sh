import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'Codex Plugin | breakdown.sh',
  description: 'Use the repo-local breakdown.sh Codex plugin with scoped MCP access.',
};

const pluginFiles = [
  ['Plugin manifest', 'plugins/breakdown/.codex-plugin/plugin.json'],
  ['MCP config', 'plugins/breakdown/.mcp.json'],
  ['Bundled skills', 'plugins/breakdown/skills/'],
  ['Marketplace entry', '.agents/plugins/marketplace.json'],
];

const remainingWork = [
  'Finalize marketplace naming, icon, screenshots, and release metadata.',
  'Verify remote MCP behavior in a fresh Codex profile.',
  'Decide whether hosted OAuth connector registration should replace bearer-token setup later.',
  'Submit or distribute through any hosted Codex marketplace, if one is desired.',
];

export default function CodexPluginDocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
        <header className="border-b pb-8">
          <Link
            href="/docs"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Docs
          </Link>
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Codex Plugin</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Breakdown includes a repo-local Codex plugin scaffold that connects Codex to reasoning
            graphs through scoped MCP access and bundles project-specific development workflows.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>What Exists</h2>
          <p>
            The plugin lives in this repository and is intended for local development, testing, and
            the first public marketplace pass. It is not yet published to a hosted Codex
            marketplace.
          </p>
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
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{label}</td>
                  <td className="break-all px-4 py-3 font-mono text-xs text-muted-foreground">
                    {path}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Authentication</h2>
          <p>
            Create a token from <Link href="/settings">Settings</Link> under MCP Access, then export
            it before starting Codex. Tokens use the <code>bdk_...</code> prefix, are shown once,
            and can be scoped to the graph and run permissions the plugin needs.
          </p>
          <CodeBlock>{`export BREAKDOWN_API_TOKEN=bdk_...`}</CodeBlock>

          <h2>Install From A Local Checkout</h2>
          <p>Use this path when the Breakdown repo is already on the same machine as Codex.</p>
          <CodeBlock>{`cd /path/to/breakdown.sh
codex plugin marketplace add "$(pwd)"
codex plugin add breakdown@breakdown`}</CodeBlock>
          <p>
            The marketplace command points Codex at this repository. The plugin install command
            installs the <code>breakdown</code> plugin from the <code>breakdown</code> marketplace
            declared in <code>.agents/plugins/marketplace.json</code>.
          </p>

          <h2>Install From Git</h2>
          <p>
            After the plugin has merged to <code>main</code>, a Codex user can install the
            marketplace directly from Git without cloning the full repo first.
          </p>
          <CodeBlock>{`codex plugin marketplace add alamorre/breakdown.sh --ref main --sparse .agents/plugins --sparse plugins/breakdown
codex plugin add breakdown@breakdown`}</CodeBlock>
          <p>
            The sparse paths fetch the marketplace manifest and plugin source directory. Use a
            branch or tag instead of <code>main</code> while testing unreleased changes.
          </p>

          <h2>MCP Endpoint</h2>
          <p>The repo-local plugin defaults to the hosted Streamable HTTP MCP endpoint.</p>
          <CodeBlock>{`https://www.breakdown.sh/api/mcp`}</CodeBlock>
          <p>
            Coding agents that support MCP but do not use Codex plugins can connect directly to the
            same endpoint. Use the MCP configuration examples on <Link href="/mcp">MCP Access</Link>{' '}
            with the same <code>BREAKDOWN_API_TOKEN</code> value.
          </p>

          <h2>Connect Codex</h2>
          <ol>
            <li>Sign in to Breakdown and create an MCP Access token.</li>
            <li>
              Choose the narrowest scopes the agent needs, such as <code>graphs:read</code> for
              read-only use or graph and run scopes for editing and execution.
            </li>
            <li>
              Export the token as <code>BREAKDOWN_API_TOKEN</code> before starting Codex.
            </li>
            <li>Install the plugin from the local checkout or Git marketplace.</li>
            <li>Start a new Codex thread so the plugin skills and MCP server are loaded.</li>
            <li>Ask Codex to list Breakdown graphs or turn a goal into a Breakdown DAG.</li>
          </ol>

          <h2>Local App Development</h2>
          <p>For local app development, run the app and use a local token.</p>
          <CodeBlock>{`pnpm dev
export BREAKDOWN_API_TOKEN=bdk_...`}</CodeBlock>
          <p>
            Then point the agent at <code>http://localhost:3000/api/mcp</code>. For a one-off Codex
            session, use the direct MCP configuration from <Link href="/mcp">MCP Access</Link>; for
            plugin testing, make an uncommitted local edit to{' '}
            <code>plugins/breakdown/.mcp.json</code> and switch the URL back before committing.
          </p>

          <h2>Verify</h2>
          <ol>
            <li>Ask Codex to list available Breakdown tools or list graphs.</li>
            <li>
              Confirm tools such as <code>list_graphs</code>, <code>get_graph</code>,{' '}
              <code>create_external_run</code>, and <code>submit_step_result</code> are available.
            </li>
            <li>Use a low-risk read-only graph action before granting write or run scopes.</li>
          </ol>
          <CodeBlock>{`pnpm headless:verify
pnpm --filter @breakdown/mcp build`}</CodeBlock>

          <h2>Remaining Product Work</h2>
          <ul>
            {remainingWork.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>
            Track the public plugin release in{' '}
            <a href="https://github.com/alamorre/breakdown.sh/issues/74">GitHub issue #74</a>.
          </p>
        </DocsProse>
      </article>
    </main>
  );
}

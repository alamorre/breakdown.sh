import type { Metadata } from 'next';
import Link from 'next/link';

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
  'Publish installation and update docs for Codex users outside this checkout.',
  'Finalize marketplace naming, icon, screenshots, and release metadata.',
  'Add onboarding copy for creating and exporting BREAKDOWN_API_TOKEN.',
  'Verify remote MCP behavior in a fresh Codex profile.',
  'Decide whether hosted OAuth connector registration should replace bearer-token setup later.',
];

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border bg-muted/40 p-4 text-sm leading-6">
      <code>{children}</code>
    </pre>
  );
}

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

        <div className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
          <h2>What Exists</h2>
          <p>
            The plugin lives in this repository and is intended for local development, testing, and
            the first public marketplace pass.
          </p>
        </div>

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

        <div className="prose prose-neutral mt-8 max-w-none dark:prose-invert">
          <h2>Authentication</h2>
          <p>
            Create a token from <Link href="/settings">Settings</Link> under MCP Access, then export
            it before starting Codex. Tokens use the <code>bdk_...</code> prefix, are shown once,
            and can be scoped to the graph and run permissions the plugin needs.
          </p>
          <CodeBlock>{`export BREAKDOWN_API_TOKEN=bdk_...`}</CodeBlock>

          <h2>MCP Endpoint</h2>
          <p>The repo-local plugin defaults to the hosted Streamable HTTP MCP endpoint.</p>
          <CodeBlock>{`https://www.breakdown.sh/api/mcp`}</CodeBlock>
          <p>
            For local development, run the app with <code>pnpm dev</code> and temporarily point the
            plugin MCP URL at <code>http://localhost:3000/api/mcp</code>.
          </p>

          <h2>Try It</h2>
          <ol>
            <li>Create and export a scoped Breakdown token.</li>
            <li>Install or view the repo-local plugin from the marketplace entry.</li>
            <li>Ask Codex to list Breakdown graphs or turn a goal into a Breakdown DAG.</li>
            <li>
              Use <Link href="/mcp">MCP Access</Link> for the full tool, scope, and external-run
              reference.
            </li>
          </ol>

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
        </div>
      </article>
    </main>
  );
}

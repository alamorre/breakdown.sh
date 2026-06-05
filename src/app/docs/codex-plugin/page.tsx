import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsBreadcrumb } from '@/components/docs/DocsBreadcrumb';
import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'Codex Plugin | breakdown.sh',
  description: 'Hosted MCP, future plugin, and repo-local Codex plugin setup for breakdown.sh.',
};

const integrationPaths = [
  [
    'Default',
    'Direct hosted MCP/API',
    'Use setup sessions and https://www.breakdown.sh/api/mcp from any project. No Breakdown checkout is needed.',
  ],
  [
    'Optional',
    'Public Codex plugin',
    'Use the hosted plugin path after marketplace packaging ships. Track that work in issue #74.',
  ],
  [
    'Contributor only',
    'Repo-local plugin scaffold',
    'Use local checkout or sparse Git install only when developing Breakdown or testing plugin packaging.',
  ],
];

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
          <DocsBreadcrumb />
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Codex Plugin</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Codex can use Breakdown directly through hosted MCP today. The repo-local plugin
            scaffold is for contributors and packaging tests, not the default path for agents
            running in another project.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>Choose The Right Path</h2>
          <p>
            If your goal is to use Breakdown from Codex or another coding agent, start with direct
            hosted MCP/API. Do not clone or sparse-install the Breakdown repo unless you are working
            on Breakdown itself, self-hosting it, or validating plugin packaging.
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
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{label}</td>
                  <td className="px-4 py-3">{name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Default: Connect Directly To Hosted MCP</h2>
          <ol>
            <li>
              Create an agent setup session at{' '}
              <code>https://www.breakdown.sh/api/integrations/agent-setup-sessions</code>.
            </li>
            <li>Open the returned approval URL while signed in to Breakdown.</li>
            <li>Verify the setup code and approve the requested scopes.</li>
            <li>
              Exchange the setup secret for a scoped <code>bdk_...</code> token.
            </li>
            <li>
              Configure Codex or another MCP-capable client with{' '}
              <code>https://www.breakdown.sh/api/mcp</code>.
            </li>
          </ol>
          <CodeBlock>{`[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"`}</CodeBlock>
          <p>
            Set <code>BREAKDOWN_API_TOKEN</code> to the approved token before starting the client.
            For the full setup-session flow, see <Link href="/mcp">MCP Access</Link>.
          </p>

          <h2>Authentication</h2>
          <p>
            Codex can create an agent setup session, ask the signed-in user to approve it in
            Breakdown, then exchange the setup secret for a scoped <code>bdk_...</code> token. The
            user does not need to copy the raw token.
          </p>
          <CodeBlock>{`curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \\
  -H "Content-Type: application/json" \\
  -d '{"clientName":"Codex","providerName":"OpenAI"}'`}</CodeBlock>
          <p>
            Open the returned approval URL, verify the setup code, then exchange the returned setup
            secret at the returned exchange URL. Manual token creation from{' '}
            <Link href="/settings">Settings</Link> under MCP Access remains available as a fallback.
          </p>

          <h2>Optional: Public Codex Plugin</h2>
          <p>
            The public plugin path is not yet shipped. Once it is published, it should wrap the same
            hosted MCP endpoint and setup-session flow so agents can connect without cloning this
            repository.
          </p>
          <p>
            Track the public plugin release in{' '}
            <a href="https://github.com/alamorre/breakdown.sh/issues/74">GitHub issue #74</a>.
          </p>

          <h2>Contributor Only: Repo-Local Plugin</h2>
          <p>
            The scaffold in this repository is useful for local development, testing, and the first
            marketplace packaging pass. These files are not required for normal Breakdown service
            usage.
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
          <h2>Install From A Local Checkout</h2>
          <p>
            Use this only when the Breakdown repo is already on the same machine because you are
            changing or testing Breakdown.
          </p>
          <CodeBlock>{`cd /path/to/breakdown.sh
codex plugin marketplace add "$(pwd)"
codex plugin add breakdown@breakdown`}</CodeBlock>

          <h2>Install From Git For Plugin Testing</h2>
          <p>
            Sparse Git install fetches only the marketplace manifest and plugin source directory. It
            is for plugin packaging tests, not the default hosted integration path.
          </p>
          <CodeBlock>{`codex plugin marketplace add alamorre/breakdown.sh --ref main --sparse .agents/plugins --sparse plugins/breakdown
codex plugin add breakdown@breakdown`}</CodeBlock>

          <h2>Local App Development</h2>
          <p>
            For local app development, run the app and point the client at the local MCP endpoint.
          </p>
          <CodeBlock>{`pnpm dev
export BREAKDOWN_API_TOKEN=bdk_...`}</CodeBlock>
          <p>
            Then use <code>http://localhost:3000/api/mcp</code>. For plugin testing, make an
            uncommitted local edit to <code>plugins/breakdown/.mcp.json</code> and switch the URL
            back before committing.
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

          <h2>Troubleshooting</h2>
          <p>
            <code>401 Missing bearer token</code> means the client reached Breakdown without an
            approved token. Create and approve a setup session or set{' '}
            <code>BREAKDOWN_API_TOKEN</code>; do not clone the repository just to inspect plugin
            files.
          </p>

          <h2>Remaining Product Work</h2>
          <ul>
            {remainingWork.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </DocsProse>
      </article>
    </main>
  );
}

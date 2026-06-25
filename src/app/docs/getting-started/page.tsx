import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsBreadcrumb } from '@/components/docs/DocsBreadcrumb';
import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'Getting Started | breakdown.sh',
  description: 'Connect a coding agent to hosted Breakdown from any project.',
};

const setupRows = [
  ['Discovery metadata', 'GET https://www.breakdown.sh/api'],
  ['Agent onboarding', 'GET https://www.breakdown.sh/api/integrations/headless-onboarding'],
  ['Setup sessions', 'POST https://www.breakdown.sh/api/integrations/agent-setup-sessions'],
  ['Codex diagnostics', 'GET https://www.breakdown.sh/api/integrations/codex/diagnostics'],
  ['Remote MCP', 'https://www.breakdown.sh/api/mcp'],
  ['Headless REST', 'https://www.breakdown.sh/api/headless'],
];

export default function GettingStartedPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
        <header className="border-b pb-8">
          <DocsBreadcrumb />
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Getting Started</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Connect a coding agent to hosted Breakdown from any project. You do not need a Breakdown
            source checkout for normal MCP or headless REST usage.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>Default Path For Coding Agents</h2>
          <p>
            Breakdown is a hosted reasoning workflow service for agents running in other codebases.
            Agents should use a durable scoped <code>bdk_...</code> token from MCP Access, or create
            a short-lived approval session that exchanges into the same token type, then connect to
            the hosted MCP or REST APIs.
          </p>
          <p>
            Clone this repository only when you are contributing to Breakdown, self-hosting it, or
            testing Codex plugin packaging.
          </p>
        </DocsProse>

        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Surface</th>
                <th className="border-b px-4 py-3 font-medium">Endpoint</th>
              </tr>
            </thead>
            <tbody>
              {setupRows.map(([label, endpoint]) => (
                <tr key={label} className="border-b last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{label}</td>
                  <td className="break-all px-4 py-3 font-mono text-xs text-muted-foreground">
                    {endpoint}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Quickstart</h2>
          <ol>
            <li>Start in your own repo, terminal, or agent console.</li>
            <li>
              Read public discovery metadata from <code>GET /api</code> or{' '}
              <code>GET /api/integrations/headless-onboarding</code>.
            </li>
            <li>
              Use a durable connection from MCP Client Connections in <code>/settings</code>, or
              create an agent setup session.
            </li>
            <li>
              For setup sessions, ask the signed-in human to open the approval URL and verify the
              setup code.
            </li>
            <li>
              After approval, exchange the setup secret for the scoped <code>bdk_...</code> token.
            </li>
            <li>
              Persist the token in the host client or user-level launcher secret store that starts
              the agent.
            </li>
            <li>
              Run <code>diagnose_breakdown_setup</code> or{' '}
              <code>GET /api/integrations/codex/diagnostics</code> to confirm token, scopes, and
              external-evaluator tool readiness.
            </li>
            <li>
              Connect MCP at <code>https://www.breakdown.sh/api/mcp</code> or use REST under{' '}
              <code>https://www.breakdown.sh/api/headless</code>.
            </li>
            <li>
              Persist graphs, reasoning steps, citations, blocked data gaps, and external-run state
              in Breakdown.
            </li>
          </ol>

          <h2>Create A Durable Client Connection</h2>
          <p>
            For persistent clients, sign in to Breakdown, open{' '}
            <Link href="/settings">Settings</Link>, and use MCP Client Connections under MCP Access
            to create a named connection for the client. Copy the raw <code>bdk_...</code> token
            when it is shown; it is displayed once. The token remains valid until revoked, rotated,
            or until its optional expiry.
          </p>

          <h2>Create A Setup Session</h2>
          <p>
            A setup session lets an agent request access without asking the user to paste a raw
            token into the chat. The setup session expires quickly, but the exchanged token is a
            durable integration token unless an expiry was configured.
          </p>
          <CodeBlock>{`curl https://www.breakdown.sh/api/integrations/agent-setup-sessions \\
  -H "Content-Type: application/json" \\
  -d '{"clientName":"Codex","providerName":"OpenAI"}'`}</CodeBlock>
          <p>
            The response includes an approval URL, user code, exchange URL, and exchange secret.
            Open the approval URL while signed in to Breakdown, compare the setup code, and approve
            the requested scopes.
          </p>
          <CodeBlock>{`curl "$EXCHANGE_URL" \\
  -H "Content-Type: application/json" \\
  -d "{\\"exchangeSecret\\":\\"$EXCHANGE_SECRET\\"}"`}</CodeBlock>
          <p>
            The exchange response returns the raw token once. Store it in the host client or
            user-level launcher secret store. <code>BREAKDOWN_API_TOKEN</code> is the supported
            environment variable for clients that cannot persist plugin auth directly.
          </p>
          <p>
            For Codex Desktop fallback setup, put the MCP server reference in{' '}
            <code>~/.codex/config.toml</code> on macOS/Linux or{' '}
            <code>%USERPROFILE%\.codex\config.toml</code> on Windows, and store the raw token in the
            OS user environment. On macOS, use{' '}
            <code>~/Library/LaunchAgents/sh.breakdown.codex-env.plist</code>. On Linux, use{' '}
            <code>~/.config/environment.d/breakdown-codex.conf</code>. On Windows, use{' '}
            <code>HKEY_CURRENT_USER\Environment</code> with value name{' '}
            <code>BREAKDOWN_API_TOKEN</code>.
          </p>

          <h2>Connect MCP</h2>
          <p>Use the hosted Streamable HTTP MCP endpoint with bearer-token authentication.</p>
          <CodeBlock>{`[mcp_servers.breakdown]
url = "https://www.breakdown.sh/api/mcp"
bearer_token_env_var = "BREAKDOWN_API_TOKEN"`}</CodeBlock>

          <h2>Use Headless REST</h2>
          <p>The headless REST API uses the same token and scopes as MCP.</p>
          <CodeBlock>{`curl https://www.breakdown.sh/api/headless/graphs \\
  -H "Authorization: Bearer $BREAKDOWN_API_TOKEN" \\
  -H "Accept: application/json"`}</CodeBlock>

          <h2>External Evaluator Runs</h2>
          <p>
            Use external-evaluator mode when your host agent should do the model work with its own
            tools and connectors while Breakdown stores the workflow state. If a step needs current
            data, market data, web search, workspace files, or another connector the host agent does
            not have, mark the step blocked instead of fabricating an answer.
          </p>

          <h2>Troubleshooting</h2>
          <p>
            Run <code>diagnose_breakdown_setup</code> from MCP or call{' '}
            <code>GET /api/integrations/codex/diagnostics</code> for a machine-readable setup state.
            Missing, invalid, revoked, expired, and under-scoped tokens are reported separately.
          </p>
          <p>
            <code>401 Missing bearer token</code> means the request reached Breakdown but did not
            include a token. Create a durable connection from MCP Client Connections in{' '}
            <code>/settings</code>, or create and approve a setup session, exchange it for a{' '}
            <code>bdk_...</code> token, and persist it before retrying. It does not mean the agent
            should clone this repository.
          </p>
          <p>
            For MCP details, scopes, tool names, and REST metadata, see{' '}
            <Link href="/mcp">MCP Access</Link>. For contributor setup, see{' '}
            <Link href="/docs/local-development">Local Development</Link>.
          </p>
        </DocsProse>
      </article>
    </main>
  );
}

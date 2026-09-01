import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsBreadcrumb } from '@/components/docs/DocsBreadcrumb';
import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'Operator Deployment | breakdown.sh',
  description: 'Self-hosting and operator environment notes for breakdown.sh.',
};

const requiredVariables = [
  ['Clerk', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY, sign-in and sign-up URLs'],
  [
    'Supabase',
    'NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY',
  ],
  ['Stored integration credentials', 'INTEGRATION_TOKEN_ENCRYPTION_KEY'],
  [
    'Google Drive',
    'GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY, NEXT_PUBLIC_GOOGLE_DRIVE_APP_ID',
  ],
];

export default function DeploymentDocsPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
        <header className="border-b pb-8">
          <DocsBreadcrumb />
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Operator Deployment</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Use this when you are self-hosting Breakdown, operating a deployment, or contributing to
            the app. These secrets are not required to connect an external agent to hosted
            Breakdown. Canonical direction is <Link href="/docs/roadmap">Roadmap</Link> and ADR 0004:
            Breakdown Local is the 1.0+ product and secrets are file-local only.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>Who Needs This</h2>
          <p>
            Hosted service users and off-repo coding agents should use{' '}
            <code>https://www.breakdown.sh/api/mcp</code>, setup sessions, and scoped Bearer tokens.
            This page is for operators who manage the Breakdown app infrastructure.
          </p>

          <h2>Secrets Source Of Truth</h2>
          <p>
            Keep <code>.env.local.example</code> as the variable inventory. Real values should live
            in untracked local files (<code>.env.local</code>) and be injected as standard env vars.
            No Doppler and no Vercel env sync are required for ordinary development or for Breakdown
            Local — see <Link href="/docs/roadmap">Roadmap</Link> and{' '}
            <Link href="/docs/secrets-management">Secrets Management (file-local)</Link>.
          </p>

          <h2>Recommended Configs</h2>
          <p>
            For self-hosting the SaaS app, a straightforward setup is one host with separate
            environment values for local development, preview deployments, and production — managed in
            your hosting env store or chosen secrets manager, not via a required Doppler sync.
          </p>
        </DocsProse>

        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Group</th>
                <th className="border-b px-4 py-3 font-medium">Variables</th>
              </tr>
            </thead>
            <tbody>
              {requiredVariables.map(([group, variables]) => (
                <tr key={group} className="border-b last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{group}</td>
                  <td className="px-4 py-3 font-mono text-xs leading-5 text-muted-foreground">
                    {variables}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Integration Token Encryption</h2>
          <p>
            <code>INTEGRATION_TOKEN_ENCRYPTION_KEY</code> must decode to 32 bytes. Generate a value
            for each environment and store it only in that environment&apos;s env store.
          </p>
          <CodeBlock>{`openssl rand -base64 32`}</CodeBlock>

          <h2>Local Development</h2>
          <CodeBlock>{`cp .env.local.example .env.local
# edit .env.local
pnpm secrets:check
pnpm dev`}</CodeBlock>
          <p className="mt-2 text-sm text-muted-foreground">
            No <code>doppler setup</code> required. See{' '}
            <Link href="/docs/local-development">Local Development</Link> for the file-local flow.
          </p>

          <h2>Hosted Deployment</h2>
          <ol>
            <li>Set preview/production env vars in your hosting env store (Vercel dashboard, Doppler, Vault, 1Password, or plain env).</li>
            <li>
              Redeploy after changing any build-time <code>NEXT_PUBLIC_*</code> value.
            </li>
            <li>Run a smoke test for the affected integration after each rotation.</li>
          </ol>

          <h2>Credential Rules</h2>
          <ul>
            <li>Do not commit real secrets.</li>
            <li>Do not maintain duplicate manual values in the hosting dashboard.</li>
            <li>User-managed AI provider API keys belong in app settings, not shared env vars.</li>
            <li>Rotate upstream credentials after replacing them in the host env store.</li>
          </ul>

          <h2>Hosted-Legacy Appendix (Self-Host Only)</h2>
          <p>
            Operators who previously used Doppler may still sync a Doppler project (e.g.{' '}
            <code>breakdown-sh</code> / <code>dev</code>, <code>stg</code>, <code>prd</code>) to
            Vercel via Doppler&apos;s Vercel integration. That path is{' '}
            <strong>hosted-legacy / self-host only</strong> and is not required for Breakdown Local.
            The canonical retired artifacts were <code>doppler.yaml</code> and{' '}
            <code>dev:secrets</code> / <code>build:secrets</code> / <code>start:secrets</code> /{' '}
            <code>ci:secrets</code> (
            <code>doppler run -- ...</code>) and the{' '}
            <code>dopplerhq/secrets-fetch-action</code> OIDC step in{' '}
            <code>supabase-migrations.yml</code> — all removed or replaced in #205. See{' '}
            <Link href="/docs/secrets-management">Secrets Management — Appendix A</Link>.
          </p>
        </DocsProse>
      </article>
    </main>
  );
}

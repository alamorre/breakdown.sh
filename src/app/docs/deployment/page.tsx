import type { Metadata } from 'next';

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
            Breakdown.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>Who Needs This</h2>
          <p>
            Hosted service users and off-repo coding agents should use{' '}
            <code>https://www.breakdown.sh/api/mcp</code>, setup sessions, and scoped bearer tokens.
            This page is for operators who manage the Breakdown app infrastructure.
          </p>

          <h2>Secrets Source Of Truth</h2>
          <p>
            Keep <code>.env.local.example</code> as the variable inventory. Real values should live
            in Doppler or an equivalent secrets manager, then sync into the hosting environment.
          </p>

          <h2>Recommended Configs</h2>
          <p>
            A straightforward setup is one project with separate <code>dev</code>, <code>stg</code>,
            and <code>prd</code> configs for local development, preview deployments, and production.
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
            for each environment and store it only in the secrets manager.
          </p>
          <CodeBlock>{`openssl rand -base64 32`}</CodeBlock>

          <h2>Local Development</h2>
          <CodeBlock>{`doppler setup
doppler run -- pnpm secrets:check
pnpm dev:secrets`}</CodeBlock>

          <h2>Hosted Deployment</h2>
          <ol>
            <li>Sync preview deployments from the staging secrets config.</li>
            <li>Sync production deployments from the production secrets config.</li>
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
            <li>Rotate upstream credentials after replacing them in the secrets manager.</li>
          </ul>
        </DocsProse>
      </article>
    </main>
  );
}

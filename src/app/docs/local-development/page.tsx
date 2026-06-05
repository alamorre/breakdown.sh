import type { Metadata } from 'next';
import Link from 'next/link';

import { CodeBlock } from '@/components/docs/CodeBlock';
import { DocsBreadcrumb } from '@/components/docs/DocsBreadcrumb';
import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'Local Development | breakdown.sh',
  description: 'Contributor setup for running breakdown.sh locally.',
};

export default function LocalDevelopmentPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto w-full max-w-3xl px-6 py-12 sm:py-16">
        <header className="border-b pb-8">
          <DocsBreadcrumb />
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Local Development</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Use this contributor path when you are changing Breakdown, self-hosting it, or testing
            repo-local integration scaffolding. Hosted MCP and REST users should start with{' '}
            <Link href="/docs/getting-started">Getting Started</Link> instead.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>Install</h2>
          <p>
            Breakdown uses the pnpm version pinned in <code>package.json</code>. Enable Corepack,
            then install dependencies from the repo root.
          </p>
          <CodeBlock>{`corepack enable
pnpm install`}</CodeBlock>

          <h2>Configure Environment Variables</h2>
          <p>
            Use <code>.env.local.example</code> as the variable inventory. Real values should live
            in Doppler or another secrets manager rather than being committed to the repo.
          </p>
          <p>
            For the standard local workflow, install Doppler, authenticate, bind the repo to the
            development config, and run the app through Doppler.
          </p>
          <CodeBlock>{`brew install gnupg
brew install dopplerhq/cli/doppler
doppler login
doppler setup
pnpm dev:secrets`}</CodeBlock>

          <h2>Run The App</h2>
          <p>
            Open <a href="http://localhost:3000">http://localhost:3000</a> after the dev server
            starts. Use the sign-in flow to reach the dashboard and graph editor.
          </p>

          <h2>Useful Checks</h2>
          <p>Before sending changes for review, run the focused checks for the work you touched.</p>
          <CodeBlock>{`pnpm lint
pnpm typecheck
pnpm test
pnpm build`}</CodeBlock>

          <h2>Package Security</h2>
          <p>
            Dependency resolution uses pnpm with a seven-day release cooldown. Run the high-severity
            audit before dependency changes.
          </p>
          <CodeBlock>{`pnpm run audit:high`}</CodeBlock>

          <p>
            See <Link href="/docs/deployment">Operator Deployment</Link> for the fuller self-hosting
            and production setup model.
          </p>
        </DocsProse>
      </article>
    </main>
  );
}

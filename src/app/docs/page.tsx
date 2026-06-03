import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Docs | breakdown.sh',
  description: 'Public documentation for breakdown.sh setup, integrations, and MCP access.',
};

const docs = [
  {
    href: '/docs/getting-started',
    title: 'Getting Started',
    description: 'Install dependencies, run Breakdown locally, and understand the dev workflow.',
  },
  {
    href: '/mcp',
    title: 'MCP Access',
    description: 'Connect MCP-capable AI clients to Breakdown with scoped bearer tokens.',
  },
  {
    href: '/docs/google-drive',
    title: 'Google Drive Sources',
    description: 'Use selected Docs, Sheets, and Presentations as graph source material.',
  },
  {
    href: '/docs/deployment',
    title: 'Deployment And Secrets',
    description: 'Set up environment variables, Doppler, Vercel sync, and production checks.',
  },
  {
    href: '/docs/product',
    title: 'Product Model',
    description: 'Learn how Breakdown structures reasoning as a directed analysis graph.',
  },
];

const visibilityRows = [
  [
    'Public',
    'User setup, MCP access, Google Drive usage, deployment templates, and product model.',
  ],
  [
    'Public after review',
    'Operational runbooks that need hostnames, credentials, or stale notes generalized.',
  ],
  [
    'Internal',
    'Temporary implementation plans, private project notes, and deprecated migration details.',
  ],
];

export default function DocsPage() {
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
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Docs</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            Public documentation for building, connecting, deploying, and understanding Breakdown.
            These pages collect the useful docs from the private repo into routes that signed-out
            visitors can read.
          </p>
        </header>

        <section className="mt-8 grid gap-4 sm:grid-cols-2">
          {docs.map((doc) => (
            <Link
              key={doc.href}
              href={doc.href}
              className="rounded-md border p-5 transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <h2 className="text-base font-medium">{doc.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{doc.description}</p>
            </Link>
          ))}
        </section>

        <section className="prose prose-neutral mt-10 max-w-none dark:prose-invert">
          <h2>Docs Visibility</h2>
          <p>
            New documentation should be public by default when it helps users, contributors,
            integrators, or self-hosters. Keep docs internal only when they include sensitive
            operational details or short-lived implementation notes.
          </p>
        </section>

        <div className="mt-4 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Visibility</th>
                <th className="border-b px-4 py-3 font-medium">Use For</th>
              </tr>
            </thead>
            <tbody>
              {visibilityRows.map(([visibility, useFor]) => (
                <tr key={visibility} className="border-b last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{visibility}</td>
                  <td className="px-4 py-3 text-muted-foreground">{useFor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>
    </main>
  );
}

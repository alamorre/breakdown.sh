import type { Metadata } from 'next';
import Link from 'next/link';

import { DocsBreadcrumb } from '@/components/docs/DocsBreadcrumb';
import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'Docs | breakdown.sh',
  description: 'Public documentation for hosted Breakdown integrations, MCP access, and operators.',
};

const docs = [
  {
    href: '/docs/getting-started',
    title: 'Getting Started',
    description: 'Connect an off-repo coding agent to hosted Breakdown with MCP or headless REST.',
  },
  {
    href: '/mcp',
    title: 'MCP Access',
    description: 'Configure remote Streamable HTTP MCP, scopes, setup sessions, and REST metadata.',
  },
  {
    href: '/docs/codex-plugin',
    title: 'Codex Plugin',
    description:
      'Compare direct hosted MCP, the future public plugin path, and local plugin testing.',
  },
  {
    href: '/docs/google-drive',
    title: 'Google Drive Sources',
    description: 'Use selected Docs, Sheets, and Presentations as graph source material.',
  },
  {
    href: '/docs/product',
    title: 'Product Model',
    description: 'Learn how Breakdown structures reasoning as a directed analysis graph.',
  },
  {
    href: '/docs/local-development',
    title: 'Local Development',
    description: 'Contributor setup for running, testing, and changing the Breakdown app locally.',
  },
  {
    href: '/docs/deployment',
    title: 'Operator Deployment',
    description:
      'Self-hosting and operator notes for env vars, Doppler, Vercel, and production checks.',
  },
];

const visibilityRows = [
  [
    'Public',
    'Hosted service usage, MCP access, Google Drive usage, integration setup, and product model.',
  ],
  [
    'Contributor or operator',
    'Local development, self-hosting, deployment templates, and repo-local plugin testing.',
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
          <DocsBreadcrumb />
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Docs</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-muted-foreground">
            Public documentation for connecting agents to hosted Breakdown, using integrations, and
            understanding the product model. Local development and deployment pages are for
            contributors, self-hosters, and operators, not the default path for external agents.
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

        <DocsProse className="mt-10">
          <h2>Docs Visibility</h2>
          <p>
            New documentation should be public by default when it helps users, contributors,
            integrators, or self-hosters. Public integration docs should lead with hosted MCP and
            REST usage from any project. Keep docs internal only when they include sensitive
            operational details or short-lived implementation notes.
          </p>
        </DocsProse>

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

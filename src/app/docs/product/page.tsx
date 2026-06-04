import type { Metadata } from 'next';
import Link from 'next/link';

import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'Product Model | breakdown.sh',
  description: 'How Breakdown models reasoning graphs, source nodes, and analysis runs.',
};

const nodeTypes = [
  [
    'Sources',
    'External material such as Google Drive files, web pages, pasted text, or imported data.',
  ],
  [
    'Analysis steps',
    'Prompted reasoning units that consume upstream outputs and produce generated results.',
  ],
  ['Compositions', 'Higher-level conclusions or decisions assembled from upstream analysis.'],
];

const edgeTypes = [
  ['supports', 'An upstream result strengthens the downstream analysis.'],
  ['contradicts', 'An upstream result weakens or challenges the downstream analysis.'],
  ['depends_on', 'A downstream step requires the upstream result to remain valid.'],
  ['assumes', 'A downstream step is predicated on an upstream assumption.'],
  ['inputs_to', 'An upstream output is direct context for downstream work.'],
];

export default function ProductDocsPage() {
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
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Product Model</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Breakdown is a node-based reasoning canvas. Users structure source material and analysis
            steps as a directed graph, then run nodes in context.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>Core Idea</h2>
          <p>
            Instead of leaving research scattered across chat threads and documents, Breakdown turns
            a reasoning process into connected nodes. Source nodes hold material, analysis nodes
            transform upstream context, and edges describe how results should flow.
          </p>

          <h2>Why A Graph</h2>
          <p>
            Many decisions depend on multiple assumptions, evidence streams, and sub-conclusions. A
            graph makes those dependencies visible, lets users refresh source material, and helps
            downstream analysis stay connected to what changed upstream.
          </p>

          <h2>Breadcrumb Trails</h2>
          <p>
            Breadcrumb trails show where a user is inside a graph, workflow, run, or selected node.
            They are navigation and orientation aids; edge types still carry the dependency meaning
            between nodes.
          </p>
          <p>
            See <Link href="/docs/breadcrumb-trails">Breadcrumb Trails</Link> for trail item
            mapping, expected behavior, and terminology notes.
          </p>
        </DocsProse>

        <div className="mt-8 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Node Family</th>
                <th className="border-b px-4 py-3 font-medium">Role</th>
              </tr>
            </thead>
            <tbody>
              {nodeTypes.map(([type, role]) => (
                <tr key={type} className="border-b last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{type}</td>
                  <td className="px-4 py-3 text-muted-foreground">{role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Edge Semantics</h2>
          <p>
            Edges are more than lines on the canvas. Their labels tell the runner how to frame
            upstream outputs when building the prompt context for downstream nodes.
          </p>
        </DocsProse>

        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Edge Type</th>
                <th className="border-b px-4 py-3 font-medium">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {edgeTypes.map(([type, meaning]) => (
                <tr key={type} className="border-b last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{type}</td>
                  <td className="px-4 py-3 text-muted-foreground">{meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>External Agents</h2>
          <p>
            Breakdown can also act as a headless graph layer. External AI clients can connect over
            MCP, inspect graph structure, run workflows, and submit results while keeping their own
            connector and model environment.
          </p>
          <p>
            See <Link href="/mcp">MCP Access</Link> for connection details.
          </p>
        </DocsProse>
      </article>
    </main>
  );
}

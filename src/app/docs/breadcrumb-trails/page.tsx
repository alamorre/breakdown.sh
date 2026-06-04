import type { Metadata } from 'next';
import Link from 'next/link';

import { DocsProse } from '@/components/docs/DocsProse';

export const metadata: Metadata = {
  title: 'Breadcrumb Trails | breakdown.sh',
  description: 'How Breakdown uses breadcrumb trails to show graph and workflow context.',
};

const contextRows = [
  [
    'Graph',
    'The reasoning graph that contains the current work.',
    'The graph name shown on the canvas or in a workflow manifest.',
  ],
  [
    'Workflow or run',
    'The execution context being reviewed, such as Run All or an external-evaluator run.',
    'A run label, workflow label, or step sequence when execution state matters.',
  ],
  [
    'Node or step',
    'The selected source, analysis step, or composition the user is inspecting.',
    'The node name, current step name, or a fallback label when a node was removed.',
  ],
  [
    'Current view',
    'The focused panel, result, source refresh, or detail view inside that node context.',
    'A plain label such as Output, Prompt, Connections, or Source refresh.',
  ],
];

const behaviorRows = [
  ['Direction', 'Read trails left to right, from broad graph context to the current view.'],
  ['Navigation', 'Linked items return to the broader graph, run, or node context.'],
  ['Current item', 'The final item names the current location and is usually not clickable.'],
  ['Long names', 'Graph and node names may truncate visually, but should still identify the item.'],
  ['Missing context', 'Deleted or unavailable nodes use a neutral fallback rather than exposing IDs.'],
];

export default function BreadcrumbTrailsDocsPage() {
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
          <h1 className="mt-4 text-3xl font-semibold tracking-normal">Breadcrumb Trails</h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
            Breadcrumb trails help users understand where the current view sits inside a graph,
            workflow, run, or selected node.
          </p>
        </header>

        <DocsProse className="mt-8">
          <h2>What A Trail Represents</h2>
          <p>
            A breadcrumb trail is a compact navigation and context label. It helps users understand
            their current location while they move between the docs, graph canvas, node details, run
            progress, and external workflow review surfaces.
          </p>
          <p>
            Breadcrumbs are not graph edges. Edges describe how outputs flow between nodes and how
            upstream results should be framed for downstream prompts. Breadcrumbs describe the
            current location from broader context to the focused view.
          </p>
        </DocsProse>

        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Trail Item</th>
                <th className="border-b px-4 py-3 font-medium">Meaning</th>
                <th className="border-b px-4 py-3 font-medium">Typical Label</th>
              </tr>
            </thead>
            <tbody>
              {contextRows.map(([item, meaning, label]) => (
                <tr key={item} className="border-b last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{item}</td>
                  <td className="px-4 py-3 text-muted-foreground">{meaning}</td>
                  <td className="px-4 py-3 text-muted-foreground">{label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Where Users Encounter Trails</h2>
          <p>
            In the product, trails appear where Breakdown needs to keep nested work readable: moving
            from the graph list into a graph, inspecting a selected node, reviewing Run All
            progress, or stepping through external-evaluator workflow context.
          </p>
          <p>
            In docs and API-facing workflow descriptions, the same terms apply. A trail should name
            the graph or workflow first, then the specific node, step, or view being discussed.
          </p>

          <h2>How To Use A Trail</h2>
          <p>
            Scan from left to right to recover context, then use any linked earlier item to return
            to a broader view. When comparing generated results, the trail should make it clear
            which graph and node produced the output before the user reads the result itself.
          </p>
          <p>
            Use the Connections panel and edge labels for dependency meaning. Use breadcrumbs for
            orientation and navigation.
          </p>
        </DocsProse>

        <div className="mt-6 overflow-hidden rounded-md border">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="border-b px-4 py-3 font-medium">Behavior</th>
                <th className="border-b px-4 py-3 font-medium">Guidance</th>
              </tr>
            </thead>
            <tbody>
              {behaviorRows.map(([behavior, guidance]) => (
                <tr key={behavior} className="border-b last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{behavior}</td>
                  <td className="px-4 py-3 text-muted-foreground">{guidance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <DocsProse className="mt-8">
          <h2>Terminology Notes</h2>
          <ul>
            <li>Use breadcrumb trail for the whole path.</li>
            <li>Use breadcrumb item for one label inside the path.</li>
            <li>Use current item for the final item in the trail.</li>
            <li>
              Keep edge language separate: <code>supports</code>, <code>contradicts</code>,{' '}
              <code>depends_on</code>, <code>assumes</code>, and <code>inputs_to</code> are edge
              types, not breadcrumb types.
            </li>
          </ul>
          <p>
            See <Link href="/docs/product">Product Model</Link> for the graph, node, and edge
            concepts that breadcrumb trails reference.
          </p>
        </DocsProse>
      </article>
    </main>
  );
}

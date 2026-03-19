import { notFound } from 'next/navigation';
import { getGraph } from '@/actions/graph-actions';
import { GraphCanvas } from '@/components/canvas/GraphCanvas';
import { GraphTopBar } from '@/components/canvas/GraphTopBar';

interface GraphPageProps {
  params: Promise<{ graphId: string }>;
}

export default async function GraphPage({ params }: GraphPageProps) {
  const { graphId } = await params;
  const { data, error } = await getGraph({ graphId });

  if (error || !data) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col">
      <GraphTopBar graphId={data.graph.id} initialName={data.graph.name} />
      <div className="flex-1">
        <GraphCanvas graph={data.graph} initialNodes={data.nodes} initialEdges={data.edges} />
      </div>
    </div>
  );
}

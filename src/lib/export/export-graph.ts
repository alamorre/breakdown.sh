import type { Graph } from '@/types/graph';
import type { CanvasNode, CanvasEdge } from '@/store/graph-store';

interface ExportedNode {
  id: string;
  name: string;
  prompt: string;
  output: string | null;
  structuredOutput: Record<string, unknown> | null;
  position: { x: number; y: number };
}

interface ExportedEdge {
  source: string;
  target: string;
  type: string;
  weight: number;
}

interface ExportedGraph {
  name: string;
  description: string | null;
  nodes: ExportedNode[];
  edges: ExportedEdge[];
  exported_at: string;
}

export function exportGraph(graph: Graph, nodes: CanvasNode[], edges: CanvasEdge[]): string {
  const exported: ExportedGraph = {
    name: graph.name,
    description: graph.description,
    nodes: nodes.map((n) => ({
      id: n.id,
      name: n.data.breakdownNode.name,
      prompt: n.data.breakdownNode.prompt,
      output: n.data.breakdownNode.output,
      structuredOutput: n.data.breakdownNode.structured_output ?? null,
      position: { x: n.position.x, y: n.position.y },
    })),
    edges: edges.map((e) => ({
      source: e.source!,
      target: e.target!,
      type: e.data.breakdownEdge.edge_type,
      weight: e.data.breakdownEdge.weight,
    })),
    exported_at: new Date().toISOString(),
  };

  return JSON.stringify(exported, null, 2);
}

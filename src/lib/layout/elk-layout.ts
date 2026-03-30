import ELK from 'elkjs/lib/elk.bundled.js';
import type { CanvasNode, CanvasEdge } from '@/store/graph-store';

const elk = new ELK();

const NODE_WIDTH = 320;
const NODE_HEIGHT = 300;

export async function computeLayout(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
): Promise<Map<string, { x: number; y: number }>> {
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.spacing.nodeNode': '80',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    })),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.source!],
      targets: [edge.target!],
    })),
  };

  const layoutResult = await elk.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();

  for (const child of layoutResult.children ?? []) {
    positions.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return positions;
}

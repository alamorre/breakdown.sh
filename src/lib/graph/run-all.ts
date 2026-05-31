import type { ThesisEdge } from '@/types/edge';
import type { ThesisNode } from '@/types/node';

interface RunAllNode {
  id: string;
  data: {
    thesisNode: Pick<ThesisNode, 'name'>;
  };
}

interface RunAllEdge {
  data: {
    thesisEdge: Pick<ThesisEdge, 'source_node_id' | 'target_node_id'>;
  };
}

export function getFailedUpstreamNodeNames(
  nodeId: string,
  edges: RunAllEdge[],
  nodes: RunAllNode[],
  failedNodeIds: Set<string>,
): string[] {
  const nodeNames = new Map(nodes.map((node) => [node.id, node.data.thesisNode.name]));

  return edges
    .filter((edge) => edge.data.thesisEdge.target_node_id === nodeId)
    .map((edge) => edge.data.thesisEdge.source_node_id)
    .filter((sourceNodeId) => failedNodeIds.has(sourceNodeId))
    .map((sourceNodeId) => nodeNames.get(sourceNodeId) ?? 'Unknown node');
}

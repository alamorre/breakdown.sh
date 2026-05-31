export interface DirectedNode {
  id: string;
}

export interface DirectedEdge {
  source: string;
  target: string;
}

interface TopologicalSortResult<TNode extends DirectedNode> {
  sortedNodes: TNode[];
  unsortedNodeIds: string[];
}

export function sortTopologically<TNode extends DirectedNode>(
  nodes: TNode[],
  edges: DirectedEdge[],
): TopologicalSortResult<TNode> {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  const nodeMap = new Map<string, TNode>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
    nodeMap.set(node.id, node);
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      continue;
    }

    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }

  const queue: string[] = [];
  for (const node of nodes) {
    if (inDegree.get(node.id) === 0) {
      queue.push(node.id);
    }
  }

  const sortedNodes: TNode[] = [];
  let queueIndex = 0;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex];
    queueIndex++;

    const node = nodeMap.get(current);
    if (node) {
      sortedNodes.push(node);
    }

    for (const neighbor of adjacency.get(current) ?? []) {
      const degree = (inDegree.get(neighbor) ?? 0) - 1;
      inDegree.set(neighbor, degree);
      if (degree === 0) {
        queue.push(neighbor);
      }
    }
  }

  const unsortedNodeIds = nodes
    .filter((node) => (inDegree.get(node.id) ?? 0) > 0)
    .map((node) => node.id);

  return { sortedNodes, unsortedNodeIds };
}

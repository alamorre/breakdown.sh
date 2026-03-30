/**
 * Detects whether adding an edge from sourceId to targetId would create a cycle.
 * Uses DFS to check if targetId can already reach sourceId through existing edges.
 */
export function wouldCreateCycle(
  edges: { source: string; target: string }[],
  sourceId: string,
  targetId: string,
): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const neighbors = adjacency.get(edge.source) ?? [];
    neighbors.push(edge.target);
    adjacency.set(edge.source, neighbors);
  }

  const visited = new Set<string>();
  const stack = [targetId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        stack.push(neighbor);
      }
    }
  }

  return false;
}

import { describe, expect, it } from 'vitest';
import { sortTopologically } from '@/lib/graph/topological-sort';

describe('sortTopologically', () => {
  it('sorts dependencies before dependents', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = sortTopologically(nodes, [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
    ]);

    expect(result.sortedNodes.map((node) => node.id)).toEqual(['a', 'b', 'c']);
    expect(result.unsortedNodeIds).toEqual([]);
  });

  it('preserves original order among unrelated ready nodes', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    const result = sortTopologically(nodes, [
      { source: 'a', target: 'd' },
      { source: 'b', target: 'd' },
    ]);

    expect(result.sortedNodes.map((node) => node.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.unsortedNodeIds).toEqual([]);
  });

  it('ignores edges that reference missing nodes', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }];
    const result = sortTopologically(nodes, [
      { source: 'missing', target: 'a' },
      { source: 'a', target: 'b' },
      { source: 'b', target: 'missing' },
    ]);

    expect(result.sortedNodes.map((node) => node.id)).toEqual(['a', 'b']);
    expect(result.unsortedNodeIds).toEqual([]);
  });

  it('reports nodes blocked by a cycle', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const result = sortTopologically(nodes, [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
      { source: 'b', target: 'c' },
    ]);

    expect(result.sortedNodes).toEqual([]);
    expect(result.unsortedNodeIds).toEqual(['a', 'b', 'c']);
  });
});

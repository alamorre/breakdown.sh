import { describe, expect, it } from 'vitest';
import { getFailedUpstreamNodeNames } from '@/lib/graph/run-all';

describe('getFailedUpstreamNodeNames', () => {
  const nodes = [
    { id: 'source-a', data: { thesisNode: { name: 'Fresh Source' } } },
    { id: 'source-b', data: { thesisNode: { name: 'Failed Source' } } },
    { id: 'analysis', data: { thesisNode: { name: 'Analysis' } } },
  ];

  const edges = [
    { data: { thesisEdge: { source_node_id: 'source-a', target_node_id: 'analysis' } } },
    { data: { thesisEdge: { source_node_id: 'source-b', target_node_id: 'analysis' } } },
  ];

  it('returns the failed upstream dependencies for a node', () => {
    expect(getFailedUpstreamNodeNames('analysis', edges, nodes, new Set(['source-b']))).toEqual([
      'Failed Source',
    ]);
  });

  it('returns an empty list when upstream dependencies succeeded', () => {
    expect(getFailedUpstreamNodeNames('analysis', edges, nodes, new Set())).toEqual([]);
  });
});

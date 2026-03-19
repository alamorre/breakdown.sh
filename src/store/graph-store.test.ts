import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGraphStore } from '@/store/graph-store';
import type { Graph } from '@/types/graph';
import { NodeType, AutonomyLevel, type ThesisNode } from '@/types/node';
import { EdgeType, type ThesisEdge } from '@/types/edge';

vi.mock('@/actions/graph-actions', () => ({
  batchUpdateNodePositions: vi.fn().mockResolvedValue({ error: null }),
}));

const mockGraph: Graph = {
  id: 'graph-1',
  user_id: 'user-1',
  name: 'Test Graph',
  description: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockNode: ThesisNode = {
  id: 'node-1',
  graph_id: 'graph-1',
  node_type: NodeType.Assumption,
  name: 'Test Assumption',
  position_x: 100,
  position_y: 200,
  conclusion: null,
  confidence: 0.5,
  evidence: [],
  assumptions: [],
  metadata: {},
  skill_doc_id: null,
  autonomy_level: AutonomyLevel.Propose,
  last_evaluated_at: null,
  evaluation_history: [],
  collapsed: false,
  color: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockEdge: ThesisEdge = {
  id: 'edge-1',
  graph_id: 'graph-1',
  source_node_id: 'node-1',
  target_node_id: 'node-2',
  edge_type: EdgeType.Supports,
  weight: 1.0,
  condition: null,
  transform: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  useGraphStore.getState().reset();
});

describe('hydrate', () => {
  it('should populate store with graph data', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode], [mockEdge]);

    const state = useGraphStore.getState();
    expect(state.graph).toEqual(mockGraph);
    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(1);
    expect(state.nodes[0].id).toBe('node-1');
    expect(state.nodes[0].position).toEqual({ x: 100, y: 200 });
    expect(state.edges[0].source).toBe('node-1');
    expect(state.edges[0].target).toBe('node-2');
  });

  it('should reset selection on hydrate', () => {
    const store = useGraphStore.getState();
    store.selectNode('node-1');
    store.hydrate(mockGraph, [], []);

    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });
});

describe('selectNode', () => {
  it('should set selectedNodeId and clear selectedEdgeId', () => {
    const store = useGraphStore.getState();
    store.selectEdge('edge-1');
    store.selectNode('node-1');

    const state = useGraphStore.getState();
    expect(state.selectedNodeId).toBe('node-1');
    expect(state.selectedEdgeId).toBeNull();
  });

  it('should clear selection when passed null', () => {
    const store = useGraphStore.getState();
    store.selectNode('node-1');
    store.selectNode(null);

    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });
});

describe('selectEdge', () => {
  it('should set selectedEdgeId and clear selectedNodeId', () => {
    const store = useGraphStore.getState();
    store.selectNode('node-1');
    store.selectEdge('edge-1');

    const state = useGraphStore.getState();
    expect(state.selectedEdgeId).toBe('edge-1');
    expect(state.selectedNodeId).toBeNull();
  });
});

describe('reset', () => {
  it('should reset store to initial state', () => {
    const store = useGraphStore.getState();
    store.hydrate(mockGraph, [mockNode], [mockEdge]);
    store.selectNode('node-1');
    store.reset();

    const state = useGraphStore.getState();
    expect(state.graph).toBeNull();
    expect(state.nodes).toHaveLength(0);
    expect(state.edges).toHaveLength(0);
    expect(state.selectedNodeId).toBeNull();
  });
});

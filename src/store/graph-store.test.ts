import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGraphStore } from '@/store/graph-store';
import type { Graph } from '@/types/graph';
import type { ThesisNode } from '@/types/node';
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
  node_type: 'default',
  name: 'Test Node',
  position_x: 100,
  position_y: 200,
  prompt: 'Analyze this data',
  output: null,
  run_status: 'idle',
  run_error: null,
  last_run_at: null,
  metadata: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

const mockNode2: ThesisNode = {
  ...mockNode,
  id: 'node-2',
  name: 'Second Node',
  position_x: 300,
  position_y: 400,
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

describe('addNode', () => {
  it('should add a node to the store', () => {
    useGraphStore.getState().hydrate(mockGraph, [], []);
    useGraphStore.getState().addNode(mockNode);

    const state = useGraphStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe('node-1');
    expect(state.nodes[0].data.thesisNode.name).toBe('Test Node');
  });
});

describe('updateNodeData', () => {
  it('should update thesis node data', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode], []);
    useGraphStore.getState().updateNodeData('node-1', { name: 'Updated', prompt: 'New prompt' });

    const state = useGraphStore.getState();
    expect(state.nodes[0].data.thesisNode.name).toBe('Updated');
    expect(state.nodes[0].data.thesisNode.prompt).toBe('New prompt');
  });

  it('should not affect other nodes', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode, mockNode2], []);
    useGraphStore.getState().updateNodeData('node-1', { name: 'Updated' });

    const state = useGraphStore.getState();
    expect(state.nodes[0].data.thesisNode.name).toBe('Updated');
    expect(state.nodes[1].data.thesisNode.name).toBe('Second Node');
  });

  it('should update metadata for data source nodes', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode], []);
    useGraphStore.getState().updateNodeData('node-1', {
      metadata: { url: 'https://example.com' },
    });

    const state = useGraphStore.getState();
    expect(state.nodes[0].data.thesisNode.metadata).toEqual({ url: 'https://example.com' });
  });
});

describe('setNodeRunState', () => {
  it('should set node to running state', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode], []);
    useGraphStore.getState().setNodeRunState('node-1', { run_status: 'running' });

    const state = useGraphStore.getState();
    expect(state.nodes[0].data.thesisNode.run_status).toBe('running');
  });

  it('should set node to success state with output', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode], []);
    useGraphStore.getState().setNodeRunState('node-1', {
      run_status: 'success',
      output: 'Generated result',
      run_error: null,
      last_run_at: '2026-01-01T12:00:00Z',
    });

    const state = useGraphStore.getState();
    expect(state.nodes[0].data.thesisNode.run_status).toBe('success');
    expect(state.nodes[0].data.thesisNode.output).toBe('Generated result');
    expect(state.nodes[0].data.thesisNode.run_error).toBeNull();
    expect(state.nodes[0].data.thesisNode.last_run_at).toBe('2026-01-01T12:00:00Z');
  });

  it('should set node to error state', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode], []);
    useGraphStore.getState().setNodeRunState('node-1', {
      run_status: 'error',
      run_error: 'API timeout',
    });

    const state = useGraphStore.getState();
    expect(state.nodes[0].data.thesisNode.run_status).toBe('error');
    expect(state.nodes[0].data.thesisNode.run_error).toBe('API timeout');
  });

  it('should preserve metadata when updating run state', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode], []);
    useGraphStore.getState().updateNodeData('node-1', {
      metadata: { url: 'https://example.com' },
    });
    useGraphStore.getState().setNodeRunState('node-1', {
      run_status: 'success',
      output: 'Fetched content',
      run_error: null,
      last_run_at: '2026-01-01T12:00:00Z',
    });

    const state = useGraphStore.getState();
    expect(state.nodes[0].data.thesisNode.metadata).toEqual({ url: 'https://example.com' });
    expect(state.nodes[0].data.thesisNode.output).toBe('Fetched content');
    expect(state.nodes[0].data.thesisNode.run_status).toBe('success');
  });
});

describe('removeNode', () => {
  it('should remove the node and connected edges', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode, mockNode2], [mockEdge]);
    useGraphStore.getState().removeNode('node-1');

    const state = useGraphStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.nodes[0].id).toBe('node-2');
    expect(state.edges).toHaveLength(0);
  });

  it('should clear selection if removed node was selected', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode], []);
    useGraphStore.getState().selectNode('node-1');
    useGraphStore.getState().removeNode('node-1');

    expect(useGraphStore.getState().selectedNodeId).toBeNull();
  });
});

describe('addEdge', () => {
  it('should add an edge to the store', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode, mockNode2], []);
    useGraphStore.getState().addEdge(mockEdge);

    const state = useGraphStore.getState();
    expect(state.edges).toHaveLength(1);
    expect(state.edges[0].source).toBe('node-1');
    expect(state.edges[0].target).toBe('node-2');
  });
});

describe('updateEdgeData', () => {
  it('should update thesis edge data', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode, mockNode2], [mockEdge]);
    useGraphStore.getState().updateEdgeData('edge-1', { edge_type: EdgeType.Contradicts });

    const state = useGraphStore.getState();
    expect(state.edges[0].data.thesisEdge.edge_type).toBe(EdgeType.Contradicts);
  });
});

describe('removeEdge', () => {
  it('should remove the edge from the store', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode, mockNode2], [mockEdge]);
    useGraphStore.getState().removeEdge('edge-1');

    expect(useGraphStore.getState().edges).toHaveLength(0);
  });

  it('should clear selection if removed edge was selected', () => {
    useGraphStore.getState().hydrate(mockGraph, [mockNode, mockNode2], [mockEdge]);
    useGraphStore.getState().selectEdge('edge-1');
    useGraphStore.getState().removeEdge('edge-1');

    expect(useGraphStore.getState().selectedEdgeId).toBeNull();
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

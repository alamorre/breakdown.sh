import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveClerkActor = vi.fn();
const mockRevalidatePath = vi.fn();
const mockCreateGraphForActor = vi.fn();
const mockListGraphsForActor = vi.fn();
const mockUpdateGraphForActor = vi.fn();
const mockDeleteGraphForActor = vi.fn();
const mockGetGraphForActor = vi.fn();
const mockUpdateNodeForActor = vi.fn();

vi.mock('@/lib/breakdown-service/actor', () => ({
  resolveClerkActor: () => mockResolveClerkActor(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock('@/lib/breakdown-service/graphs', () => ({
  createGraphForActor: (...args: unknown[]) => mockCreateGraphForActor(...args),
  listGraphsForActor: (...args: unknown[]) => mockListGraphsForActor(...args),
  updateGraphForActor: (...args: unknown[]) => mockUpdateGraphForActor(...args),
  deleteGraphForActor: (...args: unknown[]) => mockDeleteGraphForActor(...args),
  getGraphForActor: (...args: unknown[]) => mockGetGraphForActor(...args),
}));

vi.mock('@/lib/breakdown-service/nodes', () => ({
  updateNodeForActor: (...args: unknown[]) => mockUpdateNodeForActor(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveClerkActor.mockResolvedValue({
    userId: 'user_123',
    source: 'clerk-session',
    scopes: ['graphs:read', 'graphs:write', 'runs:execute'],
  });
});

describe('graph actions', () => {
  it('creates a graph through the service layer', async () => {
    const graph = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test Graph' };
    mockCreateGraphForActor.mockResolvedValue(graph);

    const { createGraph } = await import('@/actions/graph-actions');
    const result = await createGraph({ name: 'Test Graph' });

    expect(result).toEqual({ data: graph, error: null });
    expect(mockCreateGraphForActor).toHaveBeenCalledWith(expect.any(Object), {
      name: 'Test Graph',
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
  });

  it('throws when not authenticated to preserve existing server action behavior', async () => {
    mockResolveClerkActor.mockRejectedValue(new Error('Unauthorized'));

    const { createGraph } = await import('@/actions/graph-actions');
    await expect(createGraph({ name: 'Test Graph' })).rejects.toThrow('Unauthorized');
  });

  it('lists user graphs through the service layer', async () => {
    const graphs = [{ id: 'graph-1', name: 'Graph 1' }];
    mockListGraphsForActor.mockResolvedValue(graphs);

    const { getUserGraphs } = await import('@/actions/graph-actions');
    const result = await getUserGraphs();

    expect(result).toEqual({ data: graphs, error: null });
  });

  it('updates graph model through the shared update service', async () => {
    const graph = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      llm_model: 'gpt-5.4',
    };
    mockUpdateGraphForActor.mockResolvedValue(graph);

    const { updateGraphModel } = await import('@/actions/graph-actions');
    const result = await updateGraphModel('550e8400-e29b-41d4-a716-446655440000', 'gpt-5.4');

    expect(result).toEqual({ data: graph, error: null });
    expect(mockUpdateGraphForActor).toHaveBeenCalledWith(expect.any(Object), {
      graphId: '550e8400-e29b-41d4-a716-446655440000',
      llmModel: 'gpt-5.4',
    });
  });

  it('returns graph data in the existing action shape', async () => {
    const graph = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Graph',
      nodes: [{ id: 'node-1' }],
      edges: [{ id: 'edge-1' }],
    };
    mockGetGraphForActor.mockResolvedValue(graph);

    const { getGraph } = await import('@/actions/graph-actions');
    const result = await getGraph({ graphId: '550e8400-e29b-41d4-a716-446655440000' });

    expect(result.data).toEqual({
      graph: { id: graph.id, name: graph.name },
      nodes: graph.nodes,
      edges: graph.edges,
    });
  });

  it('batch-updates node positions through node service authorization', async () => {
    mockUpdateNodeForActor.mockResolvedValue({ id: 'node-1' });

    const { batchUpdateNodePositions } = await import('@/actions/graph-actions');
    const result = await batchUpdateNodePositions([
      { nodeId: '550e8400-e29b-41d4-a716-446655440001', x: 10, y: 20 },
    ]);

    expect(result.error).toBeNull();
    expect(mockUpdateNodeForActor).toHaveBeenCalledWith(expect.any(Object), {
      nodeId: '550e8400-e29b-41d4-a716-446655440001',
      positionX: 10,
      positionY: 20,
    });
  });
});

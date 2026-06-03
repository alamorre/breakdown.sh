import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveClerkActor = vi.fn();
const mockCreateEdgeForActor = vi.fn();
const mockUpdateEdgeForActor = vi.fn();
const mockDeleteEdgeForActor = vi.fn();

vi.mock('@/lib/thesis-service/actor', () => ({
  resolveClerkActor: () => mockResolveClerkActor(),
}));

vi.mock('@/lib/thesis-service/edges', () => ({
  createEdgeForActor: (...args: unknown[]) => mockCreateEdgeForActor(...args),
  updateEdgeForActor: (...args: unknown[]) => mockUpdateEdgeForActor(...args),
  deleteEdgeForActor: (...args: unknown[]) => mockDeleteEdgeForActor(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveClerkActor.mockResolvedValue({
    userId: 'user_123',
    source: 'clerk-session',
    scopes: ['graphs:read', 'graphs:write'],
  });
});

const UUID1 = '550e8400-e29b-41d4-a716-446655440001';
const UUID2 = '550e8400-e29b-41d4-a716-446655440002';
const UUID3 = '550e8400-e29b-41d4-a716-446655440003';

describe('edge actions', () => {
  it('creates an edge through the service layer', async () => {
    const edge = {
      id: UUID1,
      graph_id: UUID2,
      source_node_id: UUID2,
      target_node_id: UUID3,
      edge_type: 'supports',
    };
    mockCreateEdgeForActor.mockResolvedValue(edge);

    const { createEdge } = await import('@/actions/edge-actions');
    const result = await createEdge({
      graphId: UUID2,
      sourceNodeId: UUID2,
      targetNodeId: UUID3,
      edgeType: 'supports',
    });

    expect(result).toEqual({ data: edge, error: null });
    expect(mockCreateEdgeForActor).toHaveBeenCalledWith(expect.any(Object), {
      graphId: UUID2,
      sourceNodeId: UUID2,
      targetNodeId: UUID3,
      edgeType: 'supports',
    });
  });

  it('throws when not authenticated to preserve existing server action behavior', async () => {
    mockResolveClerkActor.mockRejectedValue(new Error('Unauthorized'));

    const { createEdge } = await import('@/actions/edge-actions');
    await expect(
      createEdge({
        graphId: UUID2,
        sourceNodeId: UUID2,
        targetNodeId: UUID3,
        edgeType: 'supports',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('updates an edge through the service layer', async () => {
    const updated = { id: UUID1, edge_type: 'contradicts' };
    mockUpdateEdgeForActor.mockResolvedValue(updated);

    const { updateEdge } = await import('@/actions/edge-actions');
    const result = await updateEdge({ edgeId: UUID1, edgeType: 'contradicts' });

    expect(result).toEqual({ data: updated, error: null });
  });

  it('deletes an edge through the service layer', async () => {
    mockDeleteEdgeForActor.mockResolvedValue(undefined);

    const { deleteEdge } = await import('@/actions/edge-actions');
    const result = await deleteEdge({ edgeId: UUID1 });

    expect(result.error).toBeNull();
    expect(mockDeleteEdgeForActor).toHaveBeenCalledWith(expect.any(Object), UUID1);
  });
});

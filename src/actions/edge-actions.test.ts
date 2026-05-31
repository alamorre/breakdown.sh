import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();

vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}));

const mockSelect = vi.fn();
const mockSingle = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();

function createChain() {
  return {
    select: mockSelect.mockReturnThis(),
    single: mockSingle,
    insert: mockInsert.mockReturnThis(),
    update: mockUpdate.mockReturnThis(),
    delete: mockDelete.mockReturnThis(),
    eq: mockEq.mockReturnThis(),
    in: mockIn,
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => createChain(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockReturnValue({ userId: 'user_123' });
  mockIn.mockReturnThis();
});

const UUID1 = '550e8400-e29b-41d4-a716-446655440001';
const UUID2 = '550e8400-e29b-41d4-a716-446655440002';
const UUID3 = '550e8400-e29b-41d4-a716-446655440003';

describe('createEdge', () => {
  it('should create an edge and return data', async () => {
    const edge = {
      id: UUID1,
      graph_id: UUID2,
      source_node_id: UUID2,
      target_node_id: UUID3,
      edge_type: 'supports',
    };
    mockSingle.mockResolvedValue({ data: edge, error: null });
    mockIn.mockResolvedValue({
      data: [
        { id: UUID2, graph_id: UUID2 },
        { id: UUID3, graph_id: UUID2 },
      ],
      error: null,
    });

    const { createEdge } = await import('@/actions/edge-actions');
    const result = await createEdge({
      graphId: UUID2,
      sourceNodeId: UUID2,
      targetNodeId: UUID3,
      edgeType: 'supports',
    });

    expect(result.data).toEqual(edge);
    expect(result.error).toBeNull();
  });

  it('should return error for invalid input', async () => {
    const { createEdge } = await import('@/actions/edge-actions');
    const result = await createEdge({
      graphId: 'not-a-uuid',
      sourceNodeId: UUID2,
      targetNodeId: UUID3,
      edgeType: 'supports',
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('should throw when not authenticated', async () => {
    mockAuth.mockReturnValue({ userId: null });

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
});

describe('updateEdge', () => {
  it('should update edge type', async () => {
    const updated = { id: UUID1, edge_type: 'contradicts' };
    mockSingle.mockResolvedValue({ data: updated, error: null });

    const { updateEdge } = await import('@/actions/edge-actions');
    const result = await updateEdge({
      edgeId: UUID1,
      edgeType: 'contradicts',
    });

    expect(result.data).toEqual(updated);
    expect(result.error).toBeNull();
  });

  it('should return error for invalid edgeId', async () => {
    const { updateEdge } = await import('@/actions/edge-actions');
    const result = await updateEdge({
      edgeId: 'not-a-uuid',
      edgeType: 'supports',
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('deleteEdge', () => {
  it('should delete an edge', async () => {
    mockEq.mockResolvedValue({ error: null });

    const { deleteEdge } = await import('@/actions/edge-actions');
    const result = await deleteEdge({ edgeId: UUID1 });

    expect(result.error).toBeNull();
  });

  it('should return error for invalid edgeId', async () => {
    const { deleteEdge } = await import('@/actions/edge-actions');
    const result = await deleteEdge({ edgeId: 'not-a-uuid' });

    expect(result.error).toBeTruthy();
  });
});

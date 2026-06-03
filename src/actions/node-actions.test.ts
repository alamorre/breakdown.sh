import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockResolveClerkActor = vi.fn();
const mockCreateNodeForActor = vi.fn();
const mockUpdateNodeForActor = vi.fn();
const mockDeleteNodeForActor = vi.fn();
const mockRunNodeForActor = vi.fn();

vi.mock('@/lib/thesis-service/actor', () => ({
  resolveClerkActor: () => mockResolveClerkActor(),
}));

vi.mock('@/lib/thesis-service/nodes', () => ({
  createNodeForActor: (...args: unknown[]) => mockCreateNodeForActor(...args),
  updateNodeForActor: (...args: unknown[]) => mockUpdateNodeForActor(...args),
  deleteNodeForActor: (...args: unknown[]) => mockDeleteNodeForActor(...args),
  runNodeForActor: (...args: unknown[]) => mockRunNodeForActor(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveClerkActor.mockResolvedValue({
    userId: 'user_123',
    source: 'clerk-session',
    scopes: ['graphs:read', 'graphs:write', 'runs:execute'],
  });
});

describe('node actions', () => {
  it('creates a node through the service layer', async () => {
    const node = { id: 'node-1', name: 'Test Node' };
    mockCreateNodeForActor.mockResolvedValue(node);

    const { createNode } = await import('@/actions/node-actions');
    const result = await createNode({
      graphId: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Test Node',
      positionX: 100,
      positionY: 200,
    });

    expect(result).toEqual({ data: node, error: null });
    expect(mockCreateNodeForActor).toHaveBeenCalledWith(expect.any(Object), {
      graphId: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Test Node',
      positionX: 100,
      positionY: 200,
    });
  });

  it('throws when not authenticated to preserve existing server action behavior', async () => {
    mockResolveClerkActor.mockRejectedValue(new Error('Unauthorized'));

    const { createNode } = await import('@/actions/node-actions');
    await expect(
      createNode({
        graphId: '550e8400-e29b-41d4-a716-446655440001',
        name: 'Test',
        positionX: 0,
        positionY: 0,
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('updates a node through the service layer', async () => {
    const updated = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Updated' };
    mockUpdateNodeForActor.mockResolvedValue(updated);

    const { updateNode } = await import('@/actions/node-actions');
    const result = await updateNode({
      nodeId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Updated',
    });

    expect(result).toEqual({ data: updated, error: null });
  });

  it('deletes a node through the service layer', async () => {
    mockDeleteNodeForActor.mockResolvedValue(undefined);

    const { deleteNode } = await import('@/actions/node-actions');
    const result = await deleteNode({ nodeId: '550e8400-e29b-41d4-a716-446655440000' });

    expect(result.error).toBeNull();
    expect(mockDeleteNodeForActor).toHaveBeenCalledWith(
      expect.any(Object),
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('runs a node through the actor-aware runner', async () => {
    const runResult = { output: 'Generated output', lastRunAt: '2026-06-03T00:00:00Z' };
    mockRunNodeForActor.mockResolvedValue(runResult);

    const { runNode } = await import('@/actions/node-actions');
    const result = await runNode({ nodeId: '550e8400-e29b-41d4-a716-446655440000' });

    expect(result).toEqual({ data: runResult, error: null });
    expect(mockRunNodeForActor).toHaveBeenCalledWith(expect.any(Object), {
      nodeId: '550e8400-e29b-41d4-a716-446655440000',
    });
  });
});

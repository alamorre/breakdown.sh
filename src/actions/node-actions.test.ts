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
    in: mockIn.mockReturnThis(),
  };
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => createChain(),
  }),
}));

vi.mock('@/lib/ai/claude', () => ({
  createClaudeClient: () => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: 'Generated output' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  }),
}));

vi.mock('@/lib/ai/build-prompt', () => ({
  buildRunPrompt: vi.fn((prompt: string) => prompt),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockReturnValue({ userId: 'user_123' });
});

describe('createNode', () => {
  it('should create a node and return data', async () => {
    const node = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      graph_id: '550e8400-e29b-41d4-a716-446655440001',
      node_type: 'default',
      name: 'Test Node',
      position_x: 100,
      position_y: 200,
      prompt: '',
      output: null,
      run_status: 'idle',
      run_error: null,
      last_run_at: null,
    };
    mockSingle.mockResolvedValue({ data: node, error: null });

    const { createNode } = await import('@/actions/node-actions');
    const result = await createNode({
      graphId: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Test Node',
      positionX: 100,
      positionY: 200,
    });

    expect(result.data).toEqual(node);
    expect(result.error).toBeNull();
  });

  it('should create a node with a prompt', async () => {
    const node = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      graph_id: '550e8400-e29b-41d4-a716-446655440001',
      node_type: 'default',
      name: 'Test Node',
      prompt: 'Analyze market data',
      output: null,
      run_status: 'idle',
    };
    mockSingle.mockResolvedValue({ data: node, error: null });

    const { createNode } = await import('@/actions/node-actions');
    const result = await createNode({
      graphId: '550e8400-e29b-41d4-a716-446655440001',
      name: 'Test Node',
      prompt: 'Analyze market data',
      positionX: 100,
      positionY: 200,
    });

    expect(result.data?.prompt).toBe('Analyze market data');
    expect(result.error).toBeNull();
  });

  it('should return error for invalid input', async () => {
    const { createNode } = await import('@/actions/node-actions');
    const result = await createNode({
      graphId: 'not-a-uuid',
      name: 'Test',
      positionX: 0,
      positionY: 0,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('should throw when not authenticated', async () => {
    mockAuth.mockReturnValue({ userId: null });

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
});

describe('updateNode', () => {
  it('should update node name and prompt', async () => {
    const updated = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Updated Name',
      prompt: 'New prompt',
    };
    mockSingle.mockResolvedValue({ data: updated, error: null });

    const { updateNode } = await import('@/actions/node-actions');
    const result = await updateNode({
      nodeId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'Updated Name',
      prompt: 'New prompt',
    });

    expect(result.data).toEqual(updated);
    expect(result.error).toBeNull();
  });

  it('should return error for invalid nodeId', async () => {
    const { updateNode } = await import('@/actions/node-actions');
    const result = await updateNode({
      nodeId: 'not-a-uuid',
      name: 'Test',
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe('deleteNode', () => {
  it('should delete a node', async () => {
    mockEq.mockResolvedValue({ error: null });

    const { deleteNode } = await import('@/actions/node-actions');
    const result = await deleteNode({ nodeId: '550e8400-e29b-41d4-a716-446655440000' });

    expect(result.error).toBeNull();
  });

  it('should return error for invalid nodeId', async () => {
    const { deleteNode } = await import('@/actions/node-actions');
    const result = await deleteNode({ nodeId: 'not-a-uuid' });

    expect(result.error).toBeTruthy();
  });
});

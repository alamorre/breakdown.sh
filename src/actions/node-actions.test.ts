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
const mockGetUserAiProviderApiKey = vi.fn();
const mockCreateAiCompletion = vi.fn();

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

vi.mock('@/lib/ai/credentials', () => ({
  getAiProviderCredentialsSetupError: (err: unknown) =>
    err instanceof Error ? err.message : 'Credential setup failed',
  getProviderSetupPrompt: (providerId: string) =>
    `Add your ${providerId} API key in Settings before running ${providerId} models.`,
  getUserAiProviderApiKey: (...args: unknown[]) => mockGetUserAiProviderApiKey(...args),
}));

vi.mock('@/lib/ai/provider-completion', () => ({
  createAiCompletion: (...args: unknown[]) => mockCreateAiCompletion(...args),
}));

vi.mock('@/lib/ai/build-prompt', () => ({
  buildRunPrompt: vi.fn((prompt: string) => prompt),
  buildSummaryPrompt: vi.fn((output: string) => output),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockReturnValue({ userId: 'user_123' });
  mockGetUserAiProviderApiKey.mockResolvedValue('sk-provider-test');
  mockCreateAiCompletion.mockResolvedValue({
    output: 'Generated output',
    inputTokens: 100,
    outputTokens: 50,
  });
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

describe('runNode', () => {
  it('should use the graph-selected model and store it on the evaluation', async () => {
    const nodeId = '550e8400-e29b-41d4-a716-446655440010';
    const aiNode = {
      id: nodeId,
      graph_id: '550e8400-e29b-41d4-a716-446655440001',
      node_type: 'default',
      name: 'Analysis Node',
      prompt: 'Analyze source',
      output: null,
      run_status: 'idle',
      run_error: null,
      last_run_at: null,
      metadata: {},
      created_at: '2026-05-31T00:00:00Z',
      updated_at: '2026-05-31T00:00:00Z',
    };

    mockSingle
      .mockResolvedValueOnce({ data: aiNode, error: null })
      .mockResolvedValueOnce({ data: { llm_model: 'claude-opus-4-8' }, error: null });

    const { runNode } = await import('@/actions/node-actions');
    const result = await runNode({ nodeId });

    expect(result.error).toBeNull();
    expect(mockGetUserAiProviderApiKey).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user_123',
      providerId: 'anthropic',
    });
    expect(mockCreateAiCompletion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerId: 'anthropic', modelId: 'claude-opus-4-8' }),
    );
    expect(mockCreateAiCompletion).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ providerId: 'anthropic', modelId: 'claude-haiku-4-5-20251001' }),
    );
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ llm_model: 'claude-opus-4-8' }),
    );
  });

  it('should default to Sonnet when the graph has no selected model', async () => {
    const nodeId = '550e8400-e29b-41d4-a716-446655440010';
    const aiNode = {
      id: nodeId,
      graph_id: '550e8400-e29b-41d4-a716-446655440001',
      node_type: 'default',
      name: 'Analysis Node',
      prompt: 'Analyze source',
      output: null,
      run_status: 'idle',
      run_error: null,
      last_run_at: null,
      metadata: {},
      created_at: '2026-05-31T00:00:00Z',
      updated_at: '2026-05-31T00:00:00Z',
    };

    mockSingle
      .mockResolvedValueOnce({ data: aiNode, error: null })
      .mockResolvedValueOnce({ data: { llm_model: null }, error: null });

    const { runNode } = await import('@/actions/node-actions');
    const result = await runNode({ nodeId });

    expect(result.error).toBeNull();
    expect(mockCreateAiCompletion).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ providerId: 'anthropic', modelId: 'claude-sonnet-4-6' }),
    );
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ llm_model: 'claude-sonnet-4-6' }),
    );
  });

  it('should reject stale source inputs before running AI nodes', async () => {
    const nodeId = '550e8400-e29b-41d4-a716-446655440010';
    const sourceId = '550e8400-e29b-41d4-a716-446655440011';
    const aiNode = {
      id: nodeId,
      graph_id: '550e8400-e29b-41d4-a716-446655440001',
      node_type: 'default',
      name: 'Analysis Node',
      prompt: 'Analyze source',
      output: null,
      run_status: 'idle',
      run_error: null,
      last_run_at: null,
      metadata: {},
      created_at: '2026-05-31T00:00:00Z',
      updated_at: '2026-05-31T00:00:00Z',
    };
    const staleSource = {
      ...aiNode,
      id: sourceId,
      node_type: 'source-web-url',
      name: 'Market Source',
      output: 'Old market data',
      run_status: 'success',
      last_run_at: '2026-01-01T00:00:00Z',
    };
    const edge = {
      id: '550e8400-e29b-41d4-a716-446655440012',
      graph_id: aiNode.graph_id,
      source_node_id: sourceId,
      target_node_id: nodeId,
      edge_type: 'inputs_to',
      weight: 1,
      condition: null,
      transform: null,
      created_at: '2026-05-31T00:00:00Z',
      updated_at: '2026-05-31T00:00:00Z',
    };

    mockSingle.mockResolvedValueOnce({ data: aiNode, error: null });
    mockEq
      .mockReturnValueOnce({ single: mockSingle })
      .mockResolvedValueOnce({ data: [edge], error: null });
    mockIn.mockResolvedValueOnce({ data: [staleSource], error: null });

    const { runNode } = await import('@/actions/node-actions');
    const result = await runNode({ nodeId });

    expect(result.data).toBeNull();
    expect(result.error).toContain('Stale source input: Market Source');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should return a setup prompt when the selected provider key is missing', async () => {
    const nodeId = '550e8400-e29b-41d4-a716-446655440010';
    const aiNode = {
      id: nodeId,
      graph_id: '550e8400-e29b-41d4-a716-446655440001',
      node_type: 'default',
      name: 'Analysis Node',
      prompt: 'Analyze source',
      output: null,
      run_status: 'idle',
      run_error: null,
      last_run_at: null,
      metadata: {},
      created_at: '2026-05-31T00:00:00Z',
      updated_at: '2026-05-31T00:00:00Z',
    };

    mockSingle.mockResolvedValueOnce({ data: aiNode, error: null }).mockResolvedValueOnce({
      data: { llm_provider: 'openai', llm_model: 'gpt-5.4' },
      error: null,
    });
    mockGetUserAiProviderApiKey.mockResolvedValueOnce(null);

    const { runNode } = await import('@/actions/node-actions');
    const result = await runNode({ nodeId });

    expect(result.data).toBeNull();
    expect(result.error).toContain('Add your openai API key in Settings');
    expect(mockCreateAiCompletion).not.toHaveBeenCalled();
  });
});

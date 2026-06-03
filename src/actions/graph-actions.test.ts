import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();
const mockRevalidatePath = vi.fn();
const mockGetActiveAiProviderCredential = vi.fn();
const mockHasAiProviderCredentialEncryption = vi.fn();

vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock('@/lib/ai/credentials', () => ({
  getActiveAiProviderCredential: (...args: unknown[]) => mockGetActiveAiProviderCredential(...args),
  getAiProviderCredentialsSetupError: (err: unknown) =>
    err instanceof Error ? err.message : 'AI provider credentials could not be loaded.',
  getProviderSetupPrompt: (providerId: string) =>
    `Add your ${providerId === 'openai' ? 'OpenAI' : providerId === 'gemini' ? 'Gemini' : 'Anthropic'} API key in Settings before running ${providerId === 'openai' ? 'OpenAI' : providerId === 'gemini' ? 'Gemini' : 'Anthropic'} models.`,
  hasAiProviderCredentialEncryption: () => mockHasAiProviderCredentialEncryption(),
}));

const mockSelect = vi.fn();
const mockSingle = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();

function createChain() {
  const chain = {
    select: mockSelect.mockReturnThis(),
    single: mockSingle,
    insert: mockInsert.mockReturnThis(),
    update: mockUpdate.mockReturnThis(),
    delete: mockDelete.mockReturnThis(),
    eq: mockEq.mockReturnThis(),
    order: mockOrder,
  };
  return chain;
}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: () => createChain(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockReturnValue({ userId: 'user_123' });
  mockGetActiveAiProviderCredential.mockResolvedValue({ id: 'credential_123' });
  mockHasAiProviderCredentialEncryption.mockReturnValue(true);
});

describe('createGraph', () => {
  it('should create a graph and return data', async () => {
    const graph = { id: 'abc-123', user_id: 'user_123', name: 'Test Graph' };
    mockSingle.mockResolvedValue({ data: graph, error: null });

    const { createGraph } = await import('@/actions/graph-actions');
    const result = await createGraph({ name: 'Test Graph' });

    expect(result.data).toEqual(graph);
    expect(result.error).toBeNull();
    expect(mockInsert).toHaveBeenCalledWith({
      user_id: 'user_123',
      name: 'Test Graph',
      description: null,
      llm_provider: 'anthropic',
      llm_model: 'claude-sonnet-4-6',
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
  });

  it('should return error for empty name', async () => {
    const { createGraph } = await import('@/actions/graph-actions');
    const result = await createGraph({ name: '' });

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('should throw when not authenticated', async () => {
    mockAuth.mockReturnValue({ userId: null });

    const { createGraph } = await import('@/actions/graph-actions');
    await expect(createGraph({ name: 'Test' })).rejects.toThrow('Unauthorized');
  });
});

describe('getUserGraphs', () => {
  it('should return graphs for authenticated user', async () => {
    const graphs = [
      { id: '1', name: 'Graph 1' },
      { id: '2', name: 'Graph 2' },
    ];
    mockOrder.mockResolvedValue({ data: graphs, error: null });

    const { getUserGraphs } = await import('@/actions/graph-actions');
    const result = await getUserGraphs();

    expect(result.data).toEqual(graphs);
    expect(result.error).toBeNull();
  });

  it('should return empty array on error', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'DB error' } });

    const { getUserGraphs } = await import('@/actions/graph-actions');
    const result = await getUserGraphs();

    expect(result.data).toEqual([]);
    expect(result.error).toBe('DB error');
  });
});

describe('deleteGraph', () => {
  it('should delete a graph', async () => {
    mockEq.mockResolvedValue({ error: null });

    const { deleteGraph } = await import('@/actions/graph-actions');
    const result = await deleteGraph({ graphId: '550e8400-e29b-41d4-a716-446655440000' });

    expect(result.error).toBeNull();
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard');
  });

  it('should return error for invalid graphId', async () => {
    const { deleteGraph } = await import('@/actions/graph-actions');
    const result = await deleteGraph({ graphId: 'not-a-uuid' });

    expect(result.error).toBeTruthy();
  });
});

describe('updateGraph', () => {
  it('should update graph name', async () => {
    const updated = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'New Name' };
    mockSingle.mockResolvedValue({ data: updated, error: null });

    const { updateGraph } = await import('@/actions/graph-actions');
    const result = await updateGraph({
      graphId: '550e8400-e29b-41d4-a716-446655440000',
      name: 'New Name',
    });

    expect(result.data).toEqual(updated);
    expect(result.error).toBeNull();
  });

  it('should update graph model', async () => {
    const updated = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      llm_model: 'claude-haiku-4-5-20251001',
    };
    mockSingle.mockResolvedValue({ data: updated, error: null });

    const { updateGraphModel } = await import('@/actions/graph-actions');
    const result = await updateGraphModel(
      '550e8400-e29b-41d4-a716-446655440000',
      'claude-haiku-4-5-20251001',
    );

    expect(result.data).toEqual(updated);
    expect(result.error).toBeNull();
    expect(mockGetActiveAiProviderCredential).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user_123',
      providerId: 'anthropic',
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      llm_provider: 'anthropic',
      llm_model: 'claude-haiku-4-5-20251001',
      updated_at: expect.any(String),
    });
  });

  it('should store the provider that owns the selected graph model', async () => {
    const updated = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      llm_provider: 'openai',
      llm_model: 'gpt-5.4',
    };
    mockSingle.mockResolvedValue({ data: updated, error: null });

    const { updateGraphModel } = await import('@/actions/graph-actions');
    const result = await updateGraphModel('550e8400-e29b-41d4-a716-446655440000', 'gpt-5.4');

    expect(result.data).toEqual(updated);
    expect(result.error).toBeNull();
    expect(mockGetActiveAiProviderCredential).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user_123',
      providerId: 'openai',
    });
    expect(mockUpdate).toHaveBeenCalledWith({
      llm_provider: 'openai',
      llm_model: 'gpt-5.4',
      updated_at: expect.any(String),
    });
  });

  it('should reject unsupported graph models', async () => {
    const { updateGraph } = await import('@/actions/graph-actions');
    const result = await updateGraph({
      graphId: '550e8400-e29b-41d4-a716-446655440000',
      llmModel: 'claude-unknown' as never,
    });

    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('should reject model updates for providers without a saved key', async () => {
    mockGetActiveAiProviderCredential.mockResolvedValue(null);

    const { updateGraphModel } = await import('@/actions/graph-actions');
    const result = await updateGraphModel('550e8400-e29b-41d4-a716-446655440000', 'gemini-2.5-pro');

    expect(result.data).toBeNull();
    expect(result.error).toBe('Add your Gemini API key in Settings before running Gemini models.');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('should reject model updates when provider key storage is unavailable', async () => {
    mockHasAiProviderCredentialEncryption.mockReturnValue(false);

    const { updateGraphModel } = await import('@/actions/graph-actions');
    const result = await updateGraphModel('550e8400-e29b-41d4-a716-446655440000', 'gpt-5.4');

    expect(result.data).toBeNull();
    expect(result.error).toBe('Stored provider keys are not configured for this deployment.');
    expect(mockGetActiveAiProviderCredential).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe('getGraph', () => {
  it('should return graph with nodes and edges', async () => {
    const graph = { id: '550e8400-e29b-41d4-a716-446655440000', name: 'Test' };
    mockSingle.mockResolvedValue({ data: graph, error: null });
    mockEq.mockResolvedValue({ data: [], error: null });

    const { getGraph } = await import('@/actions/graph-actions');
    const result = await getGraph({ graphId: '550e8400-e29b-41d4-a716-446655440000' });

    expect(result.data?.graph).toEqual(graph);
    expect(result.data?.nodes).toEqual([]);
    expect(result.data?.edges).toEqual([]);
  });

  it('should return error for missing graph', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } });

    const { getGraph } = await import('@/actions/graph-actions');
    const result = await getGraph({ graphId: '550e8400-e29b-41d4-a716-446655440000' });

    expect(result.data).toBeNull();
    expect(result.error).toBe('Not found');
  });
});

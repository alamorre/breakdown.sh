import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownActor } from './actor';
import type { BreakdownNode } from '@/types/node';

const { mockCreateServerClient, mockGetUserAiProviderApiKey, mockCreateAiCompletion } = vi.hoisted(
  () => ({
    mockCreateServerClient: vi.fn(),
    mockGetUserAiProviderApiKey: vi.fn(),
    mockCreateAiCompletion: vi.fn(),
  }),
);

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock('@/lib/ai/credentials', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ai/credentials')>();
  return {
    ...original,
    getUserAiProviderApiKey: mockGetUserAiProviderApiKey,
  };
});

vi.mock('@/lib/ai/provider-completion', () => ({
  createAiCompletion: mockCreateAiCompletion,
}));

const actor: BreakdownActor = {
  userId: 'user_123',
  source: 'integration-token',
  scopes: ['runs:execute'],
  tokenId: '99999999-9999-4999-8999-999999999999',
};

const graphId = '11111111-1111-4111-8111-111111111111';
const nodeId = '22222222-2222-4222-8222-222222222222';

function node(overrides: Partial<BreakdownNode> = {}): BreakdownNode {
  return {
    id: nodeId,
    graph_id: graphId,
    node_type: 'default',
    name: 'Score candidate',
    position_x: 0,
    position_y: 0,
    prompt: 'Return a score.',
    output: null,
    structured_output: null,
    run_status: 'idle',
    run_error: null,
    last_run_at: null,
    metadata: {
      promptContract: {
        version: 'node-prompt-contract.v1',
        objective: 'Return a recommendation score.',
        outputContract: {
          format: 'json',
          schema: {
            type: 'object',
            required: ['recommendation', 'score'],
            properties: {
              recommendation: { type: 'string' },
              score: { type: 'number' },
            },
          },
        },
      },
    },
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockSupabase(tables: Record<string, Array<Record<string, unknown>>>) {
  type MockQuery = {
    select: () => MockQuery;
    update: (payload: Record<string, unknown>) => MockQuery;
    insert: (payload: unknown) => MockQuery;
    eq: (column: string, value: unknown) => MockQuery | Promise<{ error: null }>;
    in: (column: string, values: unknown[]) => MockQuery;
    single: () => Promise<{
      data: Record<string, unknown> | null;
      error: { message: string } | null;
    }>;
  };

  return {
    from: vi.fn((table: string) => {
      const filters: Array<[string, unknown]> = [];
      let updatePayload: Record<string, unknown> | null = null;

      function rows() {
        return (tables[table] ?? []).filter((row) =>
          filters.every(([column, value]) => row[column] === value),
        );
      }

      const query = {} as MockQuery;
      query.select = vi.fn(() => query);
      query.update = vi.fn((payload: Record<string, unknown>) => {
        updatePayload = payload;
        return query;
      });
      query.insert = vi.fn((payload: unknown) => {
        const values = (Array.isArray(payload) ? payload : [payload]) as Array<
          Record<string, unknown>
        >;
        tables[table] = [...(tables[table] ?? []), ...values];
        return query;
      });
      query.eq = vi.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        if (updatePayload) {
          for (const row of rows()) Object.assign(row, updatePayload);
          return Promise.resolve({ error: null });
        }
        return query;
      });
      query.in = vi.fn((column: string, values: unknown[]) => {
        filters.push([column, values]);
        return query;
      });
      query.single = vi.fn(() => {
        const [row] = rows();
        return Promise.resolve({ data: row ?? null, error: row ? null : { message: 'not found' } });
      });

      return query;
    }),
  };
}

describe('node service internal runs', () => {
  let tables: Record<string, Array<Record<string, unknown>>>;

  beforeEach(() => {
    vi.clearAllMocks();
    tables = {
      graphs: [
        {
          id: graphId,
          user_id: actor.userId,
          name: 'Graph',
          description: null,
          llm_provider: 'anthropic',
          llm_model: 'claude-sonnet-4-6',
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
        },
      ],
      nodes: [node() as unknown as Record<string, unknown>],
      edges: [],
      evaluations: [],
      headless_audit_logs: [],
    };
    mockCreateServerClient.mockReturnValue(createMockSupabase(tables));
    mockGetUserAiProviderApiKey.mockResolvedValue('anthropic-key');
  });

  it('marks internal runs failed when model output misses an explicit contract field', async () => {
    mockCreateAiCompletion.mockResolvedValue({
      output: 'Recommendation: promote\n```json\n{"recommendation":"promote"}\n```',
      inputTokens: 100,
      outputTokens: 20,
    });
    const { runNodeForActor } = await import('./nodes');

    await expect(runNodeForActor(actor, { nodeId })).rejects.toThrow(
      'Node output did not satisfy output contract',
    );

    expect(tables.nodes[0]).toMatchObject({
      run_status: 'error',
      run_error: expect.stringContaining('$.score is required'),
      output: null,
      structured_output: null,
    });
  });
});

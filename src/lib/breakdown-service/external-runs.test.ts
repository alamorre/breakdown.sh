import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownActor } from './actor';
import { EdgeType } from '@/types/edge';
import type { BreakdownNode } from '@/types/node';

const { mockCreateServerClient, mockGetGraphForActor } = vi.hoisted(() => ({
  mockCreateServerClient: vi.fn(),
  mockGetGraphForActor: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock('./graphs', () => ({
  getGraphForActor: mockGetGraphForActor,
}));

const actor: BreakdownActor = {
  userId: 'user_123',
  source: 'integration-token',
  scopes: ['runs:external_execute'],
  tokenId: '99999999-9999-4999-8999-999999999999',
};

const runId = '11111111-1111-4111-8111-111111111111';
const graphId = '22222222-2222-4222-8222-222222222222';
const sourceNodeId = '33333333-3333-4333-8333-333333333333';
const targetNodeId = '44444444-4444-4444-8444-444444444444';
const sourceStepId = '55555555-5555-4555-8555-555555555555';
const targetStepId = '66666666-6666-4666-8666-666666666666';
const edgeId = '77777777-7777-4777-8777-777777777777';

function node(overrides: Partial<BreakdownNode>): BreakdownNode {
  return {
    id: sourceNodeId,
    graph_id: graphId,
    node_type: 'default',
    name: 'Node',
    position_x: 0,
    position_y: 0,
    prompt: '',
    output: null,
    run_status: 'idle',
    run_error: null,
    last_run_at: null,
    metadata: {},
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function createMockSupabase(tables: Record<string, Array<Record<string, unknown>>>) {
  type MockQuery = {
    select: () => MockQuery;
    insert: (payload: unknown) => MockQuery;
    update: (payload: Record<string, unknown>) => MockQuery;
    eq: (column: string, value: unknown) => MockQuery | Promise<{ error: null }>;
    in: (column: string, values: unknown[]) => Promise<{ error: null }>;
    order: (
      column: string,
      options?: { ascending?: boolean },
    ) => Promise<{ data: Array<Record<string, unknown>>; error: null }>;
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

      function applyUpdate(matchedRows: Array<Record<string, unknown>>) {
        if (!updatePayload) return Promise.resolve({ error: null });
        for (const row of matchedRows) Object.assign(row, updatePayload);
        return Promise.resolve({ error: null });
      }

      const query = {} as MockQuery;
      query.select = vi.fn(() => query);
      query.insert = vi.fn((payload: unknown) => {
        const values = (Array.isArray(payload) ? payload : [payload]) as Array<
          Record<string, unknown>
        >;
        tables[table] = [...(tables[table] ?? []), ...values];
        return query;
      });
      query.update = vi.fn((payload: Record<string, unknown>) => {
        updatePayload = payload;
        return query;
      });
      query.eq = vi.fn((column: string, value: unknown) => {
        filters.push([column, value]);
        if (updatePayload) return applyUpdate(rows());
        return query;
      });
      query.in = vi.fn((column: string, values: unknown[]) =>
        applyUpdate(rows().filter((row) => values.includes(row[column]))),
      );
      query.order = vi.fn((column: string, options: { ascending?: boolean } = {}) => {
        const sorted = [...rows()].sort((left, right) => {
          const leftValue = left[column] as number | string;
          const rightValue = right[column] as number | string;
          if (leftValue < rightValue) return options.ascending === false ? 1 : -1;
          if (leftValue > rightValue) return options.ascending === false ? -1 : 1;
          return 0;
        });
        return Promise.resolve({ data: sorted, error: null });
      });
      query.single = vi.fn(() => {
        const [row] = rows();
        return Promise.resolve({
          data: row ?? null,
          error: row ? null : { message: 'not found' },
        });
      });

      return query;
    }),
  };
}

describe('external run service', () => {
  let tables: Record<string, Array<Record<string, unknown>>>;

  beforeEach(() => {
    vi.clearAllMocks();
    tables = {
      external_runs: [
        {
          id: runId,
          graph_id: graphId,
          user_id: actor.userId,
          status: 'active',
          actor_source: 'integration-token',
          actor_token_id: actor.tokenId,
          client_name: 'Codex',
          provider_name: 'OpenAI',
          manifest_version: 'manifest-v1',
          metadata: {},
          started_at: '2026-06-01T00:00:00.000Z',
          finalized_at: null,
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
        },
      ],
      external_run_steps: [
        {
          id: sourceStepId,
          external_run_id: runId,
          graph_id: graphId,
          node_id: sourceNodeId,
          sequence_index: 0,
          status: 'submitted',
          context_version: 'ctx-source',
          output: 'Current evidence from the host console.',
          structured_summary: null,
          citations: [],
          blocked_reason: null,
          required_data: [],
          submitted_by_source: 'integration-token',
          submitted_by_token_id: actor.tokenId,
          client_name: 'Codex',
          provider_name: 'OpenAI',
          started_at: '2026-06-01T00:00:00.000Z',
          submitted_at: '2026-06-01T00:00:00.000Z',
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
        },
        {
          id: targetStepId,
          external_run_id: runId,
          graph_id: graphId,
          node_id: targetNodeId,
          sequence_index: 1,
          status: 'ready',
          context_version: 'ctx-target',
          output: null,
          structured_summary: null,
          citations: [],
          blocked_reason: null,
          required_data: [],
          submitted_by_source: null,
          submitted_by_token_id: null,
          client_name: null,
          provider_name: null,
          started_at: null,
          submitted_at: null,
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
        },
      ],
    };
    mockCreateServerClient.mockReturnValue(createMockSupabase(tables));
    mockGetGraphForActor.mockResolvedValue({
      id: graphId,
      nodes: [
        node({
          id: sourceNodeId,
          node_type: 'source-web-url',
          name: 'Current evidence',
          output: 'Current evidence from the host console.',
          run_status: 'success',
          last_run_at: '2026-01-01T00:00:00.000Z',
        }),
        node({
          id: targetNodeId,
          name: 'Synthesize answer',
          prompt: 'Use the current evidence to answer.',
          metadata: {
            expectedOutput: 'A concise answer.',
            acceptanceCriteria: ['Uses the upstream evidence.'],
          },
        }),
      ],
      edges: [
        {
          id: edgeId,
          graph_id: graphId,
          source_node_id: sourceNodeId,
          target_node_id: targetNodeId,
          edge_type: EdgeType.InputsTo,
          weight: 1,
          condition: 'Requires current evidence.',
          transform: 'Summarize before use.',
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
        },
      ],
    });
  });

  it('returns an executable work packet from get_next_step without requiring context fetch', async () => {
    const { getNextExternalStepForActor } = await import('./external-runs');

    const result = await getNextExternalStepForActor(actor, runId);

    expect(result).toMatchObject({
      runId,
      status: 'active',
      step: {
        stepId: targetStepId,
        nodeId: targetNodeId,
        status: 'in_progress',
        contextVersion: 'ctx-target',
        node: {
          id: targetNodeId,
          name: 'Synthesize answer',
          nodeType: 'default',
          prompt: 'Use the current evidence to answer.',
        },
        upstream: {
          inputs_to: [
            {
              edgeId,
              sourceNodeId,
              sourceNodeName: 'Current evidence',
              output: 'Current evidence from the host console.',
              condition: 'Requires current evidence.',
              transform: 'Summarize before use.',
            },
          ],
        },
        sourceFreshnessWarnings: [
          {
            nodeId: sourceNodeId,
            name: 'Current evidence',
          },
        ],
        expectedOutput: 'A concise answer.',
        acceptanceCriteria: ['Uses the upstream evidence.'],
        submission: {
          submitRoute: `/api/headless/external-runs/${runId}/steps/${targetStepId}/result`,
          blockRoute: `/api/headless/external-runs/${runId}/steps/${targetStepId}/block`,
          requiredContextVersion: 'ctx-target',
        },
      },
    });
    const targetStep = tables.external_run_steps.find((step) => step.id === targetStepId);
    expect(targetStep).toMatchObject({
      status: 'in_progress',
      started_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownActor } from './actor';
import { BreakdownServiceError } from './errors';

const { mockCreateServerClient, mockGetGraphForActor } = vi.hoisted(() => ({
  mockCreateServerClient: vi.fn(),
  mockGetGraphForActor: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock('./graphs', async (importOriginal) => {
  const original = await importOriginal<typeof import('./graphs')>();
  return {
    ...original,
    getGraphForActor: mockGetGraphForActor,
  };
});

const actor: BreakdownActor = {
  userId: 'user_123',
  source: 'integration-token',
  scopes: ['graphs:read'],
  tokenId: '550e8400-e29b-41d4-a716-446655440000',
};

const writeActor: BreakdownActor = {
  ...actor,
  scopes: ['graphs:write'],
};

const graph = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user_123',
  name: 'Workflow Graph',
  description: 'A graph for hosted agent execution',
  llm_provider: 'anthropic',
  llm_model: 'claude-sonnet-4-6',
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-03T00:00:00.000Z',
  nodes: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      graph_id: '11111111-1111-4111-8111-111111111111',
      node_type: 'source-web-url',
      name: 'Fetch Source',
      prompt: 'Fetch current source material',
      output: 'Source output',
      metadata: { url: 'https://example.com' },
      run_status: 'success',
      run_error: null,
      last_run_at: null,
      position_x: 0,
      position_y: 0,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-03T00:00:00.000Z',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      graph_id: '11111111-1111-4111-8111-111111111111',
      node_type: 'default',
      name: 'Analyze Source',
      prompt: 'Analyze the source',
      output: null,
      metadata: {},
      run_status: 'idle',
      run_error: null,
      last_run_at: null,
      position_x: 250,
      position_y: 0,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      graph_id: '11111111-1111-4111-8111-111111111111',
      node_type: 'default',
      name: 'Synthesize',
      prompt: 'Write final composition',
      output: null,
      metadata: {},
      run_status: 'skipped',
      run_error: 'Missing source',
      last_run_at: null,
      position_x: 500,
      position_y: 0,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
    },
  ],
  edges: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      graph_id: '11111111-1111-4111-8111-111111111111',
      source_node_id: '22222222-2222-4222-8222-222222222222',
      target_node_id: '33333333-3333-4333-8333-333333333333',
      edge_type: 'inputs_to',
      weight: 1,
      condition: 'Use current data',
      transform: null,
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
    },
    {
      id: '66666666-6666-4666-8666-666666666666',
      graph_id: '11111111-1111-4111-8111-111111111111',
      source_node_id: '33333333-3333-4333-8333-333333333333',
      target_node_id: '44444444-4444-4444-8444-444444444444',
      edge_type: 'depends_on',
      weight: 1,
      condition: null,
      transform: 'summarize',
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-02T00:00:00.000Z',
    },
  ],
};

function createImportMockSupabase() {
  const inserted: Record<string, Array<Record<string, unknown>>> = {
    graphs: [],
    nodes: [],
    edges: [],
    headless_audit_logs: [],
  };
  const importedGraphId = '77777777-7777-4777-8777-777777777777';
  const importedNodeIds = [
    '88888888-8888-4888-8888-888888888888',
    '99999999-9999-4999-8999-999999999999',
  ];
  let nodeInsertIndex = 0;

  const client = {
    from: vi.fn((table: string) => {
      const query = {
        delete: vi.fn(() => query),
        eq: vi.fn(() => query),
        insert: vi.fn((payload: unknown) => {
          const values = (Array.isArray(payload) ? payload : [payload]) as Array<
            Record<string, unknown>
          >;
          inserted[table] = [...(inserted[table] ?? []), ...values];
          return query;
        }),
        select: vi.fn(() => query),
        single: vi.fn(async () => {
          if (table === 'graphs') return { data: { id: importedGraphId }, error: null };
          if (table === 'nodes') {
            const id = importedNodeIds[nodeInsertIndex++];
            return { data: { id }, error: null };
          }
          return { data: null, error: null };
        }),
      };
      return query;
    }),
  };

  return { client, inserted, importedGraphId };
}

describe('headless workflow helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGraphForActor.mockResolvedValue(graph);
    mockCreateServerClient.mockReturnValue(createImportMockSupabase().client);
  });

  it('exports graphs in the stable headless interchange shape', async () => {
    const { exportGraphForActor } = await import('./workflows');

    const exported = await exportGraphForActor(actor, graph.id);

    expect(exported.version).toBe('breakdown.headless.graph.v1');
    expect(exported.graph).toMatchObject({
      id: graph.id,
      name: 'Workflow Graph',
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-6',
    });
    expect(exported.nodes[0]).toMatchObject({
      id: '22222222-2222-4222-8222-222222222222',
      nodeType: 'source-web-url',
      position: { x: 0, y: 0 },
    });
    expect(exported.edges[0]).toMatchObject({
      sourceNodeId: '22222222-2222-4222-8222-222222222222',
      targetNodeId: '33333333-3333-4333-8333-333333333333',
      edgeType: 'inputs_to',
    });
  });

  it('builds execution manifests with ordering, readiness, and source freshness warnings', async () => {
    const { getWorkflowManifestForActor } = await import('./workflows');

    const manifest = await getWorkflowManifestForActor(actor, graph.id, 'external_evaluator');

    expect(manifest.graphId).toBe(graph.id);
    expect(manifest.execution.mode).toBe('external_evaluator');
    expect(manifest.execution.topologicalOrder).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
    ]);
    expect(manifest.execution.readyNodeIds).toEqual([
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
    ]);
    expect(manifest.execution.blockedNodeIds).toEqual(['44444444-4444-4444-8444-444444444444']);
    expect(manifest.execution.sourceFreshnessWarnings).toEqual([
      {
        nodeId: '22222222-2222-4222-8222-222222222222',
        name: 'Fetch Source',
        warning:
          'Fetch Source is never refreshed and should be refreshed before dependent reasoning.',
      },
    ]);
  });

  it('rejects cyclic graphs before emitting execution manifests', async () => {
    const { getWorkflowManifestForActor } = await import('./workflows');
    mockGetGraphForActor.mockResolvedValue({
      ...graph,
      edges: [
        ...graph.edges,
        {
          ...graph.edges[0],
          id: '77777777-7777-4777-8777-777777777777',
          source_node_id: '44444444-4444-4444-8444-444444444444',
          target_node_id: '22222222-2222-4222-8222-222222222222',
        },
      ],
    });

    await expect(getWorkflowManifestForActor(actor, graph.id)).rejects.toThrow(
      BreakdownServiceError,
    );
  });

  it('defaults missing import LLM metadata before creating graphs', async () => {
    const mockSupabase = createImportMockSupabase();
    mockCreateServerClient.mockReturnValue(mockSupabase.client);
    const { importGraphForActor } = await import('./workflows');

    const result = await importGraphForActor(writeActor, {
      mode: 'create',
      graph: {
        name: 'Imported smoke graph',
        description: null,
        llmProvider: null,
        llmModel: null,
      },
      nodes: [
        {
          id: 'source-node',
          name: 'Source',
          nodeType: 'default',
          prompt: 'Gather evidence',
          position: { x: 0, y: 0 },
        },
        {
          id: 'target-node',
          name: 'Target',
          nodeType: 'default',
          prompt: 'Analyze evidence',
          position: { x: 200, y: 0 },
        },
      ],
      edges: [
        {
          sourceNodeId: 'source-node',
          targetNodeId: 'target-node',
          edgeType: 'depends_on',
        },
      ],
    });

    expect(result.graphId).toBe(mockSupabase.importedGraphId);
    expect(mockSupabase.inserted.graphs[0]).toMatchObject({
      name: 'Imported smoke graph',
      llm_provider: 'anthropic',
      llm_model: 'claude-sonnet-4-6',
    });
    expect(mockSupabase.inserted.edges[0]).toMatchObject({
      graph_id: mockSupabase.importedGraphId,
      source_node_id: '88888888-8888-4888-8888-888888888888',
      target_node_id: '99999999-9999-4999-8999-999999999999',
    });
  });
});

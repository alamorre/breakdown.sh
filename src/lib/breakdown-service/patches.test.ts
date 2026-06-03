import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownActor } from './actor';
import { BreakdownServiceError } from './errors';

const {
  mockGetGraphForActor,
  mockCreateNodeForActor,
  mockUpdateNodeForActor,
  mockDeleteNodeForActor,
  mockCreateEdgeForActor,
  mockUpdateEdgeForActor,
  mockDeleteEdgeForActor,
  mockCreateServerClient,
} = vi.hoisted(() => ({
  mockGetGraphForActor: vi.fn(),
  mockCreateNodeForActor: vi.fn(),
  mockUpdateNodeForActor: vi.fn(),
  mockDeleteNodeForActor: vi.fn(),
  mockCreateEdgeForActor: vi.fn(),
  mockUpdateEdgeForActor: vi.fn(),
  mockDeleteEdgeForActor: vi.fn(),
  mockCreateServerClient: vi.fn(),
}));

vi.mock('./graphs', async (importOriginal) => {
  const original = await importOriginal<typeof import('./graphs')>();
  return {
    ...original,
    getGraphForActor: mockGetGraphForActor,
  };
});

vi.mock('./nodes', () => ({
  createNodeForActor: mockCreateNodeForActor,
  updateNodeForActor: mockUpdateNodeForActor,
  deleteNodeForActor: mockDeleteNodeForActor,
}));

vi.mock('./edges', () => ({
  createEdgeForActor: mockCreateEdgeForActor,
  updateEdgeForActor: mockUpdateEdgeForActor,
  deleteEdgeForActor: mockDeleteEdgeForActor,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

const actor: BreakdownActor = {
  userId: 'user_123',
  source: 'integration-token',
  scopes: ['graphs:write'],
  tokenId: '550e8400-e29b-41d4-a716-446655440000',
};

const graph = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user_123',
  name: 'Patch Graph',
  description: null,
  llm_provider: null,
  llm_model: null,
  created_at: '2026-06-03T00:00:00.000Z',
  updated_at: '2026-06-03T00:00:00.000Z',
  nodes: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      graph_id: '11111111-1111-4111-8111-111111111111',
      node_type: 'default',
      name: 'Source',
      prompt: 'Collect evidence',
      output: 'Evidence',
      metadata: {},
      run_status: 'success',
      run_error: null,
      last_run_at: '2026-06-03T00:00:00.000Z',
      position_x: 0,
      position_y: 0,
      created_at: '2026-06-03T00:00:00.000Z',
      updated_at: '2026-06-03T00:00:00.000Z',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      graph_id: '11111111-1111-4111-8111-111111111111',
      node_type: 'default',
      name: 'Analysis',
      prompt: 'Analyze evidence',
      output: null,
      metadata: {},
      run_status: 'idle',
      run_error: null,
      last_run_at: null,
      position_x: 200,
      position_y: 0,
      created_at: '2026-06-03T00:00:00.000Z',
      updated_at: '2026-06-03T00:00:00.000Z',
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      graph_id: '11111111-1111-4111-8111-111111111111',
      node_type: 'default',
      name: 'Composition',
      prompt: 'Synthesize answer',
      output: null,
      metadata: {},
      run_status: 'idle',
      run_error: null,
      last_run_at: null,
      position_x: 400,
      position_y: 0,
      created_at: '2026-06-03T00:00:00.000Z',
      updated_at: '2026-06-03T00:00:00.000Z',
    },
  ],
  edges: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      graph_id: '11111111-1111-4111-8111-111111111111',
      source_node_id: '22222222-2222-4222-8222-222222222222',
      target_node_id: '33333333-3333-4333-8333-333333333333',
      edge_type: 'depends_on',
      weight: 1,
      condition: null,
      transform: null,
      created_at: '2026-06-03T00:00:00.000Z',
      updated_at: '2026-06-03T00:00:00.000Z',
    },
  ],
};

describe('applyGraphPatchForActor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGraphForActor.mockResolvedValue(graph);
    mockCreateNodeForActor.mockResolvedValue({
      id: '66666666-6666-4666-8666-666666666666',
    });
    mockCreateServerClient.mockReturnValue({
      from: vi.fn(() => ({
        insert: vi.fn().mockResolvedValue({ error: null }),
      })),
    });
  });

  it('previews graph patch operations without mutating data', async () => {
    const { applyGraphPatchForActor } = await import('./patches');

    const result = await applyGraphPatchForActor(actor, graph.id, {
      dryRun: true,
      operations: [
        {
          op: 'add_node',
          clientId: 'new-summary',
          name: 'New Summary',
          prompt: 'Summarize the analysis',
          nodeType: 'default',
          positionX: 600,
          positionY: 0,
        },
        {
          op: 'update_node',
          nodeId: '33333333-3333-4333-8333-333333333333',
          name: 'Updated Analysis',
        },
        {
          op: 'add_edge',
          sourceNodeId: '22222222-2222-4222-8222-222222222222',
          targetClientId: 'new-summary',
          edgeType: 'inputs_to',
        },
        {
          op: 'update_edge',
          edgeId: '55555555-5555-4555-8555-555555555555',
          targetNodeId: '44444444-4444-4444-8444-444444444444',
          edgeType: 'supports',
        },
        {
          op: 'delete_edge',
          edgeId: '55555555-5555-4555-8555-555555555555',
          confirm: 'delete_edge',
        },
        {
          op: 'delete_node',
          nodeId: '44444444-4444-4444-8444-444444444444',
          confirm: 'delete_node',
        },
      ],
    });

    expect(result).toMatchObject({
      dryRun: true,
      applied: false,
      summary: '6 changes prepared; 2 destructive.',
    });
    expect(result.changes.map((change) => change.op)).toEqual([
      'add_node',
      'update_node',
      'add_edge',
      'update_edge',
      'delete_edge',
      'delete_node',
    ]);
    expect(mockCreateNodeForActor).not.toHaveBeenCalled();
  });

  it('rejects patches that would create a cycle', async () => {
    const { applyGraphPatchForActor } = await import('./patches');

    await expect(
      applyGraphPatchForActor(actor, graph.id, {
        dryRun: true,
        operations: [
          {
            op: 'add_edge',
            sourceNodeId: '33333333-3333-4333-8333-333333333333',
            targetNodeId: '22222222-2222-4222-8222-222222222222',
            edgeType: 'depends_on',
          },
        ],
      }),
    ).rejects.toThrow(BreakdownServiceError);
  });

  it('applies non-dry-run operations and audits the patch', async () => {
    const { applyGraphPatchForActor } = await import('./patches');

    const result = await applyGraphPatchForActor(actor, graph.id, {
      dryRun: false,
      operations: [
        {
          op: 'add_node',
          clientId: 'created',
          name: 'Created Node',
          prompt: 'Use this result',
        },
        {
          op: 'update_node',
          nodeId: '33333333-3333-4333-8333-333333333333',
          prompt: 'Updated prompt',
        },
        {
          op: 'add_edge',
          sourceNodeId: '22222222-2222-4222-8222-222222222222',
          targetClientId: 'created',
          edgeType: 'inputs_to',
        },
        {
          op: 'update_edge',
          edgeId: '55555555-5555-4555-8555-555555555555',
          edgeType: 'supports',
        },
        {
          op: 'delete_edge',
          edgeId: '55555555-5555-4555-8555-555555555555',
          confirm: 'delete_edge',
        },
        {
          op: 'delete_node',
          nodeId: '44444444-4444-4444-8444-444444444444',
          confirm: 'delete_node',
        },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.createdNodeIds).toEqual({
      created: '66666666-6666-4666-8666-666666666666',
    });
    expect(mockCreateNodeForActor).toHaveBeenCalledWith(actor, {
      graphId: graph.id,
      name: 'Created Node',
      prompt: 'Use this result',
      nodeType: undefined,
      metadata: undefined,
      positionX: 0,
      positionY: 0,
    });
    expect(mockUpdateNodeForActor).toHaveBeenCalled();
    expect(mockCreateEdgeForActor).toHaveBeenCalledWith(actor, {
      graphId: graph.id,
      sourceNodeId: '22222222-2222-4222-8222-222222222222',
      targetNodeId: '66666666-6666-4666-8666-666666666666',
      edgeType: 'inputs_to',
      weight: undefined,
      condition: undefined,
      transform: undefined,
    });
    expect(mockUpdateEdgeForActor).toHaveBeenCalled();
    expect(mockDeleteEdgeForActor).toHaveBeenCalledWith(
      actor,
      '55555555-5555-4555-8555-555555555555',
    );
    expect(mockDeleteNodeForActor).toHaveBeenCalledWith(
      actor,
      '44444444-4444-4444-8444-444444444444',
    );
  });
});

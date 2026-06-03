import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThesisActor } from './actor';
import { ThesisServiceError } from './errors';

const { mockGetGraphForActor } = vi.hoisted(() => ({
  mockGetGraphForActor: vi.fn(),
}));

vi.mock('./graphs', async (importOriginal) => {
  const original = await importOriginal<typeof import('./graphs')>();
  return {
    ...original,
    getGraphForActor: mockGetGraphForActor,
  };
});

const actor: ThesisActor = {
  userId: 'user_123',
  source: 'integration-token',
  scopes: ['graphs:read'],
  tokenId: '550e8400-e29b-41d4-a716-446655440000',
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
      prompt: 'Write final synthesis',
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

describe('headless workflow helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGraphForActor.mockResolvedValue(graph);
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

    await expect(getWorkflowManifestForActor(actor, graph.id)).rejects.toThrow(ThesisServiceError);
  });
});

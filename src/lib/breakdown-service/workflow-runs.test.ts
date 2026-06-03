import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownActor } from './actor';
import { BreakdownServiceError } from './errors';

const { mockCreateExternalRunForActor, mockGetNextExternalStepForActor, mockImportGraphForActor } =
  vi.hoisted(() => ({
    mockCreateExternalRunForActor: vi.fn(),
    mockGetNextExternalStepForActor: vi.fn(),
    mockImportGraphForActor: vi.fn(),
  }));

vi.mock('./external-runs', () => ({
  createExternalRunForActor: mockCreateExternalRunForActor,
  getNextExternalStepForActor: mockGetNextExternalStepForActor,
}));

vi.mock('./workflows', () => ({
  importGraphForActor: mockImportGraphForActor,
}));

const actor: BreakdownActor = {
  userId: 'user_123',
  source: 'integration-token',
  scopes: ['graphs:write', 'runs:external_execute'],
  tokenId: '550e8400-e29b-41d4-a716-446655440000',
};

const importGraph = {
  mode: 'create' as const,
  graph: {
    name: 'External workflow',
    description: 'A generic first-run DAG.',
  },
  nodes: [
    {
      id: 'step-1',
      name: 'Gather current evidence',
      prompt: 'Use host tools for current facts or block this step.',
      metadata: { requiresCurrentData: true },
      position: { x: 0, y: 0 },
    },
  ],
  edges: [],
};

const normalizedImportGraph = {
  ...importGraph,
  nodes: [
    {
      ...importGraph.nodes[0],
      nodeType: 'default',
      runStatus: 'idle',
    },
  ],
};

describe('import-and-run external workflow helper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockImportGraphForActor.mockResolvedValue({
      graphId: '11111111-1111-4111-8111-111111111111',
      nodeIdMap: { 'step-1': '22222222-2222-4222-8222-222222222222' },
      edgeCount: 0,
    });
    mockCreateExternalRunForActor.mockResolvedValue({
      runId: '33333333-3333-4333-8333-333333333333',
      graphId: '11111111-1111-4111-8111-111111111111',
      status: 'active',
      manifest: { graphId: '11111111-1111-4111-8111-111111111111' },
    });
    mockGetNextExternalStepForActor.mockResolvedValue({
      runId: '33333333-3333-4333-8333-333333333333',
      status: 'active',
      step: {
        stepId: '44444444-4444-4444-8444-444444444444',
        nodeId: '22222222-2222-4222-8222-222222222222',
        status: 'ready',
        contextVersion: 'ctx-1',
      },
    });
  });

  it('imports a generic DAG, starts an external run, and returns reopen context', async () => {
    const { importGraphAndCreateExternalRunForActor } = await import('./workflow-runs');

    const result = await importGraphAndCreateExternalRunForActor(
      actor,
      {
        importGraph,
        externalRun: {
          clientName: 'Codex',
          providerName: 'OpenAI',
          metadata: { goal: 'Analyze a public company' },
        },
      },
      'https://breakdown.example',
    );

    expect(mockImportGraphForActor).toHaveBeenCalledWith(actor, normalizedImportGraph);
    expect(mockCreateExternalRunForActor).toHaveBeenCalledWith(
      actor,
      '11111111-1111-4111-8111-111111111111',
      {
        clientName: 'Codex',
        providerName: 'OpenAI',
        metadata: { goal: 'Analyze a public company' },
      },
    );
    expect(mockGetNextExternalStepForActor).toHaveBeenCalledWith(
      actor,
      '33333333-3333-4333-8333-333333333333',
    );
    expect(result).toMatchObject({
      graphId: '11111111-1111-4111-8111-111111111111',
      graphUrl: 'https://breakdown.example/graph/11111111-1111-4111-8111-111111111111',
      externalRun: {
        runId: '33333333-3333-4333-8333-333333333333',
        nextStep: {
          step: {
            status: 'ready',
            contextVersion: 'ctx-1',
          },
        },
      },
    });
  });

  it('requires the graph-write and external-execute scopes before mutating', async () => {
    const { importGraphAndCreateExternalRunForActor } = await import('./workflow-runs');

    await expect(
      importGraphAndCreateExternalRunForActor(
        { ...actor, scopes: ['graphs:write'] },
        { importGraph },
      ),
    ).rejects.toThrow(BreakdownServiceError);
    expect(mockImportGraphForActor).not.toHaveBeenCalled();
    expect(mockCreateExternalRunForActor).not.toHaveBeenCalled();
  });
});

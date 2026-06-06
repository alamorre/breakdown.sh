import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownActor } from './actor';

const {
  mockImportGraphAndCreateExternalRunForActor,
  mockImportGraphForActor,
  mockMintIntegrationToken,
} = vi.hoisted(() => ({
  mockImportGraphAndCreateExternalRunForActor: vi.fn(),
  mockImportGraphForActor: vi.fn(),
  mockMintIntegrationToken: vi.fn(),
}));

vi.mock('./tokens', () => ({
  mintIntegrationToken: mockMintIntegrationToken,
}));

vi.mock('./workflow-runs', () => ({
  importGraphAndCreateExternalRunForActor: mockImportGraphAndCreateExternalRunForActor,
}));

vi.mock('./workflows', () => ({
  importGraphForActor: mockImportGraphForActor,
}));

const actor: BreakdownActor = {
  userId: 'user_123',
  source: 'clerk-session',
  scopes: ['graphs:read', 'graphs:write', 'runs:external_execute', 'runs:write_results'],
};

const safeRecord = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  user_id: 'user_123',
  name: 'Codex external console',
  token_prefix: 'bdk_bootstrap',
  scopes: ['graphs:read', 'graphs:write', 'runs:external_execute', 'runs:write_results'],
  purpose: 'mcp_client',
  created_by_user_id: 'user_123',
  created_at: '2026-06-03T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
  expires_at: null,
};

const importGraph = {
  mode: 'create' as const,
  graph: { name: 'First run DAG' },
  nodes: [
    {
      id: 'step-1',
      name: 'Gather evidence',
      prompt: 'Gather current evidence or block.',
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
      metadata: {},
      nodeType: 'default',
      runStatus: 'idle',
    },
  ],
};

describe('external-console onboarding service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMintIntegrationToken.mockResolvedValue({
      token: 'bdk_bootstrap_secret',
      record: safeRecord,
    });
    mockImportGraphAndCreateExternalRunForActor.mockResolvedValue({
      graphId: '11111111-1111-4111-8111-111111111111',
      graphUrl: 'https://breakdown.example/graph/11111111-1111-4111-8111-111111111111',
      nodeIdMap: { 'step-1': '22222222-2222-4222-8222-222222222222' },
      edgeCount: 0,
      manifest: { graphId: '11111111-1111-4111-8111-111111111111' },
      externalRun: {
        runId: '33333333-3333-4333-8333-333333333333',
        status: 'active',
        runResourceUri: 'breakdown://external-runs/33333333-3333-4333-8333-333333333333',
        nextStep: { step: { status: 'ready' } },
      },
    });
    mockImportGraphForActor.mockResolvedValue({
      graphId: '11111111-1111-4111-8111-111111111111',
      nodeIdMap: { 'step-1': '22222222-2222-4222-8222-222222222222' },
      edgeCount: 0,
    });
  });

  it('mints a scoped external-console token without requiring manual settings setup', async () => {
    const { bootstrapExternalConsoleForActor } = await import('./onboarding');

    const result = await bootstrapExternalConsoleForActor(
      { from: vi.fn() } as never,
      actor,
      { clientName: 'Codex', providerName: 'OpenAI' },
      'https://breakdown.example',
    );

    expect(mockMintIntegrationToken).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user_123',
      name: 'OpenAI external console',
      scopes: ['graphs:read', 'graphs:write', 'runs:external_execute', 'runs:write_results'],
    });
    expect(result.token).toBe('bdk_bootstrap_secret');
    expect(result.tokenRecord).not.toHaveProperty('token_hash');
    expect(result.sessionContext).toMatchObject({
      clientName: 'Codex',
      providerName: 'OpenAI',
      mcpUrl: 'https://breakdown.example/api/mcp',
      headlessApiBaseUrl: 'https://breakdown.example/api/headless',
      authorizationHeader: 'Bearer bdk_bootstrap_secret',
    });
  });

  it('can import a DAG and start the first external run during bootstrap', async () => {
    const { bootstrapExternalConsoleForActor } = await import('./onboarding');

    const result = await bootstrapExternalConsoleForActor(
      { from: vi.fn() } as never,
      actor,
      {
        clientName: 'Claude Desktop',
        workflow: {
          importGraph,
          externalRun: { metadata: { goal: 'First run' } },
        },
      },
      'https://breakdown.example',
    );

    expect(mockImportGraphAndCreateExternalRunForActor).toHaveBeenCalledWith(
      actor,
      {
        importGraph: normalizedImportGraph,
        externalRun: {
          clientName: 'Claude Desktop',
          providerName: undefined,
          metadata: {
            goal: 'First run',
            onboardedVia: 'headless-onboarding',
          },
        },
      },
      'https://breakdown.example',
    );
    expect(result.workflow?.externalRun?.runId).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('can import a DAG without creating an external run', async () => {
    const { bootstrapExternalConsoleForActor } = await import('./onboarding');

    const result = await bootstrapExternalConsoleForActor(
      { from: vi.fn() } as never,
      actor,
      {
        clientName: 'Bridge',
        workflow: {
          importGraph,
          createExternalRun: false,
        },
      },
      'https://breakdown.example',
    );

    expect(mockImportGraphForActor).toHaveBeenCalledWith(actor, normalizedImportGraph);
    expect(mockImportGraphAndCreateExternalRunForActor).not.toHaveBeenCalled();
    expect(result.workflow).toMatchObject({
      graphId: '11111111-1111-4111-8111-111111111111',
      graphUrl: 'https://breakdown.example/graph/11111111-1111-4111-8111-111111111111',
      manifest: null,
      externalRun: null,
    });
  });

  it('does not mint a one-time token when workflow bootstrap fails', async () => {
    mockImportGraphForActor.mockRejectedValue(new Error('Import failed'));
    const { bootstrapExternalConsoleForActor } = await import('./onboarding');

    await expect(
      bootstrapExternalConsoleForActor(
        { from: vi.fn() } as never,
        actor,
        {
          clientName: 'Bridge',
          workflow: {
            importGraph,
            createExternalRun: false,
          },
        },
        'https://breakdown.example',
      ),
    ).rejects.toThrow('Import failed');

    expect(mockMintIntegrationToken).not.toHaveBeenCalled();
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownActor } from '@/lib/breakdown-service/actor';
import { BreakdownServiceError } from '@/lib/breakdown-service/errors';

const { mockResolveHeadlessActor, mockCheckHeadlessRateLimit } = vi.hoisted(() => ({
  mockResolveHeadlessActor: vi.fn(),
  mockCheckHeadlessRateLimit: vi.fn(),
}));

vi.mock('@/lib/breakdown-service/actor', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/breakdown-service/actor')>();
  return {
    ...original,
    resolveHeadlessActor: mockResolveHeadlessActor,
  };
});

vi.mock('@/lib/breakdown-service/safety', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/breakdown-service/safety')>();
  return {
    ...original,
    checkHeadlessRateLimit: mockCheckHeadlessRateLimit,
  };
});

let GET: typeof import('./route').GET;

const fullScopeActor: BreakdownActor = {
  userId: 'user_123',
  source: 'integration-token',
  tokenName: 'Codex persistent setup',
  scopes: ['graphs:read', 'runs:external_execute', 'runs:write_results'],
};

function request(token?: string) {
  return new Request('https://breakdown.example/api/integrations/codex/diagnostics', {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

describe('/api/integrations/codex/diagnostics', () => {
  beforeAll(async () => {
    const route = await import('./route');
    GET = route.GET;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveHeadlessActor.mockResolvedValue(fullScopeActor);
  });

  it('returns ready diagnostics for a valid external-evaluator token', async () => {
    const response = await GET(request('bdk_valid'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({
      ok: true,
      state: 'ready',
      toolSurface: {
        diagnosticTool: 'diagnose_breakdown_setup',
        externalEvaluatorToolsAvailable: true,
      },
      setup: {
        diagnosticsUrl: 'https://breakdown.example/api/integrations/codex/diagnostics',
      },
    });
    expect(body.data.toolSurface.externalEvaluatorTools).toEqual(
      expect.arrayContaining(['get_next_step', 'submit_step_result', 'mark_step_blocked']),
    );
  });

  it('separates valid token with missing external-evaluator scopes', async () => {
    mockResolveHeadlessActor.mockResolvedValue({
      ...fullScopeActor,
      scopes: ['graphs:read'],
    });

    const response = await GET(request('bdk_read_only'));
    const body = await response.json();

    expect(body.data.ok).toBe(false);
    expect(body.data.state).toBe('missing_scope');
    expect(body.data.scopes.missing).toEqual(
      expect.arrayContaining(['runs:external_execute', 'runs:write_results']),
    );
  });

  it('returns machine-readable missing-token diagnostics instead of guessing', async () => {
    mockResolveHeadlessActor.mockRejectedValue(
      new BreakdownServiceError('unauthorized', 'Missing bearer token', 401),
    );

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({
      ok: false,
      state: 'missing_token',
      error: { code: 'unauthorized', message: 'Missing bearer token' },
    });
    expect(body.data.setup.nextSteps).toEqual(
      expect.arrayContaining([
        'Create an agent setup session and approve it in the browser while signed in to Breakdown.',
      ]),
    );
  });

  it('separates revoked tokens from missing tokens', async () => {
    mockResolveHeadlessActor.mockRejectedValue(
      new BreakdownServiceError('unauthorized', 'Integration token has been revoked', 401),
    );

    const response = await GET(request('bdk_revoked'));
    const body = await response.json();

    expect(body.data.state).toBe('revoked_token');
    expect(body.data.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'token_available', status: 'pass' }),
        expect.objectContaining({ id: 'token_valid', status: 'fail' }),
      ]),
    );
  });
});

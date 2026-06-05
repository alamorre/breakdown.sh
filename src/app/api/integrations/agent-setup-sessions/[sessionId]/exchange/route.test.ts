import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateServerClient, mockExchangeAgentSetupSession } = vi.hoisted(() => ({
  mockCreateServerClient: vi.fn(),
  mockExchangeAgentSetupSession: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock('@/lib/breakdown-service/agent-setup-sessions', () => ({
  exchangeAgentSetupSession: mockExchangeAgentSetupSession,
}));

let POST: typeof import('./route').POST;

const sessionId = '550e8400-e29b-41d4-a716-446655440000';

function request(body?: unknown) {
  return new Request(
    `https://breakdown.example/api/integrations/agent-setup-sessions/${sessionId}/exchange`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

describe('/api/integrations/agent-setup-sessions/:sessionId/exchange', () => {
  beforeAll(async () => {
    const route = await import('./route');
    POST = route.POST;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    mockCreateServerClient.mockReturnValue({ from: vi.fn() });
    mockExchangeAgentSetupSession.mockResolvedValue({
      token: 'bdk_bootstrap_secret',
      sessionContext: {
        mcpUrl: 'https://breakdown.example/api/mcp',
        authorizationHeader: 'Bearer bdk_bootstrap_secret',
      },
      setupSession: { id: sessionId, status: 'exchanged' },
    });
  });

  it('exchanges an approved setup session for the one-time token response', async () => {
    const response = await POST(request({ exchangeSecret: 'bds_setup_secret' }), {
      params: Promise.resolve({ sessionId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      token: 'bdk_bootstrap_secret',
      setupSession: { status: 'exchanged' },
    });
    expect(mockExchangeAgentSetupSession).toHaveBeenCalledWith(
      expect.anything(),
      { sessionId },
      { exchangeSecret: 'bds_setup_secret' },
      'https://breakdown.example',
    );
  });
});

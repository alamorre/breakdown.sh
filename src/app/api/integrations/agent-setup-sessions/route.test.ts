import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateAgentSetupSession, mockCreateServerClient } = vi.hoisted(() => ({
  mockCreateAgentSetupSession: vi.fn(),
  mockCreateServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock('@/lib/breakdown-service/agent-setup-sessions', () => ({
  createAgentSetupSession: mockCreateAgentSetupSession,
}));

let GET: typeof import('./route').GET;
let POST: typeof import('./route').POST;

function request(body?: unknown) {
  return new Request('https://breakdown.example/api/integrations/agent-setup-sessions', {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('/api/integrations/agent-setup-sessions', () => {
  beforeAll(async () => {
    const route = await import('./route');
    GET = route.GET;
    POST = route.POST;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    mockCreateServerClient.mockReturnValue({ from: vi.fn() });
    mockCreateAgentSetupSession.mockResolvedValue({
      id: '550e8400-e29b-41d4-a716-446655440000',
      approveUrl:
        'https://breakdown.example/agent/setup/550e8400-e29b-41d4-a716-446655440000?code=ABCD-1234',
      userCode: 'ABCD-1234',
      exchangeSecret: 'bds_setup_secret',
      exchangeUrl:
        'https://breakdown.example/api/integrations/agent-setup-sessions/550e8400-e29b-41d4-a716-446655440000/exchange',
      status: 'pending',
    });
  });

  it('advertises the approval-session endpoint in discovery metadata', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.endpoints.agentSetupSessionsUrl).toBe(
      'https://breakdown.example/api/integrations/agent-setup-sessions',
    );
    expect(body.endpoints.codexDiagnosticsUrl).toBe(
      'https://breakdown.example/api/integrations/codex/diagnostics',
    );
    expect(body.auth.agentSetup).toBe('approval-session');
    expect(body.auth.codexDiagnostics).toBe('optional-bearer-token');
  });

  it('creates a pending agent setup session without requiring a Clerk cookie', async () => {
    const response = await POST(request({ clientName: 'Codex', providerName: 'OpenAI' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      userCode: 'ABCD-1234',
      exchangeSecret: 'bds_setup_secret',
      status: 'pending',
    });
    expect(mockCreateAgentSetupSession).toHaveBeenCalledWith(
      expect.anything(),
      { clientName: 'Codex', providerName: 'OpenAI' },
      'https://breakdown.example',
    );
  });
});

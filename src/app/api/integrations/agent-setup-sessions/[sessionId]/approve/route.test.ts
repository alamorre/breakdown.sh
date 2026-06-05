import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockApproveAgentSetupSession, mockCreateServerClient, mockResolveClerkActor } = vi.hoisted(
  () => ({
    mockApproveAgentSetupSession: vi.fn(),
    mockCreateServerClient: vi.fn(),
    mockResolveClerkActor: vi.fn(),
  }),
);

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock('@/lib/breakdown-service/actor', () => ({
  resolveClerkActor: mockResolveClerkActor,
}));

vi.mock('@/lib/breakdown-service/agent-setup-sessions', () => ({
  approveAgentSetupSession: mockApproveAgentSetupSession,
}));

let POST: typeof import('./route').POST;

const sessionId = '550e8400-e29b-41d4-a716-446655440000';

function request(body?: unknown) {
  return new Request(
    `https://breakdown.example/api/integrations/agent-setup-sessions/${sessionId}/approve`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
}

describe('/api/integrations/agent-setup-sessions/:sessionId/approve', () => {
  beforeAll(async () => {
    const route = await import('./route');
    POST = route.POST;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    mockResolveClerkActor.mockResolvedValue({
      userId: 'user_123',
      source: 'clerk-session',
      scopes: ['graphs:read'],
    });
    mockCreateServerClient.mockReturnValue({ from: vi.fn() });
    mockApproveAgentSetupSession.mockResolvedValue({
      id: sessionId,
      status: 'approved',
      approvedAt: '2026-06-05T12:00:00Z',
    });
  });

  it('requires a signed-in Breakdown user to approve', async () => {
    mockResolveClerkActor.mockRejectedValue(new Error('Unauthorized'));

    const response = await POST(request({ userCode: 'ABCD-1234' }), {
      params: Promise.resolve({ sessionId }),
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
    expect(mockApproveAgentSetupSession).not.toHaveBeenCalled();
  });

  it('approves the setup session for the signed-in actor', async () => {
    const response = await POST(request({ userCode: 'ABCD-1234' }), {
      params: Promise.resolve({ sessionId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('approved');
    expect(mockApproveAgentSetupSession).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user_123' }),
      { sessionId },
      { userCode: 'ABCD-1234' },
      'https://breakdown.example',
    );
  });
});

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBootstrapExternalConsoleForActor,
  mockCreateServerClient,
  mockResolveClerkActor,
} = vi.hoisted(() => ({
  mockBootstrapExternalConsoleForActor: vi.fn(),
  mockCreateServerClient: vi.fn(),
  mockResolveClerkActor: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock('@/lib/thesis-service/actor', () => ({
  resolveClerkActor: mockResolveClerkActor,
}));

vi.mock('@/lib/thesis-service/onboarding', () => ({
  bootstrapExternalConsoleForActor: mockBootstrapExternalConsoleForActor,
}));

let GET: typeof import('./route').GET;
let POST: typeof import('./route').POST;

function request(body?: unknown) {
  return new Request('https://breakdown.example/api/integrations/headless-onboarding', {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe('/api/integrations/headless-onboarding', () => {
  beforeAll(async () => {
    const route = await import('./route');
    GET = route.GET;
    POST = route.POST;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    mockResolveClerkActor.mockResolvedValue({
      userId: 'user_123',
      source: 'clerk-session',
      scopes: ['graphs:read', 'graphs:write', 'runs:external_execute', 'runs:write_results'],
    });
    mockCreateServerClient.mockReturnValue({ from: vi.fn() });
    mockBootstrapExternalConsoleForActor.mockResolvedValue({
      token: 'bdk_bootstrap_secret',
      sessionContext: {
        mcpUrl: 'https://breakdown.example/api/mcp',
        headlessApiBaseUrl: 'https://breakdown.example/api/headless',
      },
      workflow: null,
    });
  });

  it('returns provider-neutral discovery metadata', async () => {
    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.configured).toBe(true);
    expect(body.endpoints).toMatchObject({
      signInUrl: 'https://breakdown.example/sign-in',
      bootstrapUrl: 'https://breakdown.example/api/integrations/headless-onboarding',
      mcpUrl: 'https://breakdown.example/api/mcp',
    });
    expect(body.auth.defaultScopes).toEqual([
      'graphs:read',
      'graphs:write',
      'runs:external_execute',
      'runs:write_results',
    ]);
  });

  it('requires a signed-in Breakdown session for bootstrap', async () => {
    mockResolveClerkActor.mockRejectedValue(new Error('Unauthorized'));

    const response = await POST(request({ clientName: 'Codex' }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe('unauthorized');
    expect(mockBootstrapExternalConsoleForActor).not.toHaveBeenCalled();
  });

  it('returns a one-time token and session context from the bootstrap service', async () => {
    const response = await POST(request({ clientName: 'Codex' }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.token).toBe('bdk_bootstrap_secret');
    expect(mockBootstrapExternalConsoleForActor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user_123' }),
      { clientName: 'Codex' },
      'https://breakdown.example',
    );
  });

  it('reports missing token storage configuration after auth succeeds', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = await POST(request({ clientName: 'Codex' }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.message).toContain('not configured');
    expect(mockBootstrapExternalConsoleForActor).not.toHaveBeenCalled();
  });
});

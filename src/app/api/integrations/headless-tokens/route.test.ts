import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ThesisScope } from '@/lib/thesis-service/scopes';

const {
  mockAuth,
  mockCreateServerClient,
  mockListIntegrationTokens,
  mockMintIntegrationToken,
  mockRevokeIntegrationToken,
} = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCreateServerClient: vi.fn(),
  mockListIntegrationTokens: vi.fn(),
  mockMintIntegrationToken: vi.fn(),
  mockRevokeIntegrationToken: vi.fn(),
}));

vi.mock('@clerk/nextjs/server', () => ({
  auth: mockAuth,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock('@/lib/thesis-service/tokens', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/thesis-service/tokens')>();
  return {
    ...original,
    listIntegrationTokens: mockListIntegrationTokens,
    mintIntegrationToken: mockMintIntegrationToken,
    revokeIntegrationToken: mockRevokeIntegrationToken,
  };
});

let GET: typeof import('./route').GET;
let POST: typeof import('./route').POST;
let DELETE: typeof import('./[tokenId]/route').DELETE;

const safeRecord = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  user_id: 'user_123',
  name: 'Preview MCP',
  token_prefix: 'bdk_preview',
  scopes: ['graphs:read', 'graphs:write'] as ThesisScope[],
  created_at: '2026-06-03T00:00:00Z',
  last_used_at: null,
  revoked_at: null,
};

function jsonRequest(body: unknown) {
  return new Request('http://localhost/api/integrations/headless-tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/integrations/headless-tokens', () => {
  beforeAll(async () => {
    const route = await import('./route');
    const revokeRoute = await import('./[tokenId]/route');
    GET = route.GET;
    POST = route.POST;
    DELETE = revokeRoute.DELETE;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    mockAuth.mockResolvedValue({ userId: 'user_123' });
    mockCreateServerClient.mockReturnValue({ from: vi.fn() });
    mockListIntegrationTokens.mockResolvedValue([safeRecord]);
    mockMintIntegrationToken.mockResolvedValue({
      token: 'bdk_preview_secret',
      record: safeRecord,
    });
    mockRevokeIntegrationToken.mockResolvedValue(undefined);
  });

  it('requires a Clerk session', async () => {
    mockAuth.mockResolvedValue({ userId: null });

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  it('lists safe integration-token records for the signed-in user', async () => {
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockListIntegrationTokens).toHaveBeenCalledWith(expect.anything(), 'user_123');
    expect(body.tokens).toEqual([
      {
        id: safeRecord.id,
        name: 'Preview MCP',
        tokenPrefix: 'bdk_preview',
        scopes: ['graphs:read', 'graphs:write'],
        createdAt: '2026-06-03T00:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
      },
    ]);
    expect(JSON.stringify(body)).not.toContain('token_hash');
  });

  it('mints a token for the signed-in user and returns the raw token once', async () => {
    const response = await POST(jsonRequest({ name: 'Preview MCP', scopes: ['graphs:read'] }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(mockMintIntegrationToken).toHaveBeenCalledWith(expect.anything(), {
      userId: 'user_123',
      name: 'Preview MCP',
      scopes: ['graphs:read'],
    });
    expect(body.token).toBe('bdk_preview_secret');
    expect(body.record.tokenPrefix).toBe('bdk_preview');
    expect(body.record).not.toHaveProperty('token_hash');
  });

  it('rejects invalid token creation requests', async () => {
    const response = await POST(jsonRequest({ name: '', scopes: [] }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toContain('Too small');
    expect(mockMintIntegrationToken).not.toHaveBeenCalled();
  });

  it('reports missing token storage configuration', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.configured).toBe(false);
    expect(body.error).toContain('not configured');
    expect(mockListIntegrationTokens).not.toHaveBeenCalled();
  });

  it('revokes a token for the signed-in user', async () => {
    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ tokenId: safeRecord.id }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mockRevokeIntegrationToken).toHaveBeenCalledWith(
      expect.anything(),
      { userId: 'user_123' },
      { tokenId: safeRecord.id },
    );
  });
});

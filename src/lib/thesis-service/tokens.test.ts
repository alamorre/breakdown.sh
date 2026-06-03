import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRawIntegrationToken,
  hashIntegrationToken,
  resolveIntegrationToken,
} from './tokens';
import { ThesisServiceError } from './errors';

const mockSingle = vi.fn();
const mockIs = vi.fn();

function createMockSupabase() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: mockSingle,
    update: vi.fn(() => chain),
    is: mockIs,
  };
  return {
    from: vi.fn(() => chain),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIs.mockResolvedValue({ error: null });
});

describe('integration token helpers', () => {
  it('creates opaque Breakdown-prefixed tokens', () => {
    const { token, tokenPrefix } = createRawIntegrationToken();

    expect(token).toMatch(/^bdk_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
    expect(token.startsWith(`${tokenPrefix}_`)).toBe(true);
  });

  it('hashes tokens deterministically', () => {
    expect(hashIntegrationToken('bdk_test_secret')).toBe(hashIntegrationToken('bdk_test_secret'));
    expect(hashIntegrationToken('bdk_test_secret')).not.toBe(hashIntegrationToken('bdk_other_secret'));
  });

  it('resolves an active token into an integration actor', async () => {
    const token = 'bdk_test_secret';
    mockSingle.mockResolvedValue({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        user_id: 'user_123',
        name: 'Local MCP',
        scopes: ['graphs:read', 'runs:external_execute'],
        revoked_at: null,
      },
      error: null,
    });

    const actor = await resolveIntegrationToken(createMockSupabase() as never, token);

    expect(actor).toMatchObject({
      userId: 'user_123',
      source: 'integration-token',
      tokenId: '550e8400-e29b-41d4-a716-446655440000',
      scopes: ['graphs:read', 'runs:external_execute'],
    });
  });

  it('rejects revoked tokens', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        user_id: 'user_123',
        name: 'Local MCP',
        scopes: ['graphs:read'],
        revoked_at: '2026-06-03T00:00:00Z',
      },
      error: null,
    });

    await expect(resolveIntegrationToken(createMockSupabase() as never, 'bdk_test_secret')).rejects.toThrow(
      ThesisServiceError,
    );
  });

  it('rejects invalid token prefixes before hitting storage', async () => {
    await expect(resolveIntegrationToken(createMockSupabase() as never, 'not-a-token')).rejects.toThrow(
      'Invalid bearer token',
    );
    expect(mockSingle).not.toHaveBeenCalled();
  });
});

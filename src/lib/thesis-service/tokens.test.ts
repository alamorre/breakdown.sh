import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRawIntegrationToken,
  hashIntegrationToken,
  listIntegrationTokens,
  mintIntegrationToken,
  resolveIntegrationToken,
  revokeIntegrationToken,
} from './tokens';
import { ThesisServiceError } from './errors';

const mockSingle = vi.fn();
const mockIs = vi.fn();
const mockOrder = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockUpdate = vi.fn();

function createMockSupabase() {
  const chain = {
    select: mockSelect,
    eq: mockEq,
    single: mockSingle,
    order: mockOrder,
    insert: mockInsert,
    update: mockUpdate,
    is: mockIs,
  };
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockInsert.mockReturnValue(chain);
  mockUpdate.mockReturnValue(chain);
  return {
    from: vi.fn(() => chain),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIs.mockResolvedValue({ error: null });
  mockOrder.mockResolvedValue({ data: [], error: null });
});

describe('integration token helpers', () => {
  it('creates opaque Breakdown-prefixed tokens', () => {
    const { token, tokenPrefix } = createRawIntegrationToken();

    expect(token).toMatch(/^bdk_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
    expect(token.startsWith(`${tokenPrefix}_`)).toBe(true);
  });

  it('hashes tokens deterministically', () => {
    expect(hashIntegrationToken('bdk_test_secret')).toBe(hashIntegrationToken('bdk_test_secret'));
    expect(hashIntegrationToken('bdk_test_secret')).not.toBe(
      hashIntegrationToken('bdk_other_secret'),
    );
  });

  it('mints a token and stores only the hash', async () => {
    mockSingle.mockResolvedValue({
      data: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        user_id: 'user_123',
        name: 'Preview MCP',
        token_prefix: 'bdk_prefix',
        scopes: ['graphs:read'],
        created_at: '2026-06-03T00:00:00Z',
        last_used_at: null,
        revoked_at: null,
      },
      error: null,
    });

    const result = await mintIntegrationToken(createMockSupabase() as never, {
      userId: 'user_123',
      name: 'Preview MCP',
      scopes: ['graphs:read'],
    });

    expect(result.token).toMatch(/^bdk_/);
    expect(result.record).not.toHaveProperty('token_hash');
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user_123',
        name: 'Preview MCP',
        token_hash: hashIntegrationToken(result.token),
        token_prefix: expect.stringMatching(/^bdk_/),
        scopes: ['graphs:read'],
      }),
    );
  });

  it('lists safe token records for a user', async () => {
    mockOrder.mockResolvedValue({
      data: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000',
          user_id: 'user_123',
          name: 'Local MCP',
          token_prefix: 'bdk_visible',
          scopes: ['graphs:read'],
          created_at: '2026-06-03T00:00:00Z',
          last_used_at: null,
          revoked_at: null,
        },
      ],
      error: null,
    });

    const tokens = await listIntegrationTokens(createMockSupabase() as never, 'user_123');

    expect(mockEq).toHaveBeenCalledWith('user_id', 'user_123');
    expect(mockOrder).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(tokens[0]).not.toHaveProperty('token_hash');
    expect(tokens[0]?.token_prefix).toBe('bdk_visible');
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

    await expect(
      resolveIntegrationToken(createMockSupabase() as never, 'bdk_test_secret'),
    ).rejects.toThrow(ThesisServiceError);
  });

  it('rejects invalid token prefixes before hitting storage', async () => {
    await expect(
      resolveIntegrationToken(createMockSupabase() as never, 'not-a-token'),
    ).rejects.toThrow('Invalid bearer token');
    expect(mockSingle).not.toHaveBeenCalled();
  });

  it('revokes tokens for the owning user only', async () => {
    await revokeIntegrationToken(
      createMockSupabase() as never,
      { userId: 'user_123' },
      { tokenId: '550e8400-e29b-41d4-a716-446655440000' },
    );

    expect(mockUpdate).toHaveBeenCalledWith({ revoked_at: expect.any(String) });
    expect(mockEq).toHaveBeenCalledWith('id', '550e8400-e29b-41d4-a716-446655440000');
    expect(mockEq).toHaveBeenCalledWith('user_id', 'user_123');
    expect(mockIs).toHaveBeenCalledWith('revoked_at', null);
  });
});

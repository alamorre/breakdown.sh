import { createHash } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BreakdownActor } from './actor';

const { mockBootstrapExternalConsoleForActor } = vi.hoisted(() => ({
  mockBootstrapExternalConsoleForActor: vi.fn(),
}));

vi.mock('./onboarding', () => ({
  bootstrapExternalConsoleForActor: mockBootstrapExternalConsoleForActor,
}));

const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();

function createMockSupabase() {
  const chain = {
    select: mockSelect,
    eq: mockEq,
    single: mockSingle,
    insert: mockInsert,
    update: mockUpdate,
  };
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockInsert.mockReturnValue(chain);
  mockUpdate.mockReturnValue(chain);
  return {
    from: vi.fn(() => chain),
  };
}

function hash(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

const sessionId = '550e8400-e29b-41d4-a716-446655440000';
const now = '2026-06-05T12:00:00.000Z';
const future = '2026-06-05T12:15:00.000Z';
const exchangeSecret = 'bds_test_secret';

function sessionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    user_code: 'ABCD-1234',
    exchange_secret_hash: hash(exchangeSecret),
    client_name: 'Codex',
    provider_name: 'OpenAI',
    token_name: null,
    scopes: ['graphs:read', 'graphs:write', 'runs:external_execute', 'runs:write_results'],
    workflow: null,
    status: 'pending',
    created_at: now,
    expires_at: future,
    approved_by_user_id: null,
    approved_at: null,
    exchanged_at: null,
    token_id: null,
    ...overrides,
  };
}

const actor: BreakdownActor = {
  userId: 'user_123',
  source: 'clerk-session',
  scopes: ['graphs:read', 'graphs:write', 'runs:external_execute', 'runs:write_results'],
};

describe('agent setup sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    mockBootstrapExternalConsoleForActor.mockResolvedValue({
      token: 'bdk_result_secret',
      tokenRecord: {
        id: '660e8400-e29b-41d4-a716-446655440000',
        name: 'OpenAI external console',
        tokenPrefix: 'bdk_result',
        scopes: ['graphs:read'],
        createdAt: now,
        lastUsedAt: null,
        revokedAt: null,
      },
      sessionContext: {
        mcpUrl: 'https://breakdown.example/api/mcp',
        headlessApiBaseUrl: 'https://breakdown.example/api/headless',
      },
      workflow: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a pending session with a hashed exchange secret', async () => {
    const { createAgentSetupSession } = await import('./agent-setup-sessions');
    mockSingle.mockResolvedValue({ data: sessionRecord(), error: null });

    const result = await createAgentSetupSession(
      createMockSupabase() as never,
      { clientName: 'Codex', providerName: 'OpenAI' },
      'https://breakdown.example',
    );

    const inserted = mockInsert.mock.calls[0]?.[0];
    expect(result.exchangeSecret).toMatch(/^bds_/);
    expect(inserted.exchange_secret_hash).toBe(hash(result.exchangeSecret));
    expect(inserted).not.toHaveProperty('exchangeSecret');
    expect(result).toMatchObject({
      approveUrl: `https://breakdown.example/agent/setup/${sessionId}?code=ABCD-1234`,
      exchangeUrl: `https://breakdown.example/api/integrations/agent-setup-sessions/${sessionId}/exchange`,
      status: 'pending',
    });
  });

  it('approves a pending setup session for the signed-in actor', async () => {
    const { approveAgentSetupSession } = await import('./agent-setup-sessions');
    mockSingle.mockResolvedValueOnce({ data: sessionRecord(), error: null }).mockResolvedValueOnce({
      data: sessionRecord({
        status: 'approved',
        approved_by_user_id: 'user_123',
        approved_at: now,
      }),
      error: null,
    });

    const result = await approveAgentSetupSession(
      createMockSupabase() as never,
      actor,
      { sessionId },
      { userCode: 'abcd-1234' },
      'https://breakdown.example',
    );

    expect(mockUpdate).toHaveBeenCalledWith({
      status: 'approved',
      approved_by_user_id: 'user_123',
      approved_at: expect.any(String),
    });
    expect(mockEq).toHaveBeenCalledWith('status', 'pending');
    expect(result.status).toBe('approved');
  });

  it('rejects exchange before user approval', async () => {
    const { exchangeAgentSetupSession } = await import('./agent-setup-sessions');
    mockSingle.mockResolvedValue({ data: sessionRecord(), error: null });

    await expect(
      exchangeAgentSetupSession(
        createMockSupabase() as never,
        { sessionId },
        { exchangeSecret },
        'https://breakdown.example',
      ),
    ).rejects.toThrow('has not been approved');

    expect(mockBootstrapExternalConsoleForActor).not.toHaveBeenCalled();
  });

  it('exchanges an approved setup session for a scoped token response', async () => {
    const { exchangeAgentSetupSession } = await import('./agent-setup-sessions');
    const approved = sessionRecord({
      status: 'approved',
      approved_by_user_id: 'user_123',
      approved_at: now,
    });
    mockSingle
      .mockResolvedValueOnce({ data: approved, error: null })
      .mockResolvedValueOnce({ data: { ...approved, status: 'exchanging' }, error: null });

    const result = await exchangeAgentSetupSession(
      createMockSupabase() as never,
      { sessionId },
      { exchangeSecret },
      'https://breakdown.example',
    );

    expect(mockBootstrapExternalConsoleForActor).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user_123', source: 'clerk-session' }),
      expect.objectContaining({ clientName: 'Codex', providerName: 'OpenAI' }),
      'https://breakdown.example',
    );
    expect(mockUpdate).toHaveBeenCalledWith({ status: 'exchanging' });
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'exchanged',
        token_id: '660e8400-e29b-41d4-a716-446655440000',
      }),
    );
    expect(result.token).toBe('bdk_result_secret');
    expect(result.setupSession.status).toBe('exchanged');
  });
});

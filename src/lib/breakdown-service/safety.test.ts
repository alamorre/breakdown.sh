import { describe, expect, it, vi } from 'vitest';
import type { BreakdownActor } from './actor';
import { BreakdownServiceError } from './errors';
import {
  assertTextByteLimit,
  auditHeadlessOperation,
  checkHeadlessRateLimit,
  completeIdempotencyKey,
  getIdempotentResponse,
  hashPayload,
  reserveIdempotencyKey,
} from './safety';

function chainWithSingle(result: unknown) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    single: vi.fn().mockResolvedValue(result),
  };
  return chain;
}

const actor: BreakdownActor = {
  userId: 'user_123',
  source: 'integration-token',
  scopes: ['graphs:read'],
  tokenId: '550e8400-e29b-41d4-a716-446655440000',
};

describe('headless safety helpers', () => {
  it('enforces text byte limits', () => {
    expect(() => assertTextByteLimit('short', 10, 'Prompt')).not.toThrow();
    expect(() => assertTextByteLimit('too long', 3, 'Prompt')).toThrow(BreakdownServiceError);
  });

  it('hashes payloads deterministically', () => {
    expect(hashPayload({ a: 1 })).toBe(hashPayload({ a: 1 }));
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });

  it('rate limits repeated integration-token calls', () => {
    const limitedActor = { ...actor, tokenId: 'rate-limit-token' };

    for (let index = 0; index < 240; index += 1) {
      expect(() => checkHeadlessRateLimit(limitedActor)).not.toThrow();
    }

    expect(() => checkHeadlessRateLimit(limitedActor)).toThrow('Too many headless requests');
  });

  it('writes audit log records with actor metadata', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const supabase = { from: vi.fn(() => ({ insert })) };

    await auditHeadlessOperation(supabase as never, {
      actor,
      operation: 'graph.create',
      targetType: 'graph',
      targetId: 'graph-1',
      graphId: 'graph-1',
      destructive: false,
      idempotencyKey: 'retry-1',
      requestSummary: { name: 'Graph' },
      responseSummary: { ok: true },
    });

    expect(supabase.from).toHaveBeenCalledWith('headless_audit_logs');
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user_123',
        actor_source: 'integration-token',
        actor_token_id: actor.tokenId,
        operation: 'graph.create',
        idempotency_key: 'retry-1',
      }),
    );
  });

  it('returns null when no idempotency key is supplied', async () => {
    await expect(
      getIdempotentResponse({ from: vi.fn() } as never, {
        actor,
        key: null,
        method: 'POST',
        path: '/api/headless/graphs',
        requestHash: 'abc',
      }),
    ).resolves.toBeNull();
  });

  it('replays completed idempotent responses', async () => {
    const supabase = {
      from: vi.fn(() =>
        chainWithSingle({
          data: {
            request_hash: 'abc',
            response_status: 200,
            response_body: { data: { ok: true }, error: null },
            completed_at: '2026-06-03T00:00:00.000Z',
          },
          error: null,
        }),
      ),
    };

    await expect(
      getIdempotentResponse(supabase as never, {
        actor,
        key: 'retry-1',
        method: 'POST',
        path: '/api/headless/graphs',
        requestHash: 'abc',
      }),
    ).resolves.toEqual({
      status: 200,
      body: { data: { ok: true }, error: null },
    });
  });

  it('rejects reused idempotency keys with different payloads', async () => {
    const supabase = {
      from: vi.fn(() =>
        chainWithSingle({
          data: {
            request_hash: 'abc',
            response_status: 200,
            response_body: { data: { ok: true }, error: null },
            completed_at: '2026-06-03T00:00:00.000Z',
          },
          error: null,
        }),
      ),
    };

    await expect(
      getIdempotentResponse(supabase as never, {
        actor,
        key: 'retry-1',
        method: 'POST',
        path: '/api/headless/graphs',
        requestHash: 'different',
      }),
    ).rejects.toThrow('different request body');
  });

  it('rejects idempotency keys that are still in progress', async () => {
    const supabase = {
      from: vi.fn(() =>
        chainWithSingle({
          data: {
            request_hash: 'abc',
            response_status: null,
            response_body: null,
            completed_at: null,
          },
          error: null,
        }),
      ),
    };

    await expect(
      getIdempotentResponse(supabase as never, {
        actor,
        key: 'retry-1',
        method: 'POST',
        path: '/api/headless/graphs',
        requestHash: 'abc',
      }),
    ).rejects.toThrow('still in progress');
  });

  it('reserves and completes idempotency keys', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const updateChain = {
      eq: vi.fn(() => updateChain),
    };
    const update = vi.fn(() => updateChain);
    const supabase = {
      from: vi.fn(() => ({
        insert,
        update,
      })),
    };

    await reserveIdempotencyKey(supabase as never, {
      actor,
      key: 'retry-2',
      method: 'POST',
      path: '/api/headless/graphs',
      requestHash: 'abc',
    });
    await completeIdempotencyKey(supabase as never, {
      actor,
      key: 'retry-2',
      status: 200,
      body: { data: { ok: true }, error: null },
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user_123',
        key: 'retry-2',
        request_hash: 'abc',
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        response_status: 200,
        response_body: { data: { ok: true }, error: null },
      }),
    );
  });

  it('rejects failed idempotency reservations when no replay is available', async () => {
    const chain = {
      insert: vi.fn().mockResolvedValue({ error: { message: 'duplicate key' } }),
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
    };
    const supabase = {
      from: vi.fn(() => chain),
    };

    await expect(
      reserveIdempotencyKey(supabase as never, {
        actor,
        key: 'retry-3',
        method: 'POST',
        path: '/api/headless/graphs',
        requestHash: 'abc',
      }),
    ).rejects.toThrow('duplicate key');
  });
});

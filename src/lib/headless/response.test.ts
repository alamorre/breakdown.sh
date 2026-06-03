import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { ThesisActor } from '@/lib/thesis-service/actor';
import { ThesisServiceError } from '@/lib/thesis-service/errors';

const {
  mockResolveHeadlessActor,
  mockCheckHeadlessRateLimit,
  mockCreateServerClient,
  mockGetIdempotentResponse,
  mockReserveIdempotencyKey,
  mockCompleteIdempotencyKey,
} = vi.hoisted(() => ({
  mockResolveHeadlessActor: vi.fn(),
  mockCheckHeadlessRateLimit: vi.fn(),
  mockCreateServerClient: vi.fn(),
  mockGetIdempotentResponse: vi.fn(),
  mockReserveIdempotencyKey: vi.fn(),
  mockCompleteIdempotencyKey: vi.fn(),
}));

vi.mock('@/lib/thesis-service/actor', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/thesis-service/actor')>();
  return {
    ...original,
    resolveHeadlessActor: mockResolveHeadlessActor,
  };
});

vi.mock('@/lib/thesis-service/safety', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/thesis-service/safety')>();
  return {
    ...original,
    checkHeadlessRateLimit: mockCheckHeadlessRateLimit,
    getIdempotentResponse: mockGetIdempotentResponse,
    reserveIdempotencyKey: mockReserveIdempotencyKey,
    completeIdempotencyKey: mockCompleteIdempotencyKey,
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: mockCreateServerClient,
}));

const actor: ThesisActor = {
  userId: 'user_123',
  source: 'integration-token',
  scopes: ['graphs:read', 'graphs:write'],
  tokenId: '550e8400-e29b-41d4-a716-446655440000',
};

function jsonRequest(body: unknown, headers: HeadersInit = {}) {
  return new Request('http://localhost/api/headless/graphs', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe('headless response helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveHeadlessActor.mockResolvedValue(actor);
    mockCreateServerClient.mockReturnValue({ from: vi.fn() });
    mockGetIdempotentResponse.mockResolvedValue(null);
  });

  it('wraps successful data in the headless envelope', async () => {
    const { headlessOk } = await import('./response');

    const response = headlessOk({ ok: true }, 201);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({ data: { ok: true }, error: null });
  });

  it('wraps service errors in the headless error envelope', async () => {
    const { headlessError } = await import('./response');

    const response = headlessError(
      new ThesisServiceError('forbidden', 'Missing required scope', 403, {
        requiredScope: 'graphs:write',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toEqual({
      code: 'forbidden',
      message: 'Missing required scope',
      details: { requiredScope: 'graphs:write' },
    });
  });

  it('parses and validates JSON request bodies', async () => {
    const { readJsonBody } = await import('./response');

    await expect(
      readJsonBody(jsonRequest({ name: 'Graph' }), z.object({ name: z.string().min(1) })),
    ).resolves.toEqual({ name: 'Graph' });

    await expect(
      readJsonBody(jsonRequest({ name: '' }), z.object({ name: z.string().min(1) })),
    ).rejects.toThrow(ThesisServiceError);
  });

  it('rejects oversized JSON bodies before validation', async () => {
    const { readJsonBody } = await import('./response');

    await expect(
      readJsonBody(jsonRequest({ body: 'x'.repeat(513 * 1024) }), z.object({ body: z.string() })),
    ).rejects.toThrow('Request body is too large');
  });

  it('resolves an actor, rate limits, and invokes headless handlers', async () => {
    const { withHeadlessActor } = await import('./response');

    const response = await withHeadlessActor(
      new Request('http://localhost/api/headless/graphs'),
      'graphs:read',
      async (resolvedActor) => ({ userId: resolvedActor.userId }),
    );
    const body = await response.json();

    expect(mockResolveHeadlessActor).toHaveBeenCalledWith(expect.any(Request), 'graphs:read');
    expect(mockCheckHeadlessRateLimit).toHaveBeenCalledWith(actor);
    expect(body).toEqual({ data: { userId: 'user_123' }, error: null });
  });

  it('supports idempotent JSON request replay', async () => {
    const { withHeadlessJson } = await import('./response');
    mockGetIdempotentResponse.mockResolvedValue({
      status: 200,
      body: { data: { replayed: true }, error: null },
    });

    const response = await withHeadlessJson(
      jsonRequest({ name: 'Graph' }, { 'Idempotency-Key': 'retry-1' }),
      'graphs:write',
      z.object({ name: z.string() }),
      async () => ({ replayed: false }),
      { idempotent: true },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ replayed: true });
    expect(mockReserveIdempotencyKey).not.toHaveBeenCalled();
  });

  it('records completed idempotent JSON responses', async () => {
    const { withHeadlessJson } = await import('./response');

    const response = await withHeadlessJson(
      jsonRequest({ name: 'Graph' }, { 'Idempotency-Key': 'retry-2' }),
      'graphs:write',
      z.object({ name: z.string() }),
      async (_resolvedActor, body) => ({ created: body.name }),
      { idempotent: true },
    );
    const body = await response.json();

    expect(body.data).toEqual({ created: 'Graph' });
    expect(mockReserveIdempotencyKey).toHaveBeenCalledWith(expect.anything(), {
      actor,
      key: 'retry-2',
      method: 'POST',
      path: '/api/headless/graphs',
      requestHash: expect.any(String),
    });
    expect(mockCompleteIdempotencyKey).toHaveBeenCalledWith(expect.anything(), {
      actor,
      key: 'retry-2',
      status: 200,
      body: { data: { created: 'Graph' }, error: null },
    });
  });
});

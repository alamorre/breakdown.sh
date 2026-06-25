import { describe, expect, it } from 'vitest';
import { assertSameUser, readBearerToken, requireScope, type BreakdownActor } from './actor';
import { BreakdownServiceError } from './errors';

const actor: BreakdownActor = {
  userId: 'user_123',
  source: 'integration-token',
  tokenId: '550e8400-e29b-41d4-a716-446655440000',
  scopes: ['graphs:read'],
};

describe('BreakdownActor authorization helpers', () => {
  it('reads bearer tokens from authorization headers first', () => {
    const request = new Request('https://breakdown.example/api/mcp?access_token=bdk_query', {
      headers: { Authorization: 'Bearer bdk_header' },
    });

    expect(readBearerToken(request)).toBe('bdk_header');
  });

  it('falls back to access_token query parameters for clients that cannot set headers', () => {
    const request = new Request('https://breakdown.example/api/mcp?access_token=bdk_query');

    expect(readBearerToken(request)).toBe('bdk_query');
  });

  it('falls back to token query parameters for generic MCP client URL fields', () => {
    const request = new Request('https://breakdown.example/api/mcp?token=bdk_query');

    expect(readBearerToken(request)).toBe('bdk_query');
  });

  it('allows actors with the required scope', () => {
    expect(() => requireScope(actor, 'graphs:read')).not.toThrow();
  });

  it('rejects missing scopes with a machine-readable service error', () => {
    expect(() => requireScope(actor, 'graphs:write')).toThrow(BreakdownServiceError);
    expect(() => requireScope(actor, 'graphs:write')).toThrow('Missing required scope');
  });

  it('rejects cross-user access as not found', () => {
    expect(() => assertSameUser(actor, 'user_other')).toThrow(BreakdownServiceError);
  });
});

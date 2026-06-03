import { describe, expect, it } from 'vitest';
import { assertSameUser, requireScope, type ThesisActor } from './actor';
import { ThesisServiceError } from './errors';

const actor: ThesisActor = {
  userId: 'user_123',
  source: 'integration-token',
  tokenId: '550e8400-e29b-41d4-a716-446655440000',
  scopes: ['graphs:read'],
};

describe('ThesisActor authorization helpers', () => {
  it('allows actors with the required scope', () => {
    expect(() => requireScope(actor, 'graphs:read')).not.toThrow();
  });

  it('rejects missing scopes with a machine-readable service error', () => {
    expect(() => requireScope(actor, 'graphs:write')).toThrow(ThesisServiceError);
    expect(() => requireScope(actor, 'graphs:write')).toThrow('Missing required scope');
  });

  it('rejects cross-user access as not found', () => {
    expect(() => assertSameUser(actor, 'user_other')).toThrow(ThesisServiceError);
  });
});

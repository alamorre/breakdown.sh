import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from '@/lib/security/crypto';

describe('secret encryption', () => {
  it('round-trips encrypted values without exposing plaintext', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const encrypted = encryptSecret('provider-api-key', key);

    expect(encrypted).not.toContain('provider-api-key');
    expect(decryptSecret(encrypted, key, 'test secret')).toBe('provider-api-key');
  });
});

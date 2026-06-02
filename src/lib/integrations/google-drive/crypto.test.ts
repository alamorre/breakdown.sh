import { describe, expect, it } from 'vitest';
import {
  decryptGoogleDriveToken,
  encryptGoogleDriveToken,
} from '@/lib/integrations/google-drive/crypto';

describe('Google Drive token encryption', () => {
  it('round-trips encrypted tokens', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const encrypted = encryptGoogleDriveToken('refresh-token-secret', key);

    expect(encrypted).not.toContain('refresh-token-secret');
    expect(decryptGoogleDriveToken(encrypted, key)).toBe('refresh-token-secret');
  });
});

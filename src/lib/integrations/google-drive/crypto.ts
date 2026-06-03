import { decryptSecret, encryptSecret } from '@/lib/security/crypto';

export function encryptGoogleDriveToken(token: string, secret: string): string {
  return encryptSecret(token, secret);
}

export function decryptGoogleDriveToken(payload: string, secret: string): string {
  return decryptSecret(payload, secret, 'Google Drive token');
}

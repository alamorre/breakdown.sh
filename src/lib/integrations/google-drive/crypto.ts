import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(secret: string): Buffer {
  const decoded = Buffer.from(secret, 'base64');
  if (decoded.length === 32) {
    return decoded;
  }

  return createHash('sha256').update(secret).digest();
}

export function encryptGoogleDriveToken(token: string, secret: string): string {
  const key = getKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

export function decryptGoogleDriveToken(payload: string, secret: string): string {
  const [ivText, tagText, encryptedText] = payload.split('.');
  if (!ivText || !tagText || !encryptedText) {
    throw new Error('Invalid encrypted Google Drive token payload');
  }

  const key = getKey(secret);
  const iv = Buffer.from(ivText, 'base64url');
  const tag = Buffer.from(tagText, 'base64url');
  const encrypted = Buffer.from(encryptedText, 'base64url');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

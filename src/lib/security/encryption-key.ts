const PRIMARY_KEY_NAME = 'INTEGRATION_TOKEN_ENCRYPTION_KEY';
const LEGACY_GOOGLE_DRIVE_KEY_NAME = 'GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY';

export function getIntegrationTokenEncryptionKey(): string {
  const encryptionKey = process.env[PRIMARY_KEY_NAME] ?? process.env[LEGACY_GOOGLE_DRIVE_KEY_NAME];

  if (!encryptionKey) {
    throw new Error(
      `Missing token encryption key. Set ${PRIMARY_KEY_NAME} for stored integration credentials.`,
    );
  }

  return encryptionKey;
}

export function hasIntegrationTokenEncryptionKey(): boolean {
  return Boolean(process.env[PRIMARY_KEY_NAME] ?? process.env[LEGACY_GOOGLE_DRIVE_KEY_NAME]);
}

export function getConfiguredIntegrationTokenEncryptionKeyName(): string | null {
  if (process.env[PRIMARY_KEY_NAME]) return PRIMARY_KEY_NAME;
  if (process.env[LEGACY_GOOGLE_DRIVE_KEY_NAME]) return LEGACY_GOOGLE_DRIVE_KEY_NAME;
  return null;
}

export function isValidTokenEncryptionKey(value: string): boolean {
  return Buffer.from(value, 'base64').length === 32;
}

export { PRIMARY_KEY_NAME, LEGACY_GOOGLE_DRIVE_KEY_NAME };

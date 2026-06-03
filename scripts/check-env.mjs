/* eslint-disable no-console */

const requiredGroups = [
  {
    name: 'Clerk',
    keys: [
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      'CLERK_SECRET_KEY',
      'NEXT_PUBLIC_CLERK_SIGN_IN_URL',
      'NEXT_PUBLIC_CLERK_SIGN_UP_URL',
    ],
  },
  {
    name: 'Supabase',
    keys: [
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
    ],
  },
  {
    name: 'Google Drive integration',
    keys: [
      'GOOGLE_DRIVE_CLIENT_ID',
      'GOOGLE_DRIVE_CLIENT_SECRET',
      'NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY',
      'NEXT_PUBLIC_GOOGLE_DRIVE_APP_ID',
    ],
  },
];

const missingGroups = requiredGroups
  .map((group) => ({
    name: group.name,
    keys: group.keys.filter((key) => !process.env[key]),
  }))
  .filter((group) => group.keys.length > 0);

if (
  !process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY &&
  !process.env.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY
) {
  missingGroups.push({
    name: 'Stored integration credentials',
    keys: ['INTEGRATION_TOKEN_ENCRYPTION_KEY'],
  });
}

const encryptionKey =
  process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY ?? process.env.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY;
const encryptionKeyName = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY
  ? 'INTEGRATION_TOKEN_ENCRYPTION_KEY'
  : 'GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY';
const hasInvalidEncryptionKey =
  typeof encryptionKey === 'string' &&
  encryptionKey.length > 0 &&
  Buffer.from(encryptionKey, 'base64').length !== 32;

if (missingGroups.length > 0 || hasInvalidEncryptionKey) {
  console.error('Environment validation failed.');

  for (const group of missingGroups) {
    console.error(`\n${group.name}:`);
    for (const key of group.keys) {
      console.error(`  - ${key}`);
    }
  }

  if (hasInvalidEncryptionKey) {
    console.error('\nStored integration credentials:');
    console.error(`  - ${encryptionKeyName} must decode to 32 bytes`);
  }

  console.error('\nLoad secrets with Doppler, for example: pnpm dev:secrets');
  process.exit(1);
}

console.log('Environment validation passed.');

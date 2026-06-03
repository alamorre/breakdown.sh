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
    keys: ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  {
    name: 'Anthropic',
    keys: ['ANTHROPIC_API_KEY'],
  },
  {
    name: 'Google Drive integration',
    keys: [
      'GOOGLE_DRIVE_CLIENT_ID',
      'GOOGLE_DRIVE_CLIENT_SECRET',
      'GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY',
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

const encryptionKey = process.env.GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY;
const hasInvalidGoogleDriveEncryptionKey =
  typeof encryptionKey === 'string' &&
  encryptionKey.length > 0 &&
  Buffer.from(encryptionKey, 'base64').length !== 32;

if (missingGroups.length > 0 || hasInvalidGoogleDriveEncryptionKey) {
  console.error('Environment validation failed.');

  for (const group of missingGroups) {
    console.error(`\n${group.name}:`);
    for (const key of group.keys) {
      console.error(`  - ${key}`);
    }
  }

  if (hasInvalidGoogleDriveEncryptionKey) {
    console.error('\nGoogle Drive integration:');
    console.error('  - GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  }

  console.error('\nLoad secrets with Doppler, for example: pnpm dev:secrets');
  process.exit(1);
}

console.log('Environment validation passed.');

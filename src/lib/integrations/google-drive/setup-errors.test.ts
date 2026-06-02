import { describe, expect, it } from 'vitest';
import {
  GOOGLE_DRIVE_CONNECTIONS_MIGRATION,
  getGoogleDriveApiErrorPayload,
  getGoogleDriveApiErrorStatus,
  isMissingGoogleDriveConnectionsTableError,
} from './setup-errors';

describe('Google Drive setup error helpers', () => {
  it('recognizes missing google_drive_connections table errors', () => {
    expect(
      isMissingGoogleDriveConnectionsTableError(
        new Error('relation "public.google_drive_connections" does not exist'),
      ),
    ).toBe(true);

    expect(
      isMissingGoogleDriveConnectionsTableError(
        new Error("Could not find the table 'public.google_drive_connections' in the schema cache"),
      ),
    ).toBe(true);
  });

  it('maps missing migration errors to an actionable setup payload', () => {
    const payload = getGoogleDriveApiErrorPayload(
      new Error('relation "public.google_drive_connections" does not exist'),
    );

    expect(getGoogleDriveApiErrorStatus(new Error('google_drive_connections does not exist'))).toBe(
      503,
    );
    expect(payload).toMatchObject({
      code: 'google_drive_database_not_ready',
      setupRequired: true,
      setupArea: 'supabase',
      migration: GOOGLE_DRIVE_CONNECTIONS_MIGRATION,
    });
    expect(payload.error).toContain(GOOGLE_DRIVE_CONNECTIONS_MIGRATION);
  });

  it('uses a generic deployment-log message for unknown failures', () => {
    const payload = getGoogleDriveApiErrorPayload(new Error('network unavailable'));

    expect(getGoogleDriveApiErrorStatus(new Error('network unavailable'))).toBe(500);
    expect(payload).toEqual({
      error:
        'Google Drive status could not be loaded. Check the deployment logs for /api/integrations/google-drive/status.',
      code: 'google_drive_status_failed',
    });
  });
});

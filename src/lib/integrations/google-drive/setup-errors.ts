export const GOOGLE_DRIVE_CONNECTIONS_MIGRATION =
  'supabase/migrations/20260601000000_google_drive_connections.sql';

export type GoogleDriveApiErrorPayload = {
  error: string;
  code: 'google_drive_database_not_ready' | 'google_drive_status_failed';
  setupRequired?: true;
  setupArea?: 'supabase';
  migration?: string;
};

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
}

export function isMissingGoogleDriveConnectionsTableError(err: unknown): boolean {
  const message = getErrorMessage(err).toLowerCase();

  return (
    message.includes('google_drive_connections') &&
    (message.includes('does not exist') ||
      message.includes('schema cache') ||
      message.includes('could not find') ||
      message.includes('42p01') ||
      message.includes('pgrst205'))
  );
}

export function getGoogleDriveApiErrorPayload(err: unknown): GoogleDriveApiErrorPayload {
  if (isMissingGoogleDriveConnectionsTableError(err)) {
    return {
      error: `Google Drive database setup is incomplete. Apply ${GOOGLE_DRIVE_CONNECTIONS_MIGRATION} in the production Supabase project.`,
      code: 'google_drive_database_not_ready',
      setupRequired: true,
      setupArea: 'supabase',
      migration: GOOGLE_DRIVE_CONNECTIONS_MIGRATION,
    };
  }

  return {
    error:
      'Google Drive status could not be loaded. Check the deployment logs for /api/integrations/google-drive/status.',
    code: 'google_drive_status_failed',
  };
}

export function getGoogleDriveApiErrorStatus(err: unknown): number {
  return isMissingGoogleDriveConnectionsTableError(err) ? 503 : 500;
}

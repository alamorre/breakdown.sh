import { createHash } from 'crypto';
import type { createServerClient } from '@/lib/supabase/server';
import { isGoogleDriveSourceConfig, type GoogleDriveSourceConfig } from '@/types/data-source';
import type { BreakdownNode } from '@/types/node';
import {
  getGoogleDriveConnectionById,
  getValidGoogleDriveAccessToken,
} from '@/lib/integrations/google-drive/connections';
import { GOOGLE_DRIVE_MIME_TYPES } from '@/lib/integrations/google-drive/source';

const DRIVE_API_BASE_URL = 'https://www.googleapis.com/drive/v3';
const MAX_EXPORTED_CHARACTERS = 200_000;

type SupabaseClient = ReturnType<typeof createServerClient>;

type DriveFileMetadata = {
  id: string;
  name: string;
  mimeType: string;
  webViewLink?: string;
  iconLink?: string;
  modifiedTime?: string;
  capabilities?: {
    canDownload?: boolean;
  };
};

type GoogleDriveFetchResult = {
  content: string;
  fetchedAt: string;
  metadata: Partial<GoogleDriveSourceConfig>;
};

function mapDriveApiError(status: number, statusText: string): string {
  if (status === 401) return 'Reconnect Google Drive to continue.';
  if (status === 403) return 'Google Drive access was denied for this file.';
  if (status === 404) return 'Google Drive file was not found or is no longer shared with you.';
  return `Google Drive export failed: ${status} ${statusText}`;
}

function assertTextSize(content: string): string {
  if (content.length <= MAX_EXPORTED_CHARACTERS) {
    return content;
  }

  return `${content.slice(0, MAX_EXPORTED_CHARACTERS)}\n\n[Truncated by breakdown.sh: exported Google Drive content exceeded ${MAX_EXPORTED_CHARACTERS.toLocaleString()} characters.]`;
}

function getGoogleDriveContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function fetchDriveFileMetadata(
  accessToken: string,
  fileId: string,
): Promise<DriveFileMetadata> {
  const url = new URL(`${DRIVE_API_BASE_URL}/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set(
    'fields',
    'id,name,mimeType,webViewLink,iconLink,modifiedTime,capabilities/canDownload',
  );
  url.searchParams.set('supportsAllDrives', 'true');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15_000),
  });

  const data = (await response.json().catch(() => null)) as DriveFileMetadata | null;
  if (!response.ok || !data?.id) {
    throw new Error(mapDriveApiError(response.status, response.statusText));
  }

  return data;
}

async function exportDriveFile(input: {
  accessToken: string;
  fileId: string;
  exportMimeType: string;
}): Promise<string> {
  const url = new URL(`${DRIVE_API_BASE_URL}/files/${encodeURIComponent(input.fileId)}/export`);
  url.searchParams.set('mimeType', input.exportMimeType);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${input.accessToken}` },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(mapDriveApiError(response.status, response.statusText));
  }

  return assertTextSize(await response.text());
}

async function exportGoogleDoc(input: {
  accessToken: string;
  fileId: string;
  preferredMimeType: string;
}): Promise<{ content: string; exportMimeType: string }> {
  if (input.preferredMimeType === 'text/markdown') {
    try {
      const content = await exportDriveFile({
        accessToken: input.accessToken,
        fileId: input.fileId,
        exportMimeType: 'text/markdown',
      });
      return { content, exportMimeType: 'text/markdown' };
    } catch {
      // Some tenants or documents may not support Markdown export yet.
    }
  }

  const content = await exportDriveFile({
    accessToken: input.accessToken,
    fileId: input.fileId,
    exportMimeType: 'text/plain',
  });
  return { content, exportMimeType: 'text/plain' };
}

function getExportMimeType(metadata: GoogleDriveSourceConfig): string {
  if (metadata.mimeType === GOOGLE_DRIVE_MIME_TYPES.document) {
    return metadata.exportMimeType || 'text/markdown';
  }

  if (metadata.mimeType === GOOGLE_DRIVE_MIME_TYPES.spreadsheet) {
    return 'text/csv';
  }

  return 'text/plain';
}

export async function fetchGoogleDriveSource(
  supabase: SupabaseClient,
  input: { node: BreakdownNode; userId: string },
): Promise<GoogleDriveFetchResult> {
  if (!isGoogleDriveSourceConfig(input.node.metadata)) {
    throw new Error('Google Drive source is missing file metadata.');
  }

  const sourceMetadata = input.node.metadata;
  const connection = await getGoogleDriveConnectionById(supabase, {
    userId: input.userId,
    connectionId: sourceMetadata.connectionId,
  });

  if (!connection) {
    throw new Error('Reconnect Google Drive to continue.');
  }

  const accessToken = await getValidGoogleDriveAccessToken(supabase, connection);
  const driveFile = await fetchDriveFileMetadata(accessToken, sourceMetadata.fileId);

  if (driveFile.capabilities?.canDownload === false) {
    throw new Error('Google Drive file cannot be exported by this account.');
  }

  if (driveFile.mimeType !== sourceMetadata.mimeType) {
    throw new Error('Google Drive file type changed and is no longer supported by this source.');
  }

  const preferredExportMimeType = getExportMimeType(sourceMetadata);
  const exported =
    sourceMetadata.mimeType === GOOGLE_DRIVE_MIME_TYPES.document
      ? await exportGoogleDoc({
          accessToken,
          fileId: sourceMetadata.fileId,
          preferredMimeType: preferredExportMimeType,
        })
      : {
          content: await exportDriveFile({
            accessToken,
            fileId: sourceMetadata.fileId,
            exportMimeType: preferredExportMimeType,
          }),
          exportMimeType: preferredExportMimeType,
        };

  return {
    content: exported.content,
    fetchedAt: new Date().toISOString(),
    metadata: {
      fileName: driveFile.name,
      webViewLink: driveFile.webViewLink ?? sourceMetadata.webViewLink,
      iconLink: driveFile.iconLink ?? sourceMetadata.iconLink,
      exportMimeType: exported.exportMimeType,
      lastKnownModifiedTime: driveFile.modifiedTime,
      lastFetchedModifiedTime: driveFile.modifiedTime,
      lastFetchedContentHash: getGoogleDriveContentHash(exported.content),
    },
  };
}

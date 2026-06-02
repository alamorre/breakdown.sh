import {
  SOURCE_NODE_TYPES,
  type DataSourceType,
  type GoogleDriveExtractionConfig,
  type GoogleDriveMimeType,
  type GoogleDriveSourceConfig,
} from '@/types/data-source';

export const GOOGLE_DRIVE_MIME_TYPES = {
  document: 'application/vnd.google-apps.document',
  spreadsheet: 'application/vnd.google-apps.spreadsheet',
  presentation: 'application/vnd.google-apps.presentation',
} as const satisfies Record<string, GoogleDriveMimeType>;

export type PickedGoogleDriveFile = {
  fileId: string;
  name: string;
  mimeType: GoogleDriveMimeType;
  url: string;
  iconUrl?: string;
};

export function isSupportedGoogleDriveMimeType(value: string): value is GoogleDriveMimeType {
  return Object.values(GOOGLE_DRIVE_MIME_TYPES).includes(value as GoogleDriveMimeType);
}

export function getSourceTypeForDriveMimeType(mimeType: GoogleDriveMimeType): DataSourceType {
  switch (mimeType) {
    case GOOGLE_DRIVE_MIME_TYPES.document:
      return 'google-doc';
    case GOOGLE_DRIVE_MIME_TYPES.spreadsheet:
      return 'google-sheet';
    case GOOGLE_DRIVE_MIME_TYPES.presentation:
      return 'google-presentation';
  }
}

export function getNodeTypeForDriveMimeType(mimeType: GoogleDriveMimeType): string {
  return SOURCE_NODE_TYPES[getSourceTypeForDriveMimeType(mimeType)];
}

export function getDefaultExportMimeType(mimeType: GoogleDriveMimeType): string {
  switch (mimeType) {
    case GOOGLE_DRIVE_MIME_TYPES.document:
      return 'text/markdown';
    case GOOGLE_DRIVE_MIME_TYPES.spreadsheet:
      return 'text/csv';
    case GOOGLE_DRIVE_MIME_TYPES.presentation:
      return 'text/plain';
  }
}

export function getDefaultExtractionConfig(
  mimeType: GoogleDriveMimeType,
): GoogleDriveExtractionConfig {
  switch (mimeType) {
    case GOOGLE_DRIVE_MIME_TYPES.document:
      return { kind: 'document', format: 'markdown' };
    case GOOGLE_DRIVE_MIME_TYPES.spreadsheet:
      return { kind: 'spreadsheet', format: 'csv' };
    case GOOGLE_DRIVE_MIME_TYPES.presentation:
      return { kind: 'presentation', format: 'plain-text' };
  }
}

export function buildGoogleDriveSourceMetadata(input: {
  connectionId: string;
  accountEmail: string;
  file: PickedGoogleDriveFile;
}): GoogleDriveSourceConfig {
  return {
    provider: 'google-drive',
    connectionId: input.connectionId,
    fileId: input.file.fileId,
    fileName: input.file.name,
    mimeType: input.file.mimeType,
    webViewLink: input.file.url,
    ...(input.file.iconUrl ? { iconLink: input.file.iconUrl } : {}),
    accountEmail: input.accountEmail,
    exportMimeType: getDefaultExportMimeType(input.file.mimeType),
    extraction: getDefaultExtractionConfig(input.file.mimeType),
  };
}

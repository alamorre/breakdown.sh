/** Data source node types */
export type DataSourceType =
  | 'web-url'
  | 'google-doc'
  | 'google-sheet'
  | 'google-presentation'
  | 'text';

export type GoogleDriveMimeType =
  | 'application/vnd.google-apps.document'
  | 'application/vnd.google-apps.spreadsheet'
  | 'application/vnd.google-apps.presentation';

export type GoogleDriveExtractionConfig =
  | { kind: 'document'; format: 'markdown' | 'plain-text' }
  | { kind: 'spreadsheet'; format: 'csv' }
  | { kind: 'presentation'; format: 'plain-text' };

/** Metadata stored in nodes.metadata for native Google Drive sources */
export interface GoogleDriveSourceConfig {
  provider: 'google-drive';
  connectionId: string;
  fileId: string;
  fileName: string;
  mimeType: GoogleDriveMimeType;
  webViewLink: string;
  iconLink?: string;
  accountEmail: string;
  exportMimeType: string;
  lastKnownModifiedTime?: string;
  lastFetchedModifiedTime?: string;
  lastFetchedContentHash?: string;
  extraction?: GoogleDriveExtractionConfig;
}

/** node_type values stored in the database for source nodes */
export const SOURCE_NODE_TYPES = {
  'web-url': 'source-web-url',
  'google-doc': 'source-google-doc',
  'google-sheet': 'source-google-sheet',
  'google-presentation': 'source-google-presentation',
  text: 'source-text',
} as const satisfies Record<DataSourceType, string>;

/** Metadata stored in nodes.metadata for web URL sources */
export interface WebUrlConfig {
  url: string;
}

/** Metadata stored in nodes.metadata for Google Doc sources */
export interface GoogleDocConfig {
  url: string;
  docId: string;
}

/** Metadata stored in nodes.metadata for Google Sheet sources */
export interface GoogleSheetConfig {
  url: string;
  spreadsheetId: string;
  sheetName?: string;
}

/** Metadata stored in nodes.metadata for text sources (empty; content lives in the prompt) */
export type TextSourceConfig = Record<string, never>;

export type DataSourceConfig =
  | WebUrlConfig
  | GoogleDocConfig
  | GoogleSheetConfig
  | GoogleDriveSourceConfig
  | TextSourceConfig;

/** Check if a node_type string represents a data source node */
export function isDataSourceNode(nodeType: string): boolean {
  return nodeType.startsWith('source-');
}

/** Extract the DataSourceType from a node_type string, or null if not a source */
export function getDataSourceType(nodeType: string): DataSourceType | null {
  for (const [type, value] of Object.entries(SOURCE_NODE_TYPES)) {
    if (value === nodeType) return type as DataSourceType;
  }
  return null;
}

/** Display labels for source node types */
export const DATA_SOURCE_LABELS: Record<DataSourceType, string> = {
  'web-url': 'Web URL',
  'google-doc': 'Google Doc',
  'google-sheet': 'Google Sheet',
  'google-presentation': 'Google Presentation',
  text: 'Text',
};

/** Default names for new source nodes */
export const DATA_SOURCE_DEFAULT_NAMES: Record<DataSourceType, string> = {
  'web-url': 'Web Source',
  'google-doc': 'Google Doc',
  'google-sheet': 'Google Sheet',
  'google-presentation': 'Google Presentation',
  text: 'Text Source',
};

export function isGoogleDriveSourceConfig(metadata: unknown): metadata is GoogleDriveSourceConfig {
  const value = metadata as Partial<GoogleDriveSourceConfig> | null | undefined;
  return (
    value?.provider === 'google-drive' &&
    typeof value.connectionId === 'string' &&
    typeof value.fileId === 'string' &&
    typeof value.fileName === 'string' &&
    typeof value.mimeType === 'string' &&
    typeof value.webViewLink === 'string' &&
    typeof value.accountEmail === 'string' &&
    typeof value.exportMimeType === 'string'
  );
}

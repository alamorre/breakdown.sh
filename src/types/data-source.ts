/** Data source node types */
export type DataSourceType = 'web-url' | 'google-doc' | 'google-sheet';

/** node_type values stored in the database for source nodes */
export const SOURCE_NODE_TYPES = {
  'web-url': 'source-web-url',
  'google-doc': 'source-google-doc',
  'google-sheet': 'source-google-sheet',
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

export type DataSourceConfig = WebUrlConfig | GoogleDocConfig | GoogleSheetConfig;

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
};

/** Default names for new source nodes */
export const DATA_SOURCE_DEFAULT_NAMES: Record<DataSourceType, string> = {
  'web-url': 'Web Source',
  'google-doc': 'Google Doc',
  'google-sheet': 'Google Sheet',
};

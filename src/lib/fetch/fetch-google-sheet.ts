import type { FetchResult } from '@/lib/fetch/fetch-web-url';

/** Extract Google Sheets spreadsheet ID from a URL like https://docs.google.com/spreadsheets/d/{ID}/... */
export function extractSpreadsheetId(url: string): string {
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error(
      'Invalid Google Sheets URL. Expected format: https://docs.google.com/spreadsheets/d/{ID}/...',
    );
  }
  return match[1];
}

/** Fetch a publicly shared Google Sheet as CSV */
export async function fetchGoogleSheet(url: string, sheetName?: string): Promise<FetchResult> {
  const spreadsheetId = extractSpreadsheetId(url);
  let exportUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv`;
  if (sheetName) {
    exportUrl += `&sheet=${encodeURIComponent(sheetName)}`;
  }

  const response = await fetch(exportUrl, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Google Sheet: ${response.status} ${response.statusText}. Ensure the spreadsheet is shared publicly.`,
    );
  }

  const content = await response.text();

  return {
    content,
    fetchedAt: new Date().toISOString(),
  };
}

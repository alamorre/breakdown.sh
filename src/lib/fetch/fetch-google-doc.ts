import type { FetchResult } from '@/lib/fetch/fetch-web-url';

/** Extract Google Doc ID from a URL like https://docs.google.com/document/d/{ID}/... */
export function extractDocId(url: string): string {
  const match = url.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) {
    throw new Error(
      'Invalid Google Docs URL. Expected format: https://docs.google.com/document/d/{ID}/...',
    );
  }
  return match[1];
}

/** Fetch a publicly shared Google Doc as plain text */
export async function fetchGoogleDoc(url: string): Promise<FetchResult> {
  const docId = extractDocId(url);
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;

  const response = await fetch(exportUrl, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Google Doc: ${response.status} ${response.statusText}. Ensure the document is shared publicly.`,
    );
  }

  const content = await response.text();

  return {
    content,
    fetchedAt: new Date().toISOString(),
  };
}

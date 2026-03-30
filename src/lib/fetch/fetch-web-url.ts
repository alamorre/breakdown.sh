const MAX_CONTENT_LENGTH = 50_000;

export interface FetchResult {
  content: string;
  fetchedAt: string;
}

/** Strip HTML tags, scripts, and styles from raw HTML, returning plain text */
function stripHtml(html: string): string {
  let text = html;
  // Remove script and style blocks entirely
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/** Fetch a web URL and return its content as plain text */
export async function fetchWebUrl(url: string): Promise<FetchResult> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Thesis/1.0 (reasoning-canvas)' },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();

  const content = contentType.includes('text/html') ? stripHtml(raw) : raw;
  const truncated = content.slice(0, MAX_CONTENT_LENGTH);

  return {
    content: truncated,
    fetchedAt: new Date().toISOString(),
  };
}

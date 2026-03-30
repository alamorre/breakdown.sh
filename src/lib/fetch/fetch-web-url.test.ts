import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchWebUrl } from '@/lib/fetch/fetch-web-url';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('fetchWebUrl', () => {
  it('should strip HTML tags and return plain text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => '<html><body><h1>Hello</h1><p>World</p></body></html>',
    });

    const result = await fetchWebUrl('https://example.com');

    expect(result.content).toBe('Hello World');
    expect(result.fetchedAt).toBeTruthy();
  });

  it('should remove script and style blocks', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () =>
        '<html><head><style>body{color:red}</style></head><body><script>alert("x")</script><p>Content</p></body></html>',
    });

    const result = await fetchWebUrl('https://example.com');

    expect(result.content).toBe('Content');
    expect(result.content).not.toContain('alert');
    expect(result.content).not.toContain('color:red');
  });

  it('should return raw text for non-HTML content types', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => 'Plain text content',
    });

    const result = await fetchWebUrl('https://example.com/data.txt');

    expect(result.content).toBe('Plain text content');
  });

  it('should truncate content exceeding 50,000 characters', async () => {
    const longContent = 'A'.repeat(60_000);
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/plain' }),
      text: async () => longContent,
    });

    const result = await fetchWebUrl('https://example.com/large');

    expect(result.content.length).toBe(50_000);
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    await expect(fetchWebUrl('https://example.com/missing')).rejects.toThrow(
      'Failed to fetch URL: 404 Not Found',
    );
  });

  it('should decode common HTML entities', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => '<p>Tom &amp; Jerry &lt;3 &quot;cheese&quot;</p>',
    });

    const result = await fetchWebUrl('https://example.com');

    expect(result.content).toBe('Tom & Jerry <3 "cheese"');
  });
});

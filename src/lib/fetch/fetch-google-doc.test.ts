import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractDocId, fetchGoogleDoc } from '@/lib/fetch/fetch-google-doc';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractDocId', () => {
  it('should extract doc ID from standard Google Docs URL', () => {
    const id = extractDocId('https://docs.google.com/document/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit');
    expect(id).toBe('1aBcDeFgHiJkLmNoPqRsTuVwXyZ');
  });

  it('should extract doc ID from URL with query params', () => {
    const id = extractDocId('https://docs.google.com/document/d/abc123_-def/edit?usp=sharing');
    expect(id).toBe('abc123_-def');
  });

  it('should extract doc ID from URL ending with /pub', () => {
    const id = extractDocId('https://docs.google.com/document/d/myDocId123/pub');
    expect(id).toBe('myDocId123');
  });

  it('should throw for invalid URL', () => {
    expect(() => extractDocId('https://example.com/not-a-doc')).toThrow('Invalid Google Docs URL');
  });

  it('should throw for Google Sheets URL', () => {
    expect(() => extractDocId('https://docs.google.com/spreadsheets/d/abc123/edit')).toThrow(
      'Invalid Google Docs URL',
    );
  });
});

describe('fetchGoogleDoc', () => {
  it('should fetch document content as plain text', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => 'Document content here',
    });

    const result = await fetchGoogleDoc('https://docs.google.com/document/d/abc123/edit');

    expect(result.content).toBe('Document content here');
    expect(result.fetchedAt).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://docs.google.com/document/d/abc123/export?format=txt',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    await expect(fetchGoogleDoc('https://docs.google.com/document/d/abc123/edit')).rejects.toThrow(
      'Failed to fetch Google Doc: 403 Forbidden',
    );
  });

  it('should throw for invalid URL', async () => {
    await expect(fetchGoogleDoc('https://example.com')).rejects.toThrow('Invalid Google Docs URL');
  });
});

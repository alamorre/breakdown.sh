import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractSpreadsheetId, fetchGoogleSheet } from '@/lib/fetch/fetch-google-sheet';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractSpreadsheetId', () => {
  it('should extract spreadsheet ID from standard Google Sheets URL', () => {
    const id = extractSpreadsheetId(
      'https://docs.google.com/spreadsheets/d/1aBcDeFgHiJkLmNoPqRsTuVwXyZ/edit',
    );
    expect(id).toBe('1aBcDeFgHiJkLmNoPqRsTuVwXyZ');
  });

  it('should extract ID from URL with query params', () => {
    const id = extractSpreadsheetId(
      'https://docs.google.com/spreadsheets/d/abc123_-def/edit?usp=sharing#gid=0',
    );
    expect(id).toBe('abc123_-def');
  });

  it('should extract ID from URL ending with /pub', () => {
    const id = extractSpreadsheetId('https://docs.google.com/spreadsheets/d/sheetId456/pub');
    expect(id).toBe('sheetId456');
  });

  it('should throw for invalid URL', () => {
    expect(() => extractSpreadsheetId('https://example.com/not-a-sheet')).toThrow(
      'Invalid Google Sheets URL',
    );
  });

  it('should throw for Google Docs URL', () => {
    expect(() => extractSpreadsheetId('https://docs.google.com/document/d/abc123/edit')).toThrow(
      'Invalid Google Sheets URL',
    );
  });
});

describe('fetchGoogleSheet', () => {
  it('should fetch sheet content as CSV', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => '"Name","Value"\n"A",1\n"B",2',
    });

    const result = await fetchGoogleSheet('https://docs.google.com/spreadsheets/d/abc123/edit');

    expect(result.content).toBe('"Name","Value"\n"A",1\n"B",2');
    expect(result.fetchedAt).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:csv',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('should include sheet name parameter when provided', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => 'data',
    });

    await fetchGoogleSheet('https://docs.google.com/spreadsheets/d/abc123/edit', 'Sheet2');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:csv&sheet=Sheet2',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('should URL-encode sheet name with special characters', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => 'data',
    });

    await fetchGoogleSheet('https://docs.google.com/spreadsheets/d/abc123/edit', 'My Sheet & Data');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('sheet=My%20Sheet%20%26%20Data'),
      expect.anything(),
    );
  });

  it('should throw on non-OK response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
    });

    await expect(
      fetchGoogleSheet('https://docs.google.com/spreadsheets/d/abc123/edit'),
    ).rejects.toThrow('Failed to fetch Google Sheet: 403 Forbidden');
  });

  it('should throw for invalid URL', async () => {
    await expect(fetchGoogleSheet('https://example.com')).rejects.toThrow(
      'Invalid Google Sheets URL',
    );
  });
});

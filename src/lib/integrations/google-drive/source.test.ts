import { describe, expect, it } from 'vitest';
import {
  GOOGLE_DRIVE_MIME_TYPES,
  buildGoogleDriveSourceMetadata,
  getDefaultExportMimeType,
  getNodeTypeForDriveMimeType,
  getSourceTypeForDriveMimeType,
  isSupportedGoogleDriveMimeType,
} from './source';

describe('Google Drive source helpers', () => {
  it('maps Google Workspace MIME types to source node types', () => {
    expect(getSourceTypeForDriveMimeType(GOOGLE_DRIVE_MIME_TYPES.document)).toBe('google-doc');
    expect(getNodeTypeForDriveMimeType(GOOGLE_DRIVE_MIME_TYPES.document)).toBe('source-google-doc');

    expect(getSourceTypeForDriveMimeType(GOOGLE_DRIVE_MIME_TYPES.spreadsheet)).toBe('google-sheet');
    expect(getNodeTypeForDriveMimeType(GOOGLE_DRIVE_MIME_TYPES.spreadsheet)).toBe(
      'source-google-sheet',
    );

    expect(getSourceTypeForDriveMimeType(GOOGLE_DRIVE_MIME_TYPES.presentation)).toBe(
      'google-presentation',
    );
    expect(getNodeTypeForDriveMimeType(GOOGLE_DRIVE_MIME_TYPES.presentation)).toBe(
      'source-google-presentation',
    );
  });

  it('recognizes only supported Google Workspace source MIME types', () => {
    expect(isSupportedGoogleDriveMimeType(GOOGLE_DRIVE_MIME_TYPES.document)).toBe(true);
    expect(isSupportedGoogleDriveMimeType('application/pdf')).toBe(false);
  });

  it('sets default export MIME types', () => {
    expect(getDefaultExportMimeType(GOOGLE_DRIVE_MIME_TYPES.document)).toBe('text/markdown');
    expect(getDefaultExportMimeType(GOOGLE_DRIVE_MIME_TYPES.spreadsheet)).toBe('text/csv');
    expect(getDefaultExportMimeType(GOOGLE_DRIVE_MIME_TYPES.presentation)).toBe('text/plain');
  });

  it('builds durable Drive-backed source metadata', () => {
    const metadata = buildGoogleDriveSourceMetadata({
      connectionId: 'conn-1',
      accountEmail: 'adam@example.com',
      file: {
        fileId: 'file-1',
        name: 'Board deck',
        mimeType: GOOGLE_DRIVE_MIME_TYPES.presentation,
        url: 'https://docs.google.com/presentation/d/file-1/edit',
      },
    });

    expect(metadata).toMatchObject({
      provider: 'google-drive',
      connectionId: 'conn-1',
      fileId: 'file-1',
      fileName: 'Board deck',
      accountEmail: 'adam@example.com',
      mimeType: GOOGLE_DRIVE_MIME_TYPES.presentation,
      exportMimeType: 'text/plain',
      extraction: { kind: 'presentation', format: 'plain-text' },
    });
  });
});

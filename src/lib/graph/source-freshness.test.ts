import { describe, expect, it } from 'vitest';
import {
  formatSourceAge,
  isRefreshableSourceNode,
  isStaleSourceNode,
  SOURCE_STALE_AFTER_MS,
} from '@/lib/graph/source-freshness';

describe('source freshness', () => {
  const now = Date.parse('2026-05-31T12:00:00.000Z');

  it('treats external source nodes as refreshable', () => {
    expect(isRefreshableSourceNode('source-web-url')).toBe(true);
    expect(isRefreshableSourceNode('source-google-doc')).toBe(true);
    expect(isRefreshableSourceNode('source-google-sheet')).toBe(true);
  });

  it('does not treat text sources or AI nodes as refreshable', () => {
    expect(isRefreshableSourceNode('source-text')).toBe(false);
    expect(isRefreshableSourceNode('default')).toBe(false);
  });

  it('marks old external sources as stale', () => {
    expect(
      isStaleSourceNode(
        {
          node_type: 'source-web-url',
          last_run_at: new Date(now - SOURCE_STALE_AFTER_MS - 1).toISOString(),
        },
        now,
      ),
    ).toBe(true);
  });

  it('keeps recently refreshed external sources fresh', () => {
    expect(
      isStaleSourceNode(
        {
          node_type: 'source-web-url',
          last_run_at: new Date(now - SOURCE_STALE_AFTER_MS + 1).toISOString(),
        },
        now,
      ),
    ).toBe(false);
  });

  it('formats source age for user-facing warnings', () => {
    expect(formatSourceAge(new Date(now - 61 * 24 * 60 * 60 * 1000).toISOString(), now)).toBe(
      '61d old',
    );
  });
});

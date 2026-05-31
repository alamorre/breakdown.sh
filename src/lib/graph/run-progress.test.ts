import { describe, expect, it } from 'vitest';
import {
  formatElapsed,
  getRunProgressState,
  sortRunProgressItems,
  summarizeRunProgress,
  type RunProgressItem,
} from '@/lib/graph/run-progress';

describe('run progress helpers', () => {
  it('summarizes checklist states for compact progress text', () => {
    const items: RunProgressItem[] = [
      { nodeId: 'a', name: 'A', runStatus: 'success', error: null },
      { nodeId: 'b', name: 'B', runStatus: 'running', error: null },
      { nodeId: 'c', name: 'C', runStatus: 'queued', error: null },
      { nodeId: 'd', name: 'D', runStatus: 'error', error: 'Source failed' },
      { nodeId: 'e', name: 'E', runStatus: 'idle', error: null },
      { nodeId: 'f', name: 'F', runStatus: 'skipped', error: 'Skipped because upstream failed' },
      { nodeId: 'g', name: 'G', runStatus: 'cancelled', error: 'Run cancelled' },
    ];

    expect(summarizeRunProgress(items)).toEqual({
      total: 7,
      succeeded: 1,
      failed: 1,
      skipped: 1,
      cancelled: 1,
      running: 1,
      queued: 1,
      pending: 1,
      settled: 4,
    });
  });

  it('labels skipped and cancelled nodes separately', () => {
    expect(
      getRunProgressState({
        runStatus: 'skipped',
        error: 'Skipped because upstream did not complete: Research',
      }),
    ).toEqual({ label: 'Blocked', tone: 'error' });

    expect(
      getRunProgressState({
        runStatus: 'cancelled',
        error: 'Run cancelled before this node started.',
      }),
    ).toEqual({ label: 'Cancelled', tone: 'warning' });
  });

  it('keeps status snapshots in the graph execution order', () => {
    const items: RunProgressItem[] = [
      { nodeId: 'c', name: 'C', runStatus: 'queued', error: null },
      { nodeId: 'a', name: 'A', runStatus: 'success', error: null },
      { nodeId: 'b', name: 'B', runStatus: 'running', error: null },
    ];

    expect(sortRunProgressItems(items, ['a', 'b', 'c']).map((item) => item.nodeId)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('formats elapsed time as minutes and zero-padded seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(4_999)).toBe('0:04');
    expect(formatElapsed(65_000)).toBe('1:05');
  });
});

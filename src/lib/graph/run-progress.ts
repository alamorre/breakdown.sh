import type { RunStatus } from '@/types/node';

export interface RunProgressItem {
  nodeId: string;
  name: string;
  runStatus: RunStatus;
  error: string | null;
}

export type RunProgressTone = 'pending' | 'running' | 'success' | 'warning' | 'error';

export interface RunProgressState {
  label: string;
  tone: RunProgressTone;
}

export interface RunProgressSummary {
  total: number;
  succeeded: number;
  failed: number;
  running: number;
  queued: number;
  pending: number;
  settled: number;
}

export function formatElapsed(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function getRunProgressState(
  item: Pick<RunProgressItem, 'runStatus' | 'error'>,
): RunProgressState {
  if (item.runStatus === 'success') {
    return { label: 'Done', tone: 'success' };
  }

  if (item.runStatus === 'running') {
    return { label: 'Running', tone: 'running' };
  }

  if (item.runStatus === 'queued') {
    return { label: 'Queued', tone: 'pending' };
  }

  const errorText = item.error?.toLowerCase() ?? '';
  if (item.runStatus === 'error') {
    return {
      label: errorText.startsWith('skipped because') ? 'Blocked' : 'Failed',
      tone: 'error',
    };
  }

  return {
    label: errorText.includes('cancel') ? 'Cancelled' : 'Pending',
    tone: errorText.includes('cancel') ? 'warning' : 'pending',
  };
}

export function summarizeRunProgress(items: RunProgressItem[]): RunProgressSummary {
  const summary: RunProgressSummary = {
    total: items.length,
    succeeded: 0,
    failed: 0,
    running: 0,
    queued: 0,
    pending: 0,
    settled: 0,
  };

  for (const item of items) {
    if (item.runStatus === 'success') {
      summary.succeeded++;
    } else if (item.runStatus === 'error') {
      summary.failed++;
    } else if (item.runStatus === 'running') {
      summary.running++;
    } else if (item.runStatus === 'queued') {
      summary.queued++;
    } else {
      summary.pending++;
    }
  }

  summary.settled = summary.succeeded + summary.failed;
  return summary;
}

export function sortRunProgressItems<TItem extends Pick<RunProgressItem, 'nodeId'>>(
  items: TItem[],
  orderedNodeIds: string[],
): TItem[] {
  const order = new Map(orderedNodeIds.map((nodeId, index) => [nodeId, index]));

  return [...items].sort(
    (a, b) =>
      (order.get(a.nodeId) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.nodeId) ?? Number.MAX_SAFE_INTEGER),
  );
}

import { getDataSourceType } from '@/types/data-source';
import type { ThesisNode } from '@/types/node';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const SOURCE_STALE_AFTER_MS = DAY_MS;

type SourceFreshnessNode = Pick<ThesisNode, 'node_type' | 'last_run_at'>;

export function isRefreshableSourceNode(nodeType: string): boolean {
  const sourceType = getDataSourceType(nodeType);
  return sourceType !== null && sourceType !== 'text';
}

export function getSourceAgeMs(lastRunAt: string | null, now = Date.now()): number | null {
  if (!lastRunAt) return null;

  const timestamp = Date.parse(lastRunAt);
  if (!Number.isFinite(timestamp)) return null;

  return Math.max(0, now - timestamp);
}

export function isStaleSourceNode(
  node: SourceFreshnessNode,
  now = Date.now(),
  staleAfterMs = SOURCE_STALE_AFTER_MS,
): boolean {
  if (!isRefreshableSourceNode(node.node_type)) return false;

  const ageMs = getSourceAgeMs(node.last_run_at, now);
  return ageMs === null || ageMs > staleAfterMs;
}

export function formatSourceAge(lastRunAt: string | null, now = Date.now()): string {
  const ageMs = getSourceAgeMs(lastRunAt, now);
  if (ageMs === null) return 'never refreshed';
  if (ageMs < MINUTE_MS) return 'just now';

  const days = Math.floor(ageMs / DAY_MS);
  if (days >= 1) return `${days}d old`;

  const hours = Math.floor(ageMs / HOUR_MS);
  if (hours >= 1) return `${hours}h old`;

  return `${Math.floor(ageMs / MINUTE_MS)}m old`;
}

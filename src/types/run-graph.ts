import type { RunStatus } from './node';

export interface RunGraphNodeResult {
  nodeId: string;
  runStatus: RunStatus;
  output?: string | null;
  summary?: string;
  lastRunAt?: string | null;
  error: string | null;
}

export interface RunGraphMetrics {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  cancelled: number;
  durationMs: number;
  maxConcurrency: number;
  eligibility: 'all-nodes';
}

export interface RunGraphData {
  results: RunGraphNodeResult[];
  metrics: RunGraphMetrics;
  cancelled: boolean;
}

export interface RunGraphResponse {
  data: RunGraphData | null;
  error: string | null;
}

export interface RunGraphStatusNode {
  nodeId: string;
  name: string;
  runStatus: RunStatus;
  output?: string | null;
  summary?: string;
  lastRunAt?: string | null;
  error: string | null;
}

export interface RunGraphStatusResponse {
  data: { nodes: RunGraphStatusNode[] } | null;
  error: string | null;
}

import type { ThesisNode } from '@/types/node';
import { sortTopologically, type DirectedEdge, type DirectedNode } from './topological-sort';

export const RUN_ALL_MAX_CONCURRENCY = 3;
export const RUN_ALL_PARALLEL_ELIGIBILITY = 'all-nodes' as const;

type RunAllSchedulerStatus = 'success' | 'failed' | 'skipped' | 'cancelled';

export interface RunAllSchedulerResult<TResult> {
  nodeId: string;
  status: RunAllSchedulerStatus;
  result?: TResult;
  error: string | null;
  upstreamNodeIds: string[];
}

export interface RunAllSchedulerSummary<TResult> {
  results: RunAllSchedulerResult<TResult>[];
  cancelled: boolean;
  maxConcurrency: number;
  eligibility: typeof RUN_ALL_PARALLEL_ELIGIBILITY;
}

interface RunDependencyAwareBatchesOptions<TNode extends DirectedNode, TResult> {
  nodes: TNode[];
  edges: DirectedEdge[];
  maxConcurrency?: number;
  runNode: (node: TNode) => Promise<TResult>;
  shouldCancel?: () => boolean;
  onNodeStart?: (node: TNode) => void | Promise<void>;
  onNodeSettled?: (result: RunAllSchedulerResult<TResult>, node: TNode) => void | Promise<void>;
}

export class RunAllCycleError extends Error {
  readonly unsortedNodeIds: string[];

  constructor(unsortedNodeIds: string[]) {
    super('Run all requires an acyclic graph.');
    this.name = 'RunAllCycleError';
    this.unsortedNodeIds = unsortedNodeIds;
  }
}

export function isParallelRunEligibleNode(node: Pick<ThesisNode, 'node_type'>): boolean {
  return typeof node.node_type === 'string';
}

export async function runDependencyAwareBatches<TNode extends DirectedNode, TResult>({
  nodes,
  edges,
  maxConcurrency = RUN_ALL_MAX_CONCURRENCY,
  runNode,
  shouldCancel = () => false,
  onNodeStart,
  onNodeSettled,
}: RunDependencyAwareBatchesOptions<TNode, TResult>): Promise<RunAllSchedulerSummary<TResult>> {
  const { unsortedNodeIds } = sortTopologically(nodes, edges);
  if (unsortedNodeIds.length > 0) {
    throw new RunAllCycleError(unsortedNodeIds);
  }

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const dependencies = new Map<string, string[]>();
  const adjacency = new Map<string, string[]>();
  const pendingDependencies = new Map<string, number>();
  const results = new Map<string, RunAllSchedulerResult<TResult>>();
  const limit = Math.max(1, Math.floor(maxConcurrency));

  for (const node of nodes) {
    dependencies.set(node.id, []);
    adjacency.set(node.id, []);
    pendingDependencies.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) {
      continue;
    }

    dependencies.get(edge.target)?.push(edge.source);
    adjacency.get(edge.source)?.push(edge.target);
    pendingDependencies.set(edge.target, (pendingDependencies.get(edge.target) ?? 0) + 1);
  }

  for (const dependents of adjacency.values()) {
    dependents.sort((a, b) => (nodeOrder.get(a) ?? 0) - (nodeOrder.get(b) ?? 0));
  }

  const readyQueue = nodes
    .filter((node) => pendingDependencies.get(node.id) === 0)
    .map((node) => node.id);

  let runningCount = 0;
  let cancelled = shouldCancel();

  async function settleNode(result: RunAllSchedulerResult<TResult>) {
    const node = nodeMap.get(result.nodeId);
    if (!node || results.has(result.nodeId)) {
      return;
    }

    results.set(result.nodeId, result);
    await onNodeSettled?.(result, node);

    for (const dependentId of adjacency.get(result.nodeId) ?? []) {
      pendingDependencies.set(dependentId, (pendingDependencies.get(dependentId) ?? 0) - 1);
      if (pendingDependencies.get(dependentId) === 0) {
        readyQueue.push(dependentId);
      }
    }
  }

  async function cancelUnstartedNodes() {
    for (const node of nodes) {
      if (results.has(node.id)) {
        continue;
      }

      await settleNode({
        nodeId: node.id,
        status: 'cancelled',
        error: 'Run cancelled before this node started.',
        upstreamNodeIds: [],
      });
    }
  }

  async function maybeSkipBlockedReadyNodes() {
    let skippedAny = false;

    for (let index = 0; index < readyQueue.length; ) {
      const nodeId = readyQueue[index];
      const upstreamNodeIds = (dependencies.get(nodeId) ?? []).filter(
        (dependencyId) => results.get(dependencyId)?.status !== 'success',
      );

      if (upstreamNodeIds.length === 0) {
        index++;
        continue;
      }

      readyQueue.splice(index, 1);
      await settleNode({
        nodeId,
        status: 'skipped',
        error: 'Skipped because one or more upstream nodes did not complete successfully.',
        upstreamNodeIds,
      });
      skippedAny = true;
    }

    return skippedAny;
  }

  return new Promise((resolve) => {
    const finish = () => {
      const orderedResults = nodes
        .map((node) => results.get(node.id))
        .filter((result): result is RunAllSchedulerResult<TResult> => Boolean(result));

      resolve({
        results: orderedResults,
        cancelled,
        maxConcurrency: limit,
        eligibility: RUN_ALL_PARALLEL_ELIGIBILITY,
      });
    };

    const schedule = () => {
      void (async () => {
        while (await maybeSkipBlockedReadyNodes()) {
          // Keep propagating skips through descendants that have become ready.
        }

        if (shouldCancel()) {
          cancelled = true;
        }

        if (cancelled) {
          if (runningCount === 0) {
            await cancelUnstartedNodes();
            finish();
          }
          return;
        }

        while (runningCount < limit && readyQueue.length > 0) {
          const nodeId = readyQueue.shift();
          const node = nodeId ? nodeMap.get(nodeId) : undefined;
          if (!node || results.has(node.id)) {
            continue;
          }

          runningCount++;
          void (async () => {
            try {
              await onNodeStart?.(node);
              const result = await runNode(node);
              await settleNode({
                nodeId: node.id,
                status: 'success',
                result,
                error: null,
                upstreamNodeIds: [],
              });
            } catch (err) {
              await settleNode({
                nodeId: node.id,
                status: 'failed',
                error: err instanceof Error ? err.message : 'Run failed',
                upstreamNodeIds: [],
              });
            } finally {
              runningCount--;
              schedule();
            }
          })();
        }

        if (runningCount === 0 && results.size === nodes.length) {
          finish();
        }
      })();
    };

    schedule();
  });
}

import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { runNode } from '@/actions/node-actions';
import { resolveAnthropicModelId } from '@/lib/ai/models';
import type { RunStatus, ThesisNode } from '@/types/node';
import type { ThesisEdge } from '@/types/edge';
import type {
  RunGraphNodeResult,
  RunGraphResponse,
  RunGraphStatusNode,
  RunGraphStatusResponse,
  RunGraphStreamEvent,
} from '@/types/run-graph';
import { sortTopologically } from './topological-sort';
import {
  getRunAllInitialPlan,
  RUN_ALL_MAX_CONCURRENCY,
  RunAllCycleError,
  runDependencyAwareBatches,
} from './run-all';
import { isRunCancelled } from './run-cancellation';

const runGraphInputSchema = z.object({
  graphId: z.string().uuid(),
  runId: z.string().min(1).max(100),
});

type RunGraphProgressHandler = (event: RunGraphStreamEvent) => void | Promise<void>;

async function publishProgress(
  handler: RunGraphProgressHandler | undefined,
  event: RunGraphStreamEvent,
) {
  try {
    await handler?.(event);
  } catch {
    // Progress streaming is best-effort; the server-side run should continue if a client disconnects.
  }
}

async function getUserId(): Promise<string> {
  const { userId } = await auth();
  if (!userId) {
    throw new Error('Unauthorized');
  }
  return userId;
}

function formatSkippedError(result: { upstreamNodeIds: string[] }, nodeNames: Map<string, string>) {
  const upstreamNames = result.upstreamNodeIds.map(
    (nodeId) => nodeNames.get(nodeId) ?? 'Unknown node',
  );
  return `Skipped because upstream did not complete: ${upstreamNames.join(', ')}`;
}

function getNodeSummary(node: ThesisNode) {
  return (node.metadata as { summary?: string } | null)?.summary;
}

function toStatusNode(
  node: ThesisNode,
  overrides: Partial<Omit<RunGraphStatusNode, 'nodeId' | 'name'>> = {},
): RunGraphStatusNode {
  return {
    nodeId: node.id,
    name: node.name,
    runStatus: overrides.runStatus ?? (node.run_status as RunStatus),
    output: overrides.output ?? node.output,
    summary: overrides.summary ?? getNodeSummary(node),
    lastRunAt: overrides.lastRunAt ?? node.last_run_at,
    error: overrides.error ?? node.run_error,
  };
}

function mapSchedulerResultToNodeResult(
  result: {
    nodeId: string;
    status: 'success' | 'failed' | 'skipped' | 'cancelled';
    result?: { output: string; summary?: string; lastRunAt: string };
    error: string | null;
    upstreamNodeIds: string[];
  },
  nodeNames: Map<string, string>,
): RunGraphNodeResult {
  if (result.status === 'success') {
    return {
      nodeId: result.nodeId,
      runStatus: 'success',
      output: result.result?.output,
      summary: result.result?.summary,
      lastRunAt: result.result?.lastRunAt,
      error: null,
    };
  }

  if (result.status === 'cancelled') {
    return {
      nodeId: result.nodeId,
      runStatus: 'cancelled',
      error: 'Run cancelled before this node started.',
    };
  }

  if (result.status === 'skipped') {
    return {
      nodeId: result.nodeId,
      runStatus: 'skipped',
      error: formatSkippedError(result, nodeNames),
    };
  }

  return {
    nodeId: result.nodeId,
    runStatus: 'error',
    error: result.error ?? 'Run failed',
  };
}

async function setFailedSkippedOrCancelledNodeStatus(
  supabase: ReturnType<typeof createServerClient>,
  result: RunGraphNodeResult,
) {
  const { error } = await supabase
    .from('nodes')
    .update({
      run_status: result.runStatus,
      run_error: result.error,
      updated_at: new Date().toISOString(),
    })
    .eq('id', result.nodeId);

  if (error) {
    throw new Error(error.message);
  }
}

async function markNodesQueued(
  supabase: ReturnType<typeof createServerClient>,
  nodes: ThesisNode[],
) {
  if (nodes.length === 0) {
    return;
  }

  const { error } = await supabase
    .from('nodes')
    .update({
      run_status: 'queued',
      run_error: null,
      updated_at: new Date().toISOString(),
    })
    .in(
      'id',
      nodes.map((node) => node.id),
    );

  if (error) {
    throw new Error(error.message);
  }
}

export async function getGraphRunStatus(graphId: string): Promise<RunGraphStatusResponse> {
  try {
    const userId = await getUserId();
    const supabase = createServerClient();

    const { data: graph, error: graphError } = await supabase
      .from('graphs')
      .select('id')
      .eq('id', graphId)
      .eq('user_id', userId)
      .single();

    if (graphError || !graph) {
      return { data: null, error: graphError?.message ?? 'Graph not found' };
    }

    const { data: nodes, error: nodesError } = await supabase
      .from('nodes')
      .select('id,name,run_status,run_error,last_run_at,output,metadata')
      .eq('graph_id', graphId);

    if (nodesError) {
      return { data: null, error: nodesError.message };
    }

    return {
      data: {
        nodes: ((nodes ?? []) as ThesisNode[]).map((node) => toStatusNode(node)),
      },
      error: null,
    };
  } catch (err) {
    return { data: null, error: err instanceof Error ? err.message : 'Failed to load run status' };
  }
}

export async function runGraphWithScheduler(input: {
  graphId: string;
  runId: string;
  onProgress?: RunGraphProgressHandler;
}): Promise<RunGraphResponse> {
  const parsed = runGraphInputSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }
  try {
    const userId = await getUserId();
    const startedAt = Date.now();
    const supabase = createServerClient();

    const { data: graph, error: graphError } = await supabase
      .from('graphs')
      .select('*')
      .eq('id', parsed.data.graphId)
      .eq('user_id', userId)
      .single();

    if (graphError || !graph) {
      return { data: null, error: graphError?.message ?? 'Graph not found' };
    }

    const executionModel = resolveAnthropicModelId(
      (graph as { llm_model?: string | null }).llm_model,
    );

    const [nodesResult, edgesResult] = await Promise.all([
      supabase.from('nodes').select('*').eq('graph_id', parsed.data.graphId),
      supabase.from('edges').select('*').eq('graph_id', parsed.data.graphId),
    ]);

    if (nodesResult.error) {
      return { data: null, error: nodesResult.error.message };
    }
    if (edgesResult.error) {
      return { data: null, error: edgesResult.error.message };
    }

    const nodes = (nodesResult.data ?? []) as ThesisNode[];
    const edges = (edgesResult.data ?? []) as ThesisEdge[];
    const nodeNames = new Map(nodes.map((node) => [node.id, node.name]));
    const runEdges = edges.map((edge) => ({
      source: edge.source_node_id,
      target: edge.target_node_id,
    }));

    const { unsortedNodeIds } = sortTopologically(nodes, runEdges);
    if (unsortedNodeIds.length > 0) {
      throw new RunAllCycleError(unsortedNodeIds);
    }
    await markNodesQueued(supabase, nodes);

    const initialPlan = getRunAllInitialPlan(nodes, runEdges, RUN_ALL_MAX_CONCURRENCY);
    const initiallyRunningNodeIds = new Set(initialPlan.runningNodeIds);
    const readyQueuedNodeIds = new Set(initialPlan.readyQueuedNodeIds);
    await publishProgress(input.onProgress, {
      type: 'run-started',
      nodes: nodes.map((node) =>
        toStatusNode(node, {
          runStatus: initiallyRunningNodeIds.has(node.id) ? 'running' : 'queued',
          error: initiallyRunningNodeIds.has(node.id)
            ? null
            : readyQueuedNodeIds.has(node.id)
              ? 'Waiting for a concurrency slot.'
              : 'Waiting for upstream nodes to finish.',
        }),
      ),
    });

    const summary = await runDependencyAwareBatches<
      ThesisNode,
      { output: string; summary?: string; lastRunAt: string }
    >({
      nodes,
      edges: runEdges,
      maxConcurrency: RUN_ALL_MAX_CONCURRENCY,
      shouldCancel: () => isRunCancelled(supabase, parsed.data.graphId),
      onNodeStart: async (node) => {
        await supabase
          .from('nodes')
          .update({
            run_status: 'running',
            run_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', node.id);
        await publishProgress(input.onProgress, {
          type: 'node-started',
          node: toStatusNode(node, {
            runStatus: 'running',
            error: null,
          }),
        });
      },
      onNodeSettled: async (result) => {
        const node = nodes.find((candidate) => candidate.id === result.nodeId);
        const mappedResult = mapSchedulerResultToNodeResult(result, nodeNames);

        if (mappedResult.runStatus !== 'success') {
          await setFailedSkippedOrCancelledNodeStatus(supabase, mappedResult);
        }

        if (node) {
          await publishProgress(input.onProgress, {
            type: 'node-settled',
            node: toStatusNode(node, {
              runStatus: mappedResult.runStatus,
              output: mappedResult.output,
              summary: mappedResult.summary,
              lastRunAt: mappedResult.lastRunAt,
              error: mappedResult.error,
            }),
          });
        }
      },
      runNode: async (node) => {
        const result = await runNode({ nodeId: node.id, llmModel: executionModel });
        if (result.error || !result.data) {
          throw new Error(result.error ?? 'Run failed');
        }
        return result.data;
      },
    });

    const results = summary.results.map((result) =>
      mapSchedulerResultToNodeResult(result, nodeNames),
    );

    return {
      data: {
        results,
        cancelled: summary.cancelled,
        metrics: {
          total: results.length,
          succeeded: summary.results.filter((result) => result.status === 'success').length,
          failed: summary.results.filter((result) => result.status === 'failed').length,
          skipped: summary.results.filter((result) => result.status === 'skipped').length,
          cancelled: summary.results.filter((result) => result.status === 'cancelled').length,
          durationMs: Date.now() - startedAt,
          maxConcurrency: summary.maxConcurrency,
          eligibility: summary.eligibility,
        },
      },
      error: null,
    };
  } catch (err) {
    if (err instanceof RunAllCycleError) {
      return {
        data: null,
        error: 'Run all requires an acyclic graph. Remove the cycle and try again.',
      };
    }

    return { data: null, error: err instanceof Error ? err.message : 'Failed to run graph' };
  }
}

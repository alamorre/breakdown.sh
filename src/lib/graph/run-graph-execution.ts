import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { createServerClient } from '@/lib/supabase/server';
import { runNode } from '@/actions/node-actions';
import type { RunStatus, ThesisNode } from '@/types/node';
import type { ThesisEdge } from '@/types/edge';
import type {
  RunGraphNodeResult,
  RunGraphResponse,
  RunGraphStatusResponse,
} from '@/types/run-graph';
import { sortTopologically } from './topological-sort';
import { RUN_ALL_MAX_CONCURRENCY, RunAllCycleError, runDependencyAwareBatches } from './run-all';
import { clearRunCancellation, isRunCancelled } from './run-cancellation';

const runGraphInputSchema = z.object({
  graphId: z.string().uuid(),
  runId: z.string().min(1).max(100),
});

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

async function setSkippedOrCancelledNodeStatus(
  supabase: ReturnType<typeof createServerClient>,
  result: RunGraphNodeResult,
) {
  await supabase
    .from('nodes')
    .update({
      run_status: result.runStatus,
      run_error: result.error,
      updated_at: new Date().toISOString(),
    })
    .eq('id', result.nodeId);
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
        nodes: ((nodes ?? []) as ThesisNode[]).map((node) => ({
          nodeId: node.id,
          name: node.name,
          runStatus: node.run_status as RunStatus,
          output: node.output,
          summary: (node.metadata as { summary?: string } | null)?.summary,
          lastRunAt: node.last_run_at,
          error: node.run_error,
        })),
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
}): Promise<RunGraphResponse> {
  const parsed = runGraphInputSchema.safeParse(input);
  if (!parsed.success) {
    return { data: null, error: parsed.error.message };
  }

  clearRunCancellation(parsed.data.runId);

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

    const summary = await runDependencyAwareBatches<
      ThesisNode,
      { output: string; summary?: string; lastRunAt: string }
    >({
      nodes,
      edges: runEdges,
      maxConcurrency: RUN_ALL_MAX_CONCURRENCY,
      shouldCancel: () => isRunCancelled(parsed.data.runId),
      onNodeStart: async (node) => {
        await supabase
          .from('nodes')
          .update({
            run_status: 'running',
            run_error: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', node.id);
      },
      onNodeSettled: async (result) => {
        if (result.status !== 'skipped' && result.status !== 'cancelled') {
          return;
        }

        const mappedResult: RunGraphNodeResult = {
          nodeId: result.nodeId,
          runStatus: result.status === 'cancelled' ? 'idle' : 'error',
          error:
            result.status === 'cancelled'
              ? 'Run cancelled before this node started.'
              : formatSkippedError(result, nodeNames),
        };
        await setSkippedOrCancelledNodeStatus(supabase, mappedResult);
      },
      runNode: async (node) => {
        const result = await runNode({ nodeId: node.id });
        if (result.error || !result.data) {
          throw new Error(result.error ?? 'Run failed');
        }
        return result.data;
      },
    });

    const results: RunGraphNodeResult[] = summary.results.map((result) => {
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
          runStatus: 'idle',
          error: 'Run cancelled before this node started.',
        };
      }

      return {
        nodeId: result.nodeId,
        runStatus: 'error',
        error:
          result.status === 'skipped'
            ? formatSkippedError(result, nodeNames)
            : (result.error ?? 'Run failed'),
      };
    });

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
  } finally {
    clearRunCancellation(parsed.data.runId);
  }
}

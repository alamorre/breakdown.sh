'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Play, Loader2, LayoutGrid, Download, Square } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateGraphName } from '@/actions/graph-actions';
import { useGraphStore, type CanvasNode } from '@/store/graph-store';
import { computeLayout } from '@/lib/layout/elk-layout';
import { exportGraph } from '@/lib/export/export-graph';
import { getRunAllInitialPlan, RUN_ALL_MAX_CONCURRENCY } from '@/lib/graph/run-all';
import { sortTopologically } from '@/lib/graph/topological-sort';
import { sortRunProgressItems, type RunProgressItem } from '@/lib/graph/run-progress';
import { notifyRunCompletion } from '@/lib/notifications/run-completion';
import { RunAllProgressToast } from '@/components/canvas/RunAllProgressToast';
import type {
  RunGraphNodeResult,
  RunGraphResponse,
  RunGraphStatusNode,
  RunGraphStatusResponse,
} from '@/types/run-graph';

const RUN_PROGRESS_TOAST_ID = 'run-all-progress';
const RUN_PROGRESS_POLL_MS = 1500;

function buildInitialProgressItems(
  nodes: CanvasNode[],
  runningNodeIds: string[],
  readyQueuedNodeIds: string[],
): RunProgressItem[] {
  const runningIds = new Set(runningNodeIds);
  const readyQueuedIds = new Set(readyQueuedNodeIds);

  return nodes.map((node) => ({
    nodeId: node.id,
    name: node.data.thesisNode.name,
    runStatus: runningIds.has(node.id) ? 'running' : 'queued',
    error: runningIds.has(node.id)
      ? null
      : readyQueuedIds.has(node.id)
        ? 'Waiting for a concurrency slot.'
        : 'Waiting for upstream nodes to finish.',
  }));
}

function buildLiveProgressItems(
  statusNodes: RunGraphStatusNode[],
  orderedNodeIds: string[],
): RunProgressItem[] {
  return sortRunProgressItems(
    statusNodes.map((node) => ({
      nodeId: node.nodeId,
      name: node.name,
      runStatus: node.runStatus,
      error: node.error,
    })),
    orderedNodeIds,
  );
}

function buildResultProgressItems(
  results: RunGraphNodeResult[],
  orderedNodes: CanvasNode[],
): RunProgressItem[] {
  const nodeNames = new Map(orderedNodes.map((node) => [node.id, node.data.thesisNode.name]));

  return sortRunProgressItems(
    results.map((result) => ({
      nodeId: result.nodeId,
      name: nodeNames.get(result.nodeId) ?? 'Unknown node',
      runStatus: result.runStatus,
      error: result.error,
    })),
    orderedNodes.map((node) => node.id),
  );
}

interface GraphTopBarProps {
  graphId: string;
  initialName: string;
}

export function GraphTopBar({ graphId, initialName }: GraphTopBarProps) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [layouting, setLayouting] = useState(false);

  const { nodes, edges, graph, setNodeRunState } = useGraphStore();
  const reactFlowInstance = useReactFlow();
  const activeRunIdRef = useRef<string | null>(null);
  const activeRunStartedAtRef = useRef<number | null>(null);
  const activeRunProgressNoteRef = useRef<string | undefined>(undefined);
  const activeProgressItemsRef = useRef<RunProgressItem[]>([]);
  const progressPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleSave = useCallback(async () => {
    setEditing(false);
    if (name.trim() === initialName) return;

    const trimmed = name.trim() || initialName;
    setName(trimmed);

    const { error } = await updateGraphName(graphId, trimmed);
    if (error) {
      toast.error('Failed to rename graph');
      setName(initialName);
    }
  }, [name, initialName, graphId]);

  const handleRunAll = useCallback(async () => {
    if (!graph) return;
    const currentNodes = useGraphStore.getState().nodes;
    const currentEdges = useGraphStore.getState().edges;
    const runEdges = currentEdges.map((edge) => ({
      source: edge.data.thesisEdge.source_node_id,
      target: edge.data.thesisEdge.target_node_id,
    }));

    if (currentNodes.length === 0) {
      toast.info('No nodes to run');
      return;
    }

    const { sortedNodes, unsortedNodeIds } = sortTopologically(currentNodes, runEdges);

    if (unsortedNodeIds.length > 0) {
      toast.error('Run all requires an acyclic graph. Remove the cycle and try again.');
      return;
    }

    const orderedNodes = sortedNodes.length === currentNodes.length ? sortedNodes : currentNodes;
    const orderedNodeIds = orderedNodes.map((node) => node.id);
    const initialPlan = getRunAllInitialPlan(orderedNodes, runEdges, RUN_ALL_MAX_CONCURRENCY);
    const initiallyRunningNodeIds = new Set(initialPlan.runningNodeIds);
    const readyQueuedNodeIds = new Set(initialPlan.readyQueuedNodeIds);
    const runId = crypto.randomUUID();
    const startedAt = Date.now();
    activeRunIdRef.current = runId;
    activeRunStartedAtRef.current = startedAt;
    activeRunProgressNoteRef.current = undefined;
    setRunningAll(true);

    const showProgressToast = (items: RunProgressItem[], note?: string) => {
      const progressNote = note ?? activeRunProgressNoteRef.current;
      activeProgressItemsRef.current = items;
      toast.custom(
        () => (
          <RunAllProgressToast
            items={items}
            elapsedMs={Date.now() - startedAt}
            note={progressNote}
          />
        ),
        {
          id: RUN_PROGRESS_TOAST_ID,
          duration: Infinity,
        },
      );
    };

    const applyStatusNodes = (statusNodes: RunGraphStatusNode[]) => {
      for (const statusNode of statusNodes) {
        setNodeRunState(statusNode.nodeId, {
          run_status: statusNode.runStatus,
          output: statusNode.output,
          run_error: statusNode.error,
          last_run_at: statusNode.lastRunAt,
          ...(statusNode.summary ? { metadata: { summary: statusNode.summary } } : {}),
        });
      }
    };

    const pollRunStatus = async () => {
      try {
        const response = await fetch(`/api/graphs/${graph.id}/run`, { cache: 'no-store' });
        const snapshot = (await response.json()) as RunGraphStatusResponse;
        if (activeRunIdRef.current !== runId || !response.ok || snapshot.error || !snapshot.data) {
          return;
        }

        applyStatusNodes(snapshot.data.nodes);
        showProgressToast(buildLiveProgressItems(snapshot.data.nodes, orderedNodeIds));
      } catch {
        // Polling only improves progress visibility; the main run request still owns final state.
      }
    };

    try {
      for (const node of currentNodes) {
        if (initiallyRunningNodeIds.has(node.id)) {
          setNodeRunState(node.id, { run_status: 'running', run_error: null });
        } else {
          setNodeRunState(node.id, {
            run_status: 'queued',
            run_error: readyQueuedNodeIds.has(node.id)
              ? 'Waiting for a concurrency slot.'
              : 'Waiting for upstream nodes to finish.',
          });
        }
      }

      showProgressToast(
        buildInitialProgressItems(
          orderedNodes,
          initialPlan.runningNodeIds,
          initialPlan.readyQueuedNodeIds,
        ),
      );

      const runRequest = fetch(`/api/graphs/${graph.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });

      progressPollRef.current = setInterval(() => {
        void pollRunStatus();
      }, RUN_PROGRESS_POLL_MS);

      const response = await runRequest;
      const result = (await response.json()) as RunGraphResponse;

      if (!response.ok || result.error || !result.data) {
        toast.error(result.error ?? 'Failed to run graph');
        for (const node of currentNodes) {
          setNodeRunState(node.id, {
            run_status: 'error',
            run_error: result.error ?? 'Run failed',
          });
        }
        return;
      }

      for (const nodeResult of result.data.results) {
        setNodeRunState(nodeResult.nodeId, {
          run_status: nodeResult.runStatus,
          output: nodeResult.output,
          run_error: nodeResult.error,
          last_run_at: nodeResult.lastRunAt,
          ...(nodeResult.summary ? { metadata: { summary: nodeResult.summary } } : {}),
        });
      }
      showProgressToast(buildResultProgressItems(result.data.results, orderedNodes));

      const { metrics } = result.data;
      if (result.data.cancelled) {
        toast.info(
          `Run cancelled after ${metrics.succeeded + metrics.failed}/${metrics.total} nodes settled`,
        );
      } else if (metrics.failed === 0 && metrics.skipped === 0) {
        notifyRunCompletion({
          graphName: graph.name,
          nodeCount: metrics.succeeded,
          url: window.location.href,
        });
      } else {
        const skippedText = metrics.skipped > 0 ? `, ${metrics.skipped} skipped` : '';
        const cancelledText = metrics.cancelled > 0 ? `, ${metrics.cancelled} cancelled` : '';
        toast.warning(
          `${metrics.succeeded}/${metrics.total} nodes succeeded, ${metrics.failed} failed${skippedText}${cancelledText}`,
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to run graph');
      for (const node of currentNodes) {
        setNodeRunState(node.id, {
          run_status: 'error',
          run_error: err instanceof Error ? err.message : 'Run failed',
        });
      }
    } finally {
      if (activeRunIdRef.current === runId) {
        activeRunIdRef.current = null;
      }
      if (activeRunStartedAtRef.current === startedAt) {
        activeRunStartedAtRef.current = null;
        activeRunProgressNoteRef.current = undefined;
        activeProgressItemsRef.current = [];
      }
      if (progressPollRef.current) {
        clearInterval(progressPollRef.current);
        progressPollRef.current = null;
      }
      toast.dismiss(RUN_PROGRESS_TOAST_ID);
      setRunningAll(false);
    }
  }, [graph, setNodeRunState]);

  const handleCancelRun = useCallback(() => {
    const runId = activeRunIdRef.current;
    if (!graph || !runId) return;

    if (activeProgressItemsRef.current.length > 0) {
      const startedAt = activeRunStartedAtRef.current ?? Date.now();
      const cancelNote =
        'Cancel requested. In-flight nodes will finish; queued nodes will not start.';
      activeRunProgressNoteRef.current = cancelNote;
      toast.custom(
        () => (
          <RunAllProgressToast
            items={activeProgressItemsRef.current}
            elapsedMs={Date.now() - startedAt}
            note={cancelNote}
          />
        ),
        {
          id: RUN_PROGRESS_TOAST_ID,
          duration: Infinity,
        },
      );
    }
    void fetch(`/api/graphs/${graph.id}/run/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runId }),
    }).catch(() => {
      toast.error('Failed to cancel run');
    });
  }, [graph]);

  const handleAutoLayout = useCallback(async () => {
    setLayouting(true);
    try {
      const newPositions = await computeLayout(nodes, edges);
      reactFlowInstance.setNodes((currentNodes) =>
        currentNodes.map((node) => {
          const pos = newPositions.get(node.id);
          if (pos) {
            return { ...node, position: pos };
          }
          return node;
        }),
      );
      setTimeout(() => {
        reactFlowInstance.fitView({ padding: 0.2 });
      }, 50);
      toast.success('Layout applied');
    } catch {
      toast.error('Failed to compute layout');
    }
    setLayouting(false);
  }, [nodes, edges, reactFlowInstance]);

  const handleExport = useCallback(() => {
    if (!graph) return;

    const storeNodes = useGraphStore.getState().nodes;
    const storeEdges = useGraphStore.getState().edges;
    const json = exportGraph(graph, storeNodes, storeEdges);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const fileName = `${graph.name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-')}-${date}.json`;

    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }, [graph]);

  return (
    <div className="flex h-12 items-center gap-3 border-b border-border px-4">
      <Link href="/dashboard">
        <Button variant="ghost" size="sm">
          &larr; Back
        </Button>
      </Link>

      {editing ? (
        <Input
          className="h-8 w-64"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void handleSave();
            if (e.key === 'Escape') {
              setName(initialName);
              setEditing(false);
            }
          }}
          autoFocus
        />
      ) : (
        <button className="text-sm font-medium hover:underline" onClick={() => setEditing(true)}>
          {name}
        </button>
      )}

      <div className="flex-1" />

      <Button variant="outline" size="sm" onClick={handleAutoLayout} disabled={layouting}>
        {layouting ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <LayoutGrid className="size-3.5" />
        )}
        Auto Layout
      </Button>

      <Button variant="outline" size="sm" onClick={handleExport}>
        <Download className="size-3.5" />
        Export
      </Button>

      {runningAll ? (
        <Button size="sm" variant="destructive" onClick={handleCancelRun}>
          <Square className="size-3.5" />
          Cancel
        </Button>
      ) : (
        <Button size="sm" onClick={handleRunAll}>
          <Play className="size-3.5" />
          Run All
        </Button>
      )}
    </div>
  );
}

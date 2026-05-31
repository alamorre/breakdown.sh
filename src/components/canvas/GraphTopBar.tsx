'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Play, Loader2, LayoutGrid, Download, Square } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateGraphName } from '@/actions/graph-actions';
import { useGraphStore } from '@/store/graph-store';
import { computeLayout } from '@/lib/layout/elk-layout';
import { exportGraph } from '@/lib/export/export-graph';
import { sortTopologically } from '@/lib/graph/topological-sort';
import { notifyRunCompletion } from '@/lib/notifications/run-completion';
import type { RunGraphResponse } from '@/types/run-graph';

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

    if (currentNodes.length === 0) {
      toast.info('No nodes to run');
      return;
    }

    const { unsortedNodeIds } = sortTopologically(
      currentNodes,
      currentEdges.map((edge) => ({
        source: edge.data.thesisEdge.source_node_id,
        target: edge.data.thesisEdge.target_node_id,
      })),
    );

    if (unsortedNodeIds.length > 0) {
      toast.error('Run all requires an acyclic graph. Remove the cycle and try again.');
      return;
    }

    const runId = crypto.randomUUID();
    activeRunIdRef.current = runId;
    setRunningAll(true);

    try {
      for (const node of currentNodes) {
        setNodeRunState(node.id, { run_status: 'running', run_error: null });
      }

      toast.loading(`Running ${currentNodes.length} nodes with bounded parallelism`, {
        id: 'run-all-progress',
      });

      const response = await fetch(`/api/graphs/${graph.id}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId }),
      });
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
      toast.dismiss('run-all-progress');
      setRunningAll(false);
    }
  }, [graph, setNodeRunState]);

  const handleCancelRun = useCallback(() => {
    const runId = activeRunIdRef.current;
    if (!graph || !runId) return;

    toast.loading('Cancelling after in-flight nodes finish...', { id: 'run-all-progress' });
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

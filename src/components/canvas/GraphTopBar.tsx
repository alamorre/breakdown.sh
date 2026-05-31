'use client';

import { useState, useCallback, useRef } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Play, Loader2, LayoutGrid, Download, Square } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updateGraphName } from '@/actions/graph-actions';
import { runNode } from '@/actions/node-actions';
import { useGraphStore } from '@/store/graph-store';
import { computeLayout } from '@/lib/layout/elk-layout';
import { exportGraph } from '@/lib/export/export-graph';
import { sortTopologically } from '@/lib/graph/topological-sort';
import { notifyRunCompletion } from '@/lib/notifications/run-completion';

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

  const cancelRef = useRef(false);

  const handleRunAll = useCallback(async () => {
    if (!graph) return;
    cancelRef.current = false;
    setRunningAll(true);

    try {
      const currentNodes = useGraphStore.getState().nodes;
      const currentEdges = useGraphStore.getState().edges;
      const { sortedNodes, unsortedNodeIds } = sortTopologically(
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

      if (sortedNodes.length === 0) {
        toast.info('No nodes to run');
        return;
      }

      let completed = 0;
      let failed = 0;

      for (const node of sortedNodes) {
        if (cancelRef.current) {
          toast.info(`Run cancelled after ${completed}/${sortedNodes.length} nodes`);
          break;
        }

        setNodeRunState(node.id, { run_status: 'running' });
        toast.loading(
          `Running node ${completed + 1}/${sortedNodes.length}: ${node.data.thesisNode.name}`,
          {
            id: 'run-all-progress',
          },
        );

        try {
          const { data, error } = await runNode({ nodeId: node.id });

          if (error || !data) {
            failed++;
            setNodeRunState(node.id, {
              run_status: 'error',
              run_error: error ?? 'Run failed',
            });
          } else {
            setNodeRunState(node.id, {
              run_status: 'success',
              output: data.output,
              run_error: null,
              last_run_at: new Date().toISOString(),
              ...(data.summary ? { metadata: { summary: data.summary } } : {}),
            });
          }
        } catch (err) {
          failed++;
          setNodeRunState(node.id, {
            run_status: 'error',
            run_error: err instanceof Error ? err.message : 'Run failed',
          });
        }

        completed++;
      }

      if (!cancelRef.current) {
        if (failed === 0) {
          notifyRunCompletion({
            graphName: graph.name,
            nodeCount: completed,
            url: window.location.href,
          });
        } else {
          toast.warning(`${completed - failed}/${completed} nodes succeeded, ${failed} failed`);
        }
      }
    } finally {
      toast.dismiss('run-all-progress');
      setRunningAll(false);
    }
  }, [graph, setNodeRunState]);

  const handleCancelRun = useCallback(() => {
    cancelRef.current = true;
  }, []);

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

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
import { getFailedUpstreamNodeNames } from '@/lib/graph/run-all';
import { formatSourceAge, isStaleSourceNode } from '@/lib/graph/source-freshness';
import { notifyRunCompletion } from '@/lib/notifications/run-completion';
import { isDataSourceNode } from '@/types/data-source';

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

      const staleSources = sortedNodes.filter((node) => isStaleSourceNode(node.data.thesisNode));
      if (staleSources.length > 0) {
        const preview = staleSources
          .slice(0, 3)
          .map(
            (node) =>
              `${node.data.thesisNode.name} (${formatSourceAge(node.data.thesisNode.last_run_at)})`,
          )
          .join(', ');
        const more = staleSources.length > 3 ? `, +${staleSources.length - 3} more` : '';
        toast.warning(`Refreshing stale sources before analysis: ${preview}${more}`);
      }

      let processed = 0;
      let succeeded = 0;
      let failed = 0;
      let skipped = 0;
      const failedNodeIds = new Set<string>();

      for (const node of sortedNodes) {
        if (cancelRef.current) {
          toast.info(`Run cancelled after ${processed}/${sortedNodes.length} nodes`);
          break;
        }

        const failedUpstreamNames = getFailedUpstreamNodeNames(
          node.id,
          currentEdges,
          sortedNodes,
          failedNodeIds,
        );

        if (failedUpstreamNames.length > 0) {
          skipped++;
          processed++;
          failedNodeIds.add(node.id);
          setNodeRunState(node.id, {
            run_status: 'error',
            run_error: `Skipped because upstream failed: ${failedUpstreamNames.join(', ')}`,
          });
          continue;
        }

        setNodeRunState(node.id, { run_status: 'running' });
        const runVerb = isDataSourceNode(node.data.thesisNode.node_type)
          ? 'Refreshing source'
          : 'Running node';
        toast.loading(
          `${runVerb} ${processed + 1}/${sortedNodes.length}: ${node.data.thesisNode.name}`,
          {
            id: 'run-all-progress',
          },
        );

        try {
          const { data, error } = await runNode({ nodeId: node.id });

          if (error || !data) {
            failed++;
            failedNodeIds.add(node.id);
            setNodeRunState(node.id, {
              run_status: 'error',
              run_error: error ?? 'Run failed',
            });
          } else {
            succeeded++;
            setNodeRunState(node.id, {
              run_status: 'success',
              output: data.output,
              run_error: null,
              last_run_at: data.lastRunAt,
              ...(data.summary ? { metadata: { summary: data.summary } } : {}),
            });
          }
        } catch (err) {
          failed++;
          failedNodeIds.add(node.id);
          setNodeRunState(node.id, {
            run_status: 'error',
            run_error: err instanceof Error ? err.message : 'Run failed',
          });
        }

        processed++;
      }

      if (!cancelRef.current) {
        if (failed === 0 && skipped === 0) {
          notifyRunCompletion({
            graphName: graph.name,
            nodeCount: succeeded,
            url: window.location.href,
          });
        } else {
          const skippedText = skipped > 0 ? `, ${skipped} skipped` : '';
          toast.warning(
            `${succeeded}/${processed} nodes succeeded, ${failed} failed${skippedText}`,
          );
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

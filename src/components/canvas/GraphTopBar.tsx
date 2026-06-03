'use client';

import { Fragment, useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Play,
  Loader2,
  LayoutGrid,
  Download,
  Square,
  BrainCircuit,
  ChevronDown,
} from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { updateGraphModel, updateGraphName } from '@/actions/graph-actions';
import { useGraphStore, type CanvasNode } from '@/store/graph-store';
import { computeLayout } from '@/lib/layout/elk-layout';
import { exportGraph } from '@/lib/export/export-graph';
import { getRunAllInitialPlan, RUN_ALL_MAX_CONCURRENCY } from '@/lib/graph/run-all';
import { sortTopologically } from '@/lib/graph/topological-sort';
import { sortRunProgressItems, type RunProgressItem } from '@/lib/graph/run-progress';
import { notifyRunCompletion } from '@/lib/notifications/run-completion';
import { RunAllProgressToast } from '@/components/canvas/RunAllProgressToast';
import { cn } from '@/lib/utils';
import {
  AI_PROVIDER_OPTIONS,
  getAiModelOption,
  resolveAiModelSelection,
  type AiModelId,
  type AiProviderId,
} from '@/lib/ai/models';
import type {
  RunGraphNodeResult,
  RunGraphResponse,
  RunGraphStatusNode,
  RunGraphStreamEvent,
} from '@/types/run-graph';
import { RUN_GRAPH_STREAM_CONTENT_TYPE } from '@/types/run-graph';

const RUN_PROGRESS_TOAST_ID = 'run-all-progress';

type ProviderStatus = {
  provider: AiProviderId;
  connected: boolean;
};

type AiProviderStatusResponse = {
  configured: boolean;
  providers: ProviderStatus[];
  error?: string;
};

async function readAiProviderStatus(): Promise<AiProviderStatusResponse> {
  const response = await fetch('/api/integrations/ai-providers/status', {
    cache: 'no-store',
  });
  const data = (await response.json().catch(() => null)) as AiProviderStatusResponse | null;

  if (!response.ok || !data) {
    throw new Error(data?.error ?? 'Failed to load AI provider status');
  }

  return data;
}

function buildInitialProgressItems(
  nodes: CanvasNode[],
  runningNodeIds: string[],
  readyQueuedNodeIds: string[],
): RunProgressItem[] {
  const runningIds = new Set(runningNodeIds);
  const readyQueuedIds = new Set(readyQueuedNodeIds);

  return nodes.map((node) => ({
    nodeId: node.id,
    name: node.data.breakdownNode.name,
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
  const nodeNames = new Map(orderedNodes.map((node) => [node.id, node.data.breakdownNode.name]));

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

async function readRunGraphStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: RunGraphStreamEvent) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      onEvent(JSON.parse(trimmed) as RunGraphStreamEvent);
    }

    if (done) {
      break;
    }
  }

  const trailingLine = buffer.trim();
  if (trailingLine) {
    onEvent(JSON.parse(trailingLine) as RunGraphStreamEvent);
  }
}

interface GraphTopBarProps {
  graphId: string;
  initialName: string;
  initialLlmProvider: AiProviderId | null;
  initialLlmModel: AiModelId | null;
}

export function GraphTopBar({
  graphId,
  initialName,
  initialLlmProvider,
  initialLlmModel,
}: GraphTopBarProps) {
  const [name, setName] = useState(initialName);
  const [editing, setEditing] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [layouting, setLayouting] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [providerStatuses, setProviderStatuses] = useState<ProviderStatus[] | null>(null);
  const [providerStatusLoading, setProviderStatusLoading] = useState(true);
  const [providerStatusError, setProviderStatusError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<AiModelId>(
    resolveAiModelSelection({
      providerId: initialLlmProvider,
      modelId: initialLlmModel,
    }).modelId,
  );

  const { nodes, edges, graph, setNodeRunState, updateGraphData } = useGraphStore();
  const reactFlowInstance = useReactFlow();
  const activeRunIdRef = useRef<string | null>(null);
  const activeRunStartedAtRef = useRef<number | null>(null);
  const activeRunProgressNoteRef = useRef<string | undefined>(undefined);
  const activeProgressItemsRef = useRef<RunProgressItem[]>([]);
  const selectedModel = getAiModelOption(selectedModelId);

  const loadProviderStatuses = useCallback(async () => {
    setProviderStatusLoading(true);
    try {
      const result = await readAiProviderStatus();
      setProviderStatuses(result.providers);
      setProviderStatusError(result.error ?? null);
    } catch (err) {
      setProviderStatusError(
        err instanceof Error ? err.message : 'Failed to load AI provider status',
      );
    } finally {
      setProviderStatusLoading(false);
    }
  }, []);

  const connectedProviderIds = useMemo(() => {
    return new Set(
      (providerStatuses ?? [])
        .filter((status) => status.connected)
        .map((status) => status.provider),
    );
  }, [providerStatuses]);

  const selectableProviders = useMemo(() => {
    if (!providerStatuses) {
      return [];
    }

    return AI_PROVIDER_OPTIONS.filter((provider) => connectedProviderIds.has(provider.id));
  }, [connectedProviderIds, providerStatuses]);

  const selectedProviderAvailable =
    !providerStatuses || connectedProviderIds.has(selectedModel.provider);

  useEffect(() => {
    void loadProviderStatuses();
  }, [loadProviderStatuses]);

  useEffect(() => {
    setSelectedModelId(
      resolveAiModelSelection({
        providerId: initialLlmProvider,
        modelId: initialLlmModel,
      }).modelId,
    );
  }, [initialLlmModel, initialLlmProvider]);

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

  const handleModelSelect = useCallback(
    async (modelId: AiModelId) => {
      if (modelId === selectedModelId || runningAll) return;

      const previousModelId = selectedModelId;
      setSelectedModelId(modelId);
      setSavingModel(true);

      const { data, error } = await updateGraphModel(graphId, modelId);

      setSavingModel(false);
      if (error || !data) {
        setSelectedModelId(previousModelId);
        toast.error(error ?? 'Failed to save model');
        return;
      }

      updateGraphData(data);
    },
    [graphId, runningAll, selectedModelId, updateGraphData],
  );

  const handleRunAll = useCallback(async () => {
    if (!graph) return;
    const currentNodes = useGraphStore.getState().nodes;
    const currentEdges = useGraphStore.getState().edges;
    const runEdges = currentEdges.map((edge) => ({
      source: edge.data.breakdownEdge.source_node_id,
      target: edge.data.breakdownEdge.target_node_id,
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
    setCancelRequested(false);
    setRunningAll(true);

    const showProgressToast = (items: RunProgressItem[], note?: string) => {
      const progressNote = note ?? activeRunProgressNoteRef.current;
      activeProgressItemsRef.current = items;
      toast.custom(
        () => <RunAllProgressToast items={items} startedAt={startedAt} note={progressNote} />,
        {
          id: RUN_PROGRESS_TOAST_ID,
          duration: Infinity,
        },
      );
    };

    const statusByNodeId = new Map<string, RunGraphStatusNode>(
      currentNodes.map((node) => [
        node.id,
        {
          nodeId: node.id,
          name: node.data.breakdownNode.name,
          runStatus: node.data.breakdownNode.run_status,
          output: node.data.breakdownNode.output,
          summary: (node.data.breakdownNode.metadata as { summary?: string }).summary,
          lastRunAt: node.data.breakdownNode.last_run_at,
          error: node.data.breakdownNode.run_error,
        },
      ]),
    );

    const applyStatusNodes = (statusNodes: RunGraphStatusNode[]) => {
      for (const statusNode of statusNodes) {
        statusByNodeId.set(statusNode.nodeId, statusNode);
        setNodeRunState(statusNode.nodeId, {
          run_status: statusNode.runStatus,
          output: statusNode.output,
          run_error: statusNode.error,
          last_run_at: statusNode.lastRunAt,
          ...(statusNode.summary ? { metadata: { summary: statusNode.summary } } : {}),
        });
      }

      showProgressToast(buildLiveProgressItems([...statusByNodeId.values()], orderedNodeIds));
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
        headers: {
          Accept: RUN_GRAPH_STREAM_CONTENT_TYPE,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ runId }),
      });

      const response = await runRequest;
      if (!response.ok || !response.body) {
        const result = (await response.json().catch(() => null)) as RunGraphResponse | null;
        toast.error(result?.error ?? 'Failed to run graph');
        for (const node of currentNodes) {
          setNodeRunState(node.id, {
            run_status: 'error',
            run_error: result?.error ?? 'Run failed',
          });
        }
        return;
      }

      const streamResult: { data: RunGraphResponse['data']; error: string | null } = {
        data: null,
        error: null,
      };

      await readRunGraphStream(response.body, (event) => {
        if (activeRunIdRef.current !== runId) {
          return;
        }

        if (event.type === 'run-started') {
          applyStatusNodes(event.nodes);
          return;
        }

        if (event.type === 'node-started' || event.type === 'node-settled') {
          applyStatusNodes([event.node]);
          return;
        }

        if (event.type === 'run-completed') {
          streamResult.data = event.data;
          return;
        }

        streamResult.error = event.error;
      });

      const resultData = streamResult.data;
      if (streamResult.error || !resultData) {
        toast.error(streamResult.error ?? 'Failed to run graph');
        for (const node of currentNodes) {
          setNodeRunState(node.id, {
            run_status: 'error',
            run_error: streamResult.error ?? 'Run failed',
          });
        }
        return;
      }

      for (const nodeResult of resultData.results) {
        setNodeRunState(nodeResult.nodeId, {
          run_status: nodeResult.runStatus,
          output: nodeResult.output,
          run_error: nodeResult.error,
          last_run_at: nodeResult.lastRunAt,
          ...(nodeResult.summary ? { metadata: { summary: nodeResult.summary } } : {}),
        });
      }
      showProgressToast(buildResultProgressItems(resultData.results, orderedNodes));

      const { metrics } = resultData;
      if (resultData.cancelled) {
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
      toast.dismiss(RUN_PROGRESS_TOAST_ID);
      setCancelRequested(false);
      setRunningAll(false);
    }
  }, [graph, setNodeRunState]);

  const handleCancelRun = useCallback(() => {
    const runId = activeRunIdRef.current;
    if (!graph || !runId || cancelRequested) return;

    setCancelRequested(true);
    if (activeProgressItemsRef.current.length > 0) {
      const startedAt = activeRunStartedAtRef.current ?? Date.now();
      const cancelNote =
        'Cancel requested. In-flight nodes will finish; queued nodes will not start.';
      activeRunProgressNoteRef.current = cancelNote;
      toast.custom(
        () => (
          <RunAllProgressToast
            items={activeProgressItemsRef.current}
            startedAt={startedAt}
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
    })
      .then(async (response) => {
        if (!response.ok) {
          const result = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(result?.error ?? 'Failed to cancel run');
        }
      })
      .catch((err) => {
        toast.error(err instanceof Error ? err.message : 'Failed to cancel run');
        if (activeRunIdRef.current !== runId) {
          return;
        }

        setCancelRequested(false);
        activeRunProgressNoteRef.current = undefined;
        if (activeProgressItemsRef.current.length > 0) {
          const startedAt = activeRunStartedAtRef.current ?? Date.now();
          toast.custom(
            () => (
              <RunAllProgressToast items={activeProgressItemsRef.current} startedAt={startedAt} />
            ),
            {
              id: RUN_PROGRESS_TOAST_ID,
              duration: Infinity,
            },
          );
        }
      });
  }, [cancelRequested, graph]);

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

      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            void loadProviderStatuses();
          }
        }}
      >
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'min-w-[6.75rem] justify-start',
          )}
          disabled={runningAll || savingModel}
          title="AI model"
        >
          {savingModel ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <BrainCircuit className="size-3.5" />
          )}
          <span className={cn(!selectedProviderAvailable && 'text-muted-foreground')}>
            {selectedModel.label}
          </span>
          <ChevronDown className="ml-auto size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {providerStatusLoading && !providerStatuses ? (
            <DropdownMenuItem disabled>Loading providers...</DropdownMenuItem>
          ) : providerStatusError ? (
            <DropdownMenuItem disabled>{providerStatusError}</DropdownMenuItem>
          ) : selectableProviders.length === 0 ? (
            <DropdownMenuItem disabled>Add a provider key in Settings</DropdownMenuItem>
          ) : (
            <DropdownMenuRadioGroup
              value={selectedModelId}
              disabled={runningAll || savingModel}
              onValueChange={(value) => void handleModelSelect(value as AiModelId)}
            >
              {selectableProviders.map((provider) => (
                <Fragment key={provider.id}>
                  <DropdownMenuRadioItem
                    value={`provider-${provider.id}`}
                    disabled
                    className="opacity-100 [&_[data-slot=dropdown-menu-radio-item-indicator]]:hidden"
                  >
                    <span className="text-xs font-medium text-muted-foreground">
                      {provider.label}
                    </span>
                  </DropdownMenuRadioItem>
                  {provider.models.map((option) => (
                    <DropdownMenuRadioItem key={option.id} value={option.id} closeOnClick>
                      {option.label}
                    </DropdownMenuRadioItem>
                  ))}
                </Fragment>
              ))}
            </DropdownMenuRadioGroup>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {runningAll ? (
        <Button
          size="sm"
          variant="destructive"
          onClick={handleCancelRun}
          disabled={cancelRequested}
        >
          {cancelRequested ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Square className="size-3.5" />
          )}
          {cancelRequested ? 'Canceling...' : 'Cancel'}
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

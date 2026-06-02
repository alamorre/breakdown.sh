'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { toast } from 'sonner';
import {
  Play,
  Loader2,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  Save,
  ExternalLink,
  Maximize2,
  ChevronDown,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useGraphStore, type CanvasNode, type CanvasEdge } from '@/store/graph-store';
import { updateNode, deleteNode, runNode } from '@/actions/node-actions';
import type { ThesisNode } from '@/types/node';
import { EDGE_TYPE_CONFIG, type EdgeType } from '@/types/edge';
import { cn } from '@/lib/utils';
import {
  isDataSourceNode,
  getDataSourceType,
  DATA_SOURCE_LABELS,
  isGoogleDriveSourceConfig,
} from '@/types/data-source';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={handleCopy}
      title={copied ? 'Copied' : 'Copy output'}
      aria-label={copied ? 'Copied' : 'Copy output'}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  );
}

interface OutputContentProps {
  output: string | null;
  isRunning: boolean;
  isQueued: boolean;
  isBlocked: boolean;
  runError: string | null;
  loadingLabel: string;
  emptyLabel: string;
  className?: string;
}

function OutputContent({
  output,
  isRunning,
  isQueued,
  isBlocked,
  runError,
  loadingLabel,
  emptyLabel,
  className,
}: OutputContentProps) {
  if (isRunning) {
    return <p className="text-sm text-muted-foreground">{loadingLabel}</p>;
  }

  if (isQueued) {
    return <p className="text-sm text-muted-foreground">{runError ?? 'Queued for Run All'}</p>;
  }

  if (isBlocked) {
    return <p className="text-sm text-destructive">{runError ?? 'Error'}</p>;
  }

  if (!output) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none prose-headings:font-semibold prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-hr:my-3 prose-pre:overflow-x-auto [&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_th]:border [&_th]:border-border [&_th]:bg-muted/70 [&_th]:px-2 [&_th]:py-1.5',
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{output}</ReactMarkdown>
    </div>
  );
}

interface NodeFormProps {
  thesisNode: ThesisNode;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string;
  updateNodeData: (nodeId: string, updates: Partial<ThesisNode>) => void;
  setNodeRunState: (
    nodeId: string,
    state: {
      run_status: ThesisNode['run_status'];
      output?: string | null;
      run_error?: string | null;
      last_run_at?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) => void;
  removeNode: (nodeId: string) => void;
}

function NodeForm({
  thesisNode,
  nodes,
  edges,
  selectedNodeId,
  updateNodeData,
  setNodeRunState,
  removeNode,
}: NodeFormProps) {
  const isSource = isDataSourceNode(thesisNode.node_type);
  const sourceType = getDataSourceType(thesisNode.node_type);
  const driveMetadata = isGoogleDriveSourceConfig(thesisNode.metadata) ? thesisNode.metadata : null;
  const pathname = usePathname();

  const [name, setName] = useState(thesisNode.name);
  const [prompt, setPrompt] = useState(thesisNode.prompt);
  const [sourceUrl, setSourceUrl] = useState(
    driveMetadata?.webViewLink ?? (thesisNode.metadata as { url?: string })?.url ?? '',
  );
  const [sheetName, setSheetName] = useState(
    (thesisNode.metadata as { sheetName?: string })?.sheetName ?? '',
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [outputDialogOpen, setOutputDialogOpen] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(!thesisNode.output);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when store changes from outside (e.g. card edits)
  const storeName = thesisNode.name;
  const storePrompt = thesisNode.prompt;
  const storeUrl =
    (isGoogleDriveSourceConfig(thesisNode.metadata)
      ? thesisNode.metadata.webViewLink
      : (thesisNode.metadata as { url?: string })?.url) ?? '';
  const storeSheetName = (thesisNode.metadata as { sheetName?: string })?.sheetName ?? '';
  useEffect(() => {
    setName(storeName);
  }, [storeName]);
  useEffect(() => {
    setPrompt(storePrompt);
  }, [storePrompt]);
  useEffect(() => {
    setSourceUrl(storeUrl);
  }, [storeUrl]);
  useEffect(() => {
    setSheetName(storeSheetName);
  }, [storeSheetName]);
  useEffect(() => {
    setSecondaryOpen(!thesisNode.output);
  }, [selectedNodeId, thesisNode.output]);

  const debouncedSave = useCallback(
    (
      updates: Partial<Pick<ThesisNode, 'name' | 'prompt'>> & {
        metadata?: Record<string, unknown>;
      },
    ) => {
      const { metadata, ...nodeUpdates } = updates;
      if (metadata) {
        updateNodeData(selectedNodeId, { metadata });
      }
      if (Object.keys(nodeUpdates).length > 0) {
        updateNodeData(selectedNodeId, nodeUpdates);
      }

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        const { error } = await updateNode({
          nodeId: selectedNodeId,
          ...nodeUpdates,
          ...(metadata ? { metadata } : {}),
        });
        if (error) {
          toast.error('Failed to save changes');
        }
      }, 500);
    },
    [selectedNodeId, updateNodeData],
  );

  const handleNameChange = (value: string) => {
    setName(value);
    debouncedSave({ name: value });
  };

  const handlePromptChange = (value: string) => {
    setPrompt(value);
    debouncedSave({ prompt: value });
  };

  const handleSourceUrlChange = (value: string) => {
    setSourceUrl(value);
    const newMetadata = { ...thesisNode.metadata, url: value };
    debouncedSave({ metadata: newMetadata });
  };

  const handleSheetNameChange = (value: string) => {
    setSheetName(value);
    const newMetadata = { ...thesisNode.metadata, sheetName: value || undefined };
    debouncedSave({ metadata: newMetadata });
  };

  const handleRun = async () => {
    setNodeRunState(selectedNodeId, { run_status: 'running' });

    const { data: result, error } = await runNode({ nodeId: selectedNodeId });

    if (error || !result) {
      setNodeRunState(selectedNodeId, {
        run_status: 'error',
        run_error: error ?? 'Run failed',
      });
      toast.error(error ?? 'Run failed');
    } else {
      setNodeRunState(selectedNodeId, {
        run_status: 'success',
        output: result.output,
        run_error: null,
        last_run_at: result.lastRunAt,
        ...(result.metadata || result.summary
          ? {
              metadata: {
                ...(result.metadata ?? {}),
                ...(result.summary ? { summary: result.summary } : {}),
              },
            }
          : {}),
      });
    }
  };

  const handleDelete = async () => {
    const { error } = await deleteNode({ nodeId: selectedNodeId });
    if (error) {
      toast.error('Failed to delete node');
      return;
    }
    removeNode(selectedNodeId);
    setDeleteConfirmOpen(false);
  };

  const upstreamEdges = edges.filter((e) => e.data.thesisEdge.target_node_id === selectedNodeId);
  const downstreamEdges = edges.filter((e) => e.data.thesisEdge.source_node_id === selectedNodeId);

  const getNodeName = (nodeId: string): string => {
    const node = nodes.find((n) => n.id === nodeId);
    return node?.data.thesisNode.name ?? 'Unknown';
  };

  const isRunning = thesisNode.run_status === 'running';
  const isQueued = thesisNode.run_status === 'queued';
  const isSkipped = thesisNode.run_status === 'skipped';
  const isCancelled = thesisNode.run_status === 'cancelled';
  const isBlocked = thesisNode.run_status === 'error' || isSkipped || isCancelled;
  const needsReconnect =
    Boolean(driveMetadata) &&
    isBlocked &&
    (thesisNode.run_error ?? '').includes('Reconnect Google Drive');
  const connectHref = `/api/integrations/google-drive/connect?returnTo=${encodeURIComponent(pathname)}`;

  const statusVariant =
    thesisNode.run_status === 'success'
      ? 'default'
      : thesisNode.run_status === 'error'
        ? 'destructive'
        : 'secondary';
  const outputLabel = isSource ? 'Fetched Content' : 'Output';
  const loadingLabel =
    isSource && sourceType === 'text' ? 'Saving...' : isSource ? 'Fetching...' : 'Running...';
  const emptyLabel =
    isSource && sourceType === 'text'
      ? 'Not yet saved'
      : isSource
        ? 'Not yet fetched'
        : 'Not yet run';
  const runActionLabel = isSource && sourceType === 'text' ? 'Save' : isSource ? 'Refresh' : 'Run';
  const runTimestampLabel =
    isSource && sourceType === 'text' ? 'Last saved' : isSource ? 'Last fetched' : 'Last run';
  const canCopyOutput = Boolean(thesisNode.output) && !isRunning && !isQueued && !isBlocked;
  const secondarySectionLabel = isSource ? 'Source' : 'Prompt';

  return (
    <>
      <SheetHeader className="sr-only">
        <SheetTitle>{name}</SheetTitle>
        <SheetDescription>
          Edit {isSource && sourceType ? DATA_SOURCE_LABELS[sourceType] : 'node'} details
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-4 px-4 pb-4">
        <div className="space-y-1.5">
          <Label htmlFor="node-name">Name</Label>
          <Input id="node-name" value={name} onChange={(e) => handleNameChange(e.target.value)} />
        </div>

        <section className="rounded-lg border bg-background p-3 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Label>{outputLabel}</Label>
                <Badge variant={statusVariant}>{thesisNode.run_status}</Badge>
              </div>
              {thesisNode.last_run_at && (
                <p className="text-xs text-muted-foreground">
                  {runTimestampLabel}: {new Date(thesisNode.last_run_at).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1">
              {canCopyOutput && <CopyButton text={thesisNode.output ?? ''} />}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setOutputDialogOpen(true)}
                title="Open focused output"
                aria-label="Open focused output"
              >
                <Maximize2 className="size-3.5" />
              </Button>
            </div>
          </div>

          <ScrollArea className="mt-3 h-[clamp(320px,62vh,760px)] rounded-lg border bg-muted/30">
            <div className="p-4">
              <OutputContent
                output={thesisNode.output}
                isRunning={isRunning}
                isQueued={isQueued}
                isBlocked={isBlocked}
                runError={thesisNode.run_error}
                loadingLabel={loadingLabel}
                emptyLabel={emptyLabel}
              />
            </div>
          </ScrollArea>

          <div className="mt-3 flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-end">
            {needsReconnect ? (
              <a className={cn(buttonVariants(), 'w-full sm:w-auto')} href={connectHref}>
                Reconnect Google Drive
              </a>
            ) : (
              <Button
                onClick={handleRun}
                disabled={isRunning || isQueued}
                className="w-full sm:w-auto"
              >
                {isRunning ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : isSource && sourceType === 'text' ? (
                  <Save className="size-4" />
                ) : isSource ? (
                  <RefreshCw className="size-4" />
                ) : (
                  <Play className="size-4" />
                )}
                {runActionLabel}
              </Button>
            )}
          </div>
        </section>

        <details
          open={secondaryOpen}
          onToggle={(event) => setSecondaryOpen(event.currentTarget.open)}
          className="group rounded-lg border bg-muted/20 p-3"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
            <span>{secondarySectionLabel}</span>
            <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="mt-3 space-y-3">
            {isSource && sourceType === 'text' ? (
              <div className="space-y-1.5">
                <Label htmlFor="node-prompt">Content</Label>
                <Textarea
                  id="node-prompt"
                  value={prompt}
                  onChange={(e) => handlePromptChange(e.target.value)}
                  placeholder="Paste or type your text here..."
                  rows={10}
                />
              </div>
            ) : isSource && driveMetadata ? (
              <div className="space-y-3 rounded-lg border bg-background p-3 text-sm">
                <div className="grid gap-1.5">
                  <Label>Drive File</Label>
                  <div className="font-medium">{driveMetadata.fileName}</div>
                  <div className="text-muted-foreground">
                    {DATA_SOURCE_LABELS[sourceType ?? 'web-url']}
                  </div>
                </div>
                <div className="grid gap-1.5 text-muted-foreground">
                  <div>
                    Account: <span className="text-foreground">{driveMetadata.accountEmail}</span>
                  </div>
                  {driveMetadata.lastKnownModifiedTime && (
                    <div>
                      Last modified:{' '}
                      <span className="text-foreground">
                        {new Date(driveMetadata.lastKnownModifiedTime).toLocaleString()}
                      </span>
                    </div>
                  )}
                  <div>
                    Export: <span className="text-foreground">{driveMetadata.exportMimeType}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={driveMetadata.webViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  >
                    <ExternalLink className="size-3.5" />
                    Open in Drive
                  </a>
                </div>
              </div>
            ) : isSource ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="source-url">Source URL</Label>
                  <Input
                    id="source-url"
                    value={sourceUrl}
                    onChange={(e) => handleSourceUrlChange(e.target.value)}
                    placeholder="Paste URL here..."
                  />
                </div>
                {sourceType === 'google-sheet' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="sheet-name">Sheet Name (optional)</Label>
                    <Input
                      id="sheet-name"
                      value={sheetName}
                      onChange={(e) => handleSheetNameChange(e.target.value)}
                      placeholder="e.g. Sheet1"
                    />
                  </div>
                )}
              </>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="node-prompt">Prompt</Label>
                <Textarea
                  id="node-prompt"
                  value={prompt}
                  onChange={(e) => handlePromptChange(e.target.value)}
                  placeholder="Write your task or prompt..."
                  rows={8}
                />
              </div>
            )}
          </div>
        </details>

        {(upstreamEdges.length > 0 || downstreamEdges.length > 0) && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label>Connections</Label>
              {upstreamEdges.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Upstream (inputs)
                  </p>
                  {upstreamEdges.map((e) => {
                    const edgeConfig = EDGE_TYPE_CONFIG[e.data.thesisEdge.edge_type as EdgeType];
                    return (
                      <div
                        key={e.id}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <div
                          className="h-0.5 w-3 rounded-full"
                          style={{ backgroundColor: edgeConfig?.color }}
                        />
                        <span>{getNodeName(e.data.thesisEdge.source_node_id)}</span>
                        <Badge variant="outline" className="h-4 text-[10px]">
                          {edgeConfig?.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
              {downstreamEdges.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Downstream (outputs)
                  </p>
                  {downstreamEdges.map((e) => {
                    const edgeConfig = EDGE_TYPE_CONFIG[e.data.thesisEdge.edge_type as EdgeType];
                    return (
                      <div
                        key={e.id}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <div
                          className="h-0.5 w-3 rounded-full"
                          style={{ backgroundColor: edgeConfig?.color }}
                        />
                        <span>{getNodeName(e.data.thesisEdge.target_node_id)}</span>
                        <Badge variant="outline" className="h-4 text-[10px]">
                          {edgeConfig?.label}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        <Separator />

        <div className="space-y-1 text-xs text-muted-foreground">
          <p>Created: {new Date(thesisNode.created_at).toLocaleDateString()}</p>
        </div>

        <Button
          variant="destructive"
          size="sm"
          className="mt-2"
          onClick={() => setDeleteConfirmOpen(true)}
        >
          <Trash2 className="size-3.5" />
          Delete Node
        </Button>
      </div>

      <Dialog open={outputDialogOpen} onOpenChange={setOutputDialogOpen}>
        <DialogContent className="flex h-[min(92vh,920px)] w-[min(96vw,1280px)] max-w-none flex-col gap-0 p-0 sm:max-w-none">
          <DialogHeader className="border-b p-4 pr-12">
            <DialogTitle>{outputLabel}</DialogTitle>
            <DialogDescription>{name}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="p-5 sm:p-6">
              <OutputContent
                output={thesisNode.output}
                isRunning={isRunning}
                isQueued={isQueued}
                isBlocked={isBlocked}
                runError={thesisNode.run_error}
                loadingLabel={loadingLabel}
                emptyLabel={emptyLabel}
                className="prose-headings:text-lg prose-h1:text-2xl"
              />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Node</DialogTitle>
            <DialogDescription>
              This will permanently delete &ldquo;{thesisNode.name}&rdquo; and all its connections.
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const MIN_WIDTH = 480;
const MAX_WIDTH = 1200;
const DEFAULT_WIDTH = 760;
const STORAGE_KEY = 'thesis-detail-panel-width-v2';

function getStoredWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH;
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return DEFAULT_WIDTH;
  const parsed = Number(stored);
  if (Number.isNaN(parsed) || parsed < MIN_WIDTH || parsed > MAX_WIDTH) return DEFAULT_WIDTH;
  return parsed;
}

export function NodeDetailPanel() {
  const { nodes, edges, selectedNodeId, selectNode, updateNodeData, setNodeRunState, removeNode } =
    useGraphStore();

  const [panelWidth, setPanelWidth] = useState(DEFAULT_WIDTH);
  const isDragging = useRef(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setPanelWidth(getStoredWidth());
    });

    return () => window.cancelAnimationFrame(frame);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = window.innerWidth - moveEvent.clientX;
      setPanelWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)));
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Persist final width
      setPanelWidth((w) => {
        localStorage.setItem(STORAGE_KEY, String(w));
        return w;
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const thesisNode = selectedNode?.data.thesisNode ?? null;

  return (
    <Sheet
      open={selectedNodeId !== null && thesisNode !== null}
      onOpenChange={(open) => {
        if (!open) selectNode(null);
      }}
    >
      <SheetContent
        side="right"
        className="overflow-y-auto"
        style={{ width: `min(100vw, ${panelWidth}px)`, maxWidth: `min(100vw, ${panelWidth}px)` }}
      >
        {/* Drag handle on left edge */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute inset-y-0 left-0 z-50 hidden w-1.5 cursor-col-resize transition-colors hover:bg-primary/10 active:bg-primary/20 sm:block"
        />
        {thesisNode && selectedNodeId && (
          <NodeForm
            key={selectedNodeId}
            thesisNode={thesisNode}
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNodeId}
            updateNodeData={updateNodeData}
            setNodeRunState={setNodeRunState}
            removeNode={removeNode}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

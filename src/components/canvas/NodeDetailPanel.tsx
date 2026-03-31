'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Play, Loader2, Trash2, RefreshCw, Copy, Check, Save } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
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
import { isDataSourceNode, getDataSourceType, DATA_SOURCE_LABELS } from '@/types/data-source';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button variant="ghost" size="icon-sm" onClick={handleCopy}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
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

  const [name, setName] = useState(thesisNode.name);
  const [prompt, setPrompt] = useState(thesisNode.prompt);
  const [sourceUrl, setSourceUrl] = useState((thesisNode.metadata as { url?: string })?.url ?? '');
  const [sheetName, setSheetName] = useState(
    (thesisNode.metadata as { sheetName?: string })?.sheetName ?? '',
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when store changes from outside (e.g. card edits)
  const storeName = thesisNode.name;
  const storePrompt = thesisNode.prompt;
  const storeUrl = (thesisNode.metadata as { url?: string })?.url ?? '';
  const storeSheetName = (thesisNode.metadata as { sheetName?: string })?.sheetName ?? '';
  useEffect(() => { setName(storeName); }, [storeName]);
  useEffect(() => { setPrompt(storePrompt); }, [storePrompt]);
  useEffect(() => { setSourceUrl(storeUrl); }, [storeUrl]);
  useEffect(() => { setSheetName(storeSheetName); }, [storeSheetName]);

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
        last_run_at: new Date().toISOString(),
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

  const statusVariant =
    thesisNode.run_status === 'success'
      ? 'default'
      : thesisNode.run_status === 'error'
        ? 'destructive'
        : 'secondary';

  return (
    <>
      <SheetHeader>
        <SheetTitle className="sr-only">{name}</SheetTitle>
        <SheetDescription className="sr-only">
          Edit {isSource && sourceType ? DATA_SOURCE_LABELS[sourceType] : 'node'} details
        </SheetDescription>
      </SheetHeader>

      <div className="flex flex-col gap-5 px-4 pb-4">
        <div className="space-y-1.5">
          <Label htmlFor="node-name">Name</Label>
          <Input id="node-name" value={name} onChange={(e) => handleNameChange(e.target.value)} />
        </div>

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

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{isSource ? 'Fetched Content' : 'Output'}</Label>
            {thesisNode.output && !isRunning && thesisNode.run_status !== 'error' && (
              <CopyButton text={thesisNode.output} />
            )}
          </div>
          <ScrollArea className="h-80 rounded-lg border bg-muted/50 p-3">
            {isRunning && (
              <p className="text-sm text-muted-foreground">
                {isSource && sourceType === 'text' ? 'Saving...' : isSource ? 'Fetching...' : 'Running...'}
              </p>
            )}
            {thesisNode.run_status === 'error' && (
              <p className="text-sm text-destructive">{thesisNode.run_error ?? 'Error'}</p>
            )}
            {!isRunning && thesisNode.run_status !== 'error' && thesisNode.output && (
              <div className="prose prose-sm dark:prose-invert max-w-none prose-headings:text-base prose-headings:font-semibold prose-h1:text-lg prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-hr:my-3">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {thesisNode.output}
                </ReactMarkdown>
              </div>
            )}
            {!isRunning && thesisNode.run_status !== 'error' && !thesisNode.output && (
              <p className="text-sm text-muted-foreground">
                {isSource && sourceType === 'text' ? 'Not yet saved' : isSource ? 'Not yet fetched' : 'Not yet run'}
              </p>
            )}
          </ScrollArea>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={statusVariant}>{thesisNode.run_status}</Badge>
          {thesisNode.last_run_at && (
            <span className="text-xs text-muted-foreground">
              {isSource && sourceType === 'text' ? 'Last saved' : isSource ? 'Last fetched' : 'Last run'}:{' '}
              {new Date(thesisNode.last_run_at).toLocaleString()}
            </span>
          )}
        </div>

        <Button onClick={handleRun} disabled={isRunning}>
          {isRunning ? (
            <Loader2 className="size-4 animate-spin" />
          ) : isSource && sourceType === 'text' ? (
            <Save className="size-4" />
          ) : isSource ? (
            <RefreshCw className="size-4" />
          ) : (
            <Play className="size-4" />
          )}
          {isSource && sourceType === 'text' ? 'Save' : isSource ? 'Fetch' : 'Run'}
        </Button>

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
const DEFAULT_WIDTH = 640;
const STORAGE_KEY = 'thesis-detail-panel-width';

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

  // Hydrate from localStorage on mount
  useEffect(() => {
    setPanelWidth(getStoredWidth());
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
        style={{ width: panelWidth, maxWidth: panelWidth }}
      >
        {/* Drag handle on left edge */}
        <div
          onMouseDown={handleMouseDown}
          className="absolute inset-y-0 left-0 z-50 w-1.5 cursor-col-resize transition-colors hover:bg-primary/10 active:bg-primary/20"
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

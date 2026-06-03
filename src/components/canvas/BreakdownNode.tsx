'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Play,
  Loader2,
  MoreHorizontal,
  Trash2,
  RefreshCw,
  Globe,
  ExternalLink,
  Check,
  CircleDashed,
  AlertCircle,
  TextIcon,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { useGraphStore, type CanvasNode } from '@/store/graph-store';
import { updateNode, runNode } from '@/actions/node-actions';
import { deleteNode } from '@/actions/node-actions';
import {
  isDataSourceNode,
  getDataSourceType,
  isGoogleDriveSourceConfig,
} from '@/types/data-source';
import type { DataSourceType } from '@/types/data-source';
import {
  GoogleDocsIcon,
  GoogleSheetsIcon,
  GoogleSlidesIcon,
} from '@/components/canvas/google-icons';

function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    return '';
  }
}

function formatTimeAgo(isoDate: string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

const SOURCE_TYPE_LABELS: Record<DataSourceType, string> = {
  'web-url': 'Web',
  'google-doc': 'Google Docs',
  'google-sheet': 'Google Sheets',
  'google-presentation': 'Google Slides',
  text: 'Text',
};

function BreakdownNodeComponent({ data, selected }: NodeProps<CanvasNode>) {
  const { breakdownNode } = data;
  const { updateNodeData, setNodeRunState, removeNode } = useGraphStore();

  const isSource = isDataSourceNode(breakdownNode.node_type);
  const sourceType = getDataSourceType(breakdownNode.node_type);
  const driveMetadata = isGoogleDriveSourceConfig(breakdownNode.metadata)
    ? breakdownNode.metadata
    : null;

  const [prompt, setPrompt] = useState(breakdownNode.prompt);
  const [sourceUrl, setSourceUrl] = useState(
    driveMetadata?.webViewLink ?? (breakdownNode.metadata as { url?: string })?.url ?? '',
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [urlEditing, setUrlEditing] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when store changes from outside (e.g. detail panel edits)
  const storePrompt = breakdownNode.prompt;
  const storeUrl =
    (isGoogleDriveSourceConfig(breakdownNode.metadata)
      ? breakdownNode.metadata.webViewLink
      : (breakdownNode.metadata as { url?: string })?.url) ?? '';
  useEffect(() => {
    setPrompt(storePrompt);
  }, [storePrompt]);
  useEffect(() => {
    setSourceUrl(storeUrl);
  }, [storeUrl]);

  const handlePromptChange = useCallback(
    (value: string) => {
      setPrompt(value);
      updateNodeData(breakdownNode.id, { prompt: value });

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        const { error } = await updateNode({
          nodeId: breakdownNode.id,
          prompt: value,
        });
        if (error) {
          toast.error('Failed to save prompt');
        }
      }, 500);
    },
    [breakdownNode.id, updateNodeData],
  );

  const handleSourceUrlChange = useCallback(
    (value: string) => {
      setSourceUrl(value);
      const newMetadata = { ...breakdownNode.metadata, url: value };
      updateNodeData(breakdownNode.id, { metadata: newMetadata });

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        const { error } = await updateNode({
          nodeId: breakdownNode.id,
          metadata: newMetadata,
        });
        if (error) {
          toast.error('Failed to save URL');
        }
      }, 500);
    },
    [breakdownNode.id, breakdownNode.metadata, updateNodeData],
  );

  const handleRun = useCallback(async () => {
    setNodeRunState(breakdownNode.id, { run_status: 'running' });

    const { data: result, error } = await runNode({ nodeId: breakdownNode.id });

    if (error || !result) {
      setNodeRunState(breakdownNode.id, {
        run_status: 'error',
        run_error: error ?? 'Run failed',
      });
      toast.error(error ?? 'Run failed');
    } else {
      setNodeRunState(breakdownNode.id, {
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
  }, [breakdownNode.id, setNodeRunState]);

  const handleDelete = useCallback(async () => {
    const { error } = await deleteNode({ nodeId: breakdownNode.id });
    if (error) {
      toast.error('Failed to delete node');
      return;
    }
    removeNode(breakdownNode.id);
    setDeleteConfirmOpen(false);
  }, [breakdownNode.id, removeNode]);

  const isRunning = breakdownNode.run_status === 'running';
  const isQueued = breakdownNode.run_status === 'queued';
  const isError = breakdownNode.run_status === 'error';
  const isSkipped = breakdownNode.run_status === 'skipped';
  const isCancelled = breakdownNode.run_status === 'cancelled';
  const isBlocked = isError || isSkipped || isCancelled;
  const isFetched = breakdownNode.run_status === 'success' && breakdownNode.output;

  // --- Text Source Node ---
  if (isSource && sourceType === 'text') {
    const isTextSaved = breakdownNode.run_status === 'success' && breakdownNode.output;
    const hasUnsavedChanges = prompt !== (breakdownNode.output ?? '');

    return (
      <>
        <div
          className={cn(
            'w-72 rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md',
            selected && 'ring-2 ring-ring',
            isBlocked && 'border-destructive/40',
          )}
        >
          <Handle
            type="target"
            position={Position.Top}
            className="!h-3 !w-3 !border-2 !border-background !bg-primary"
          />

          <div className="p-4">
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <TextIcon className="size-4 text-muted-foreground" />
                </div>
                <span className="text-xs font-medium text-muted-foreground">Text</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger className="nodrag -mr-1 -mt-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground">
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <h3 className="mb-2 truncate text-sm font-semibold leading-tight">
              {breakdownNode.name}
            </h3>

            <Textarea
              value={prompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              placeholder="Paste or type text here..."
              className="nodrag nopan nowheel mb-2 max-h-32 min-h-[64px] resize-y text-xs"
              rows={3}
            />

            <div className="flex items-center gap-1.5 text-xs">
              {isQueued && (
                <>
                  <CircleDashed className="size-3 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">Queued</span>
                </>
              )}
              {isBlocked && (
                <>
                  <AlertCircle className="size-3 text-destructive" />
                  <span className="truncate text-destructive">
                    {breakdownNode.run_error ?? 'Error'}
                  </span>
                </>
              )}
              {isTextSaved && !hasUnsavedChanges && !isQueued && !isBlocked && (
                <>
                  <Check className="size-3 text-emerald-500" />
                  <span className="text-muted-foreground">Saved</span>
                  {breakdownNode.last_run_at && (
                    <span className="text-muted-foreground/60">
                      {formatTimeAgo(breakdownNode.last_run_at)}
                    </span>
                  )}
                </>
              )}
              {hasUnsavedChanges && prompt && !isQueued && !isBlocked && (
                <>
                  <CircleDashed className="size-3 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">Unsaved changes</span>
                </>
              )}
              {!isQueued && !isBlocked && !prompt && (
                <>
                  <CircleDashed className="size-3 text-muted-foreground/50" />
                  <span className="text-muted-foreground/60">No content</span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end border-t px-3 py-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRun}
              disabled={isRunning || isQueued || !prompt}
              className="nodrag h-7 gap-1.5 text-xs"
            >
              {isRunning ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Save className="size-3" />
              )}
              Save
            </Button>
          </div>

          <Handle
            type="source"
            position={Position.Bottom}
            className="!h-3 !w-3 !border-2 !border-background !bg-primary"
          />
        </div>

        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent className="nodrag nopan">
            <DialogHeader>
              <DialogTitle>Delete Node</DialogTitle>
              <DialogDescription>
                This will permanently delete &ldquo;{breakdownNode.name}&rdquo; and all its
                connections. This action cannot be undone.
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

  // --- Data Source Node (compact file card) ---
  if (isSource && sourceType) {
    const domain = extractDomain(sourceUrl);
    const isGoogle =
      sourceType === 'google-doc' ||
      sourceType === 'google-sheet' ||
      sourceType === 'google-presentation';
    const typeLabel = SOURCE_TYPE_LABELS[sourceType];
    const needsReconnect =
      Boolean(driveMetadata) &&
      isBlocked &&
      (breakdownNode.run_error ?? '').includes('Reconnect Google Drive');
    const returnTo = typeof window === 'undefined' ? '/dashboard' : window.location.pathname;
    const connectHref = `/api/integrations/google-drive/connect?returnTo=${encodeURIComponent(returnTo)}`;

    return (
      <>
        <div
          className={cn(
            'w-64 rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md',
            selected && 'ring-2 ring-ring',
            isBlocked && 'border-destructive/40',
            isRunning && 'border-primary/40',
            isQueued && 'border-amber-400/50',
          )}
        >
          <Handle
            type="target"
            position={Position.Top}
            className="!h-3 !w-3 !border-2 !border-background !bg-primary"
          />

          {/* File card content */}
          <div className="p-4">
            {/* Icon + type label */}
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                {sourceType === 'google-doc' && <GoogleDocsIcon className="size-8 shrink-0" />}
                {sourceType === 'google-sheet' && <GoogleSheetsIcon className="size-8 shrink-0" />}
                {sourceType === 'google-presentation' && (
                  <GoogleSlidesIcon className="size-8 shrink-0" />
                )}
                {sourceType === 'web-url' &&
                  (domain ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- Dynamic favicons are tiny third-party assets with a local fallback. */}
                      <img
                        src={`https://www.google.com/s2/favicons?domain=${domain}&sz=64`}
                        alt=""
                        className="size-8 shrink-0 rounded-lg"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          (
                            e.currentTarget.nextElementSibling as HTMLElement | null
                          )?.classList.remove('hidden');
                        }}
                      />
                      <div className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Globe className="size-4 text-muted-foreground" />
                      </div>
                    </>
                  ) : (
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Globe className="size-4 text-muted-foreground" />
                    </div>
                  ))}
                <span className="text-xs font-medium text-muted-foreground">{typeLabel}</span>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger className="nodrag -mr-1 -mt-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground">
                  <MoreHorizontal className="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    <Trash2 className="size-3.5" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* File name */}
            <h3 className="mb-1 truncate text-sm font-semibold leading-tight">
              {breakdownNode.name}
            </h3>

            {/* Domain, URL, or connected account hint */}
            {(domain || driveMetadata?.accountEmail) && !urlEditing && (
              <button
                type="button"
                onClick={() => {
                  if (!driveMetadata) setUrlEditing(true);
                }}
                className="nodrag mb-3 flex items-center gap-1 truncate text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {isGoogle ? (
                  <ExternalLink className="size-3 shrink-0" />
                ) : (
                  <Globe className="size-3 shrink-0" />
                )}
                <span className="truncate">{driveMetadata?.accountEmail ?? domain}</span>
              </button>
            )}

            {/* URL input — shown when no URL set or when editing */}
            {!driveMetadata && (!sourceUrl || urlEditing) && (
              <Input
                value={sourceUrl}
                onChange={(e) => handleSourceUrlChange(e.target.value)}
                onBlur={() => {
                  if (sourceUrl) setUrlEditing(false);
                }}
                placeholder="Paste URL here..."
                className="nodrag nopan nowheel mb-3 h-8 text-xs"
                autoFocus={urlEditing}
              />
            )}

            {/* Status line */}
            <div className="flex items-center gap-1.5 text-xs">
              {isQueued && (
                <>
                  <CircleDashed className="size-3 text-amber-500" />
                  <span className="text-amber-600 dark:text-amber-400">Queued</span>
                </>
              )}
              {isRunning && (
                <>
                  <Loader2 className="size-3 animate-spin text-primary" />
                  <span className="text-muted-foreground">Fetching...</span>
                </>
              )}
              {isBlocked && (
                <>
                  <AlertCircle className="size-3 text-destructive" />
                  <span className="truncate text-destructive">
                    {breakdownNode.run_error ?? 'Error'}
                  </span>
                </>
              )}
              {isFetched && !isRunning && !isQueued && !isBlocked && (
                <>
                  <Check className="size-3 text-emerald-500" />
                  <span className="text-muted-foreground">Fetched</span>
                  {breakdownNode.last_run_at && (
                    <span className="text-muted-foreground/60">
                      {formatTimeAgo(breakdownNode.last_run_at)}
                    </span>
                  )}
                </>
              )}
              {!isQueued && !isRunning && !isBlocked && !isFetched && (
                <>
                  <CircleDashed className="size-3 text-muted-foreground/50" />
                  <span className="text-muted-foreground/60">Not fetched</span>
                </>
              )}
            </div>
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between border-t px-3 py-2">
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="nodrag inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
              </a>
            ) : (
              <div />
            )}
            {needsReconnect ? (
              <a
                href={connectHref}
                className={buttonVariants({
                  variant: 'secondary',
                  size: 'sm',
                  className: 'nodrag h-7 gap-1.5 text-xs',
                })}
              >
                Reconnect
              </a>
            ) : (
              <Button
                size="sm"
                variant="secondary"
                onClick={handleRun}
                disabled={isRunning || isQueued || !sourceUrl}
                className="nodrag h-7 gap-1.5 text-xs"
              >
                {isRunning ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                Refresh
              </Button>
            )}
          </div>

          <Handle
            type="source"
            position={Position.Bottom}
            className="!h-3 !w-3 !border-2 !border-background !bg-primary"
          />
        </div>

        <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <DialogContent className="nodrag nopan">
            <DialogHeader>
              <DialogTitle>Delete Node</DialogTitle>
              <DialogDescription>
                This will permanently delete &ldquo;{breakdownNode.name}&rdquo; and all its
                connections. This action cannot be undone.
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

  // --- AI Node (original layout) ---
  return (
    <>
      <div
        className={cn(
          'w-80 rounded-xl border bg-card shadow-sm',
          selected && 'ring-2 ring-ring',
          isQueued && 'border-amber-400/50',
          isBlocked && 'border-destructive/40',
        )}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-background !bg-primary"
        />

        {/* Header: name, run button, overflow menu */}
        <div className="flex items-center justify-between border-b px-3 py-1.5">
          <span className="truncate text-sm font-medium">{breakdownNode.name}</span>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              onClick={handleRun}
              disabled={isRunning || isQueued}
              className="nodrag h-6 gap-1 px-2 text-xs"
            >
              {isRunning ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <Play className="size-3" />
              )}
              {isRunning ? 'Running' : isQueued ? 'Queued' : 'Run'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger className="nodrag inline-flex h-6 w-6 items-center justify-center rounded-md text-sm transition-colors hover:bg-accent hover:text-accent-foreground">
                <MoreHorizontal className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => setDeleteConfirmOpen(true)}
                >
                  <Trash2 className="size-3.5" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Input section */}
        <div className="p-3 pb-0">
          <span className="mb-1 inline-block text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Input
          </span>
          <div className="max-h-[72px] overflow-hidden rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">
              {breakdownNode.prompt || 'No prompt yet'}
            </p>
          </div>
        </div>

        {/* Output TLDR section */}
        <div className="p-3 pt-2">
          <span className="mb-1 inline-block text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">
            Output
          </span>
          <div
            className={cn(
              'max-h-[72px] overflow-hidden rounded-lg bg-muted/50 px-3 py-2 text-sm',
              isRunning && 'animate-pulse',
              isQueued && 'border border-amber-400/30 bg-amber-50/60 dark:bg-amber-950/10',
              isBlocked && 'border border-destructive/30 bg-destructive/5',
            )}
          >
            {isRunning && <p className="text-muted-foreground">Running...</p>}
            {isQueued && !isRunning && (
              <p className="text-muted-foreground">
                {breakdownNode.run_error ?? 'Queued for Run All'}
              </p>
            )}
            {isBlocked && (
              <p className="line-clamp-3 text-destructive">{breakdownNode.run_error ?? 'Error'}</p>
            )}
            {!isQueued && !isRunning && !isBlocked && breakdownNode.output && (
              <p className="line-clamp-3 leading-snug">
                {(breakdownNode.metadata as { summary?: string })?.summary ?? breakdownNode.output}
              </p>
            )}
            {!isQueued && !isRunning && !isBlocked && !breakdownNode.output && (
              <p className="text-muted-foreground">No output yet</p>
            )}
          </div>

          {/* Status line */}
          <div className="mt-2 flex items-center gap-1.5 text-xs">
            {isRunning && (
              <>
                <Loader2 className="size-3 animate-spin text-primary" />
                <span className="text-muted-foreground">Running...</span>
              </>
            )}
            {isQueued && !isRunning && (
              <>
                <CircleDashed className="size-3 text-amber-500" />
                <span className="text-amber-600 dark:text-amber-400">Queued</span>
              </>
            )}
            {isBlocked && !isRunning && (
              <>
                <AlertCircle className="size-3 text-destructive" />
                <span className="truncate text-destructive">
                  {breakdownNode.run_error ?? 'Error'}
                </span>
              </>
            )}
            {breakdownNode.run_status === 'success' && !isRunning && !isQueued && !isBlocked && (
              <>
                <Check className="size-3 text-emerald-500" />
                <span className="text-muted-foreground">Run</span>
                {breakdownNode.last_run_at && (
                  <span className="text-muted-foreground/60">
                    {formatTimeAgo(breakdownNode.last_run_at)}
                  </span>
                )}
              </>
            )}
            {breakdownNode.run_status === 'idle' && !isRunning && !isQueued && !isBlocked && (
              <>
                <CircleDashed className="size-3 text-muted-foreground/50" />
                <span className="text-muted-foreground/60">Not run</span>
              </>
            )}
          </div>
        </div>

        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-3 !w-3 !border-2 !border-background !bg-primary"
        />
      </div>

      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="nodrag nopan">
          <DialogHeader>
            <DialogTitle>Delete Node</DialogTitle>
            <DialogDescription>
              This will permanently delete &ldquo;{breakdownNode.name}&rdquo; and all its
              connections. This action cannot be undone.
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

export const BreakdownNodeMemo = React.memo(BreakdownNodeComponent);

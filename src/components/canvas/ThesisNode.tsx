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
  FileText,
  Table,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import { isDataSourceNode, getDataSourceType } from '@/types/data-source';
import type { DataSourceType } from '@/types/data-source';

const SOURCE_ICONS: Record<DataSourceType, typeof Globe> = {
  'web-url': Globe,
  'google-doc': FileText,
  'google-sheet': Table,
};

function ThesisNodeComponent({ data, selected }: NodeProps<CanvasNode>) {
  const { thesisNode } = data;
  const { updateNodeData, setNodeRunState, removeNode } = useGraphStore();

  const isSource = isDataSourceNode(thesisNode.node_type);
  const sourceType = getDataSourceType(thesisNode.node_type);

  const [prompt, setPrompt] = useState(thesisNode.prompt);
  const [sourceUrl, setSourceUrl] = useState((thesisNode.metadata as { url?: string })?.url ?? '');
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local state when store changes from outside (e.g. detail panel edits)
  const storePrompt = thesisNode.prompt;
  const storeUrl = (thesisNode.metadata as { url?: string })?.url ?? '';
  useEffect(() => {
    setPrompt(storePrompt);
  }, [storePrompt]);
  useEffect(() => {
    setSourceUrl(storeUrl);
  }, [storeUrl]);

  const handlePromptChange = useCallback(
    (value: string) => {
      setPrompt(value);
      updateNodeData(thesisNode.id, { prompt: value });

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        const { error } = await updateNode({
          nodeId: thesisNode.id,
          prompt: value,
        });
        if (error) {
          toast.error('Failed to save prompt');
        }
      }, 500);
    },
    [thesisNode.id, updateNodeData],
  );

  const handleSourceUrlChange = useCallback(
    (value: string) => {
      setSourceUrl(value);
      const newMetadata = { ...thesisNode.metadata, url: value };
      updateNodeData(thesisNode.id, { metadata: newMetadata });

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        const { error } = await updateNode({
          nodeId: thesisNode.id,
          metadata: newMetadata,
        });
        if (error) {
          toast.error('Failed to save URL');
        }
      }, 500);
    },
    [thesisNode.id, thesisNode.metadata, updateNodeData],
  );

  const handleRun = useCallback(async () => {
    setNodeRunState(thesisNode.id, { run_status: 'running' });

    const { data: result, error } = await runNode({ nodeId: thesisNode.id });

    if (error || !result) {
      setNodeRunState(thesisNode.id, {
        run_status: 'error',
        run_error: error ?? 'Run failed',
      });
      toast.error(error ?? 'Run failed');
    } else {
      setNodeRunState(thesisNode.id, {
        run_status: 'success',
        output: result.output,
        run_error: null,
        last_run_at: new Date().toISOString(),
      });
    }
  }, [thesisNode.id, setNodeRunState]);

  const handleDelete = useCallback(async () => {
    const { error } = await deleteNode({ nodeId: thesisNode.id });
    if (error) {
      toast.error('Failed to delete node');
      return;
    }
    removeNode(thesisNode.id);
    setDeleteConfirmOpen(false);
  }, [thesisNode.id, removeNode]);

  const isRunning = thesisNode.run_status === 'running';
  const isError = thesisNode.run_status === 'error';

  const SourceIcon = sourceType ? SOURCE_ICONS[sourceType] : null;

  return (
    <>
      <div
        className={cn('w-80 rounded-xl border bg-card shadow-sm', selected && 'ring-2 ring-ring')}
      >
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3 !w-3 !border-2 !border-background !bg-primary"
        />

        {/* Output section */}
        <div className="p-3">
          <div
            className={cn(
              'min-h-[60px] rounded-lg bg-muted/50 p-3 text-sm',
              isRunning && 'animate-pulse',
              isError && 'border border-destructive/30 bg-destructive/5',
            )}
          >
            {isRunning && (
              <p className="text-muted-foreground">{isSource ? 'Fetching...' : 'Running...'}</p>
            )}
            {isError && <p className="text-destructive">{thesisNode.run_error ?? 'Error'}</p>}
            {!isRunning && !isError && thesisNode.output && (
              <p className="line-clamp-6 whitespace-pre-wrap">{thesisNode.output}</p>
            )}
            {!isRunning && !isError && !thesisNode.output && (
              <p className="text-muted-foreground">
                {isSource ? 'No data yet — click Fetch' : 'No output yet'}
              </p>
            )}
          </div>
        </div>

        {/* Task section: URL input for sources, prompt textarea for AI nodes */}
        <div className="px-3 pb-2">
          {isSource ? (
            <Input
              value={sourceUrl}
              onChange={(e) => handleSourceUrlChange(e.target.value)}
              placeholder="Paste URL here..."
              className="nodrag nopan nowheel text-sm"
            />
          ) : (
            <Textarea
              value={prompt}
              onChange={(e) => handlePromptChange(e.target.value)}
              placeholder="Write your task or prompt..."
              rows={3}
              className="nodrag nopan nowheel resize-none border-muted text-sm"
            />
          )}
          <div className="mt-2 flex justify-end">
            <Button size="sm" onClick={handleRun} disabled={isRunning} className="nodrag">
              {isRunning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : isSource ? (
                <RefreshCw className="size-3.5" />
              ) : (
                <Play className="size-3.5" />
              )}
              {isSource ? 'Fetch' : 'Run'}
            </Button>
          </div>
        </div>

        {/* Name + type icon + overflow menu */}
        <div className="flex items-center justify-between border-t px-3 py-1.5">
          <div className="flex items-center gap-1.5 truncate">
            {SourceIcon && <SourceIcon className="size-3 shrink-0 text-muted-foreground" />}
            <span className="truncate text-xs text-muted-foreground">{thesisNode.name}</span>
          </div>
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

export const ThesisNodeMemo = React.memo(ThesisNodeComponent);

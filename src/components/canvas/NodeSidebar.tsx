'use client';

import { useCallback } from 'react';
import { Plus, Brain, Globe, FileText, Table, TextIcon, FolderOpen } from 'lucide-react';
import { toast } from 'sonner';
import { useReactFlow } from '@xyflow/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useGraphStore } from '@/store/graph-store';
import { createNode } from '@/actions/node-actions';
import { SOURCE_NODE_TYPES, DATA_SOURCE_DEFAULT_NAMES } from '@/types/data-source';
import { useGoogleDrivePicker } from '@/components/integrations/google-drive/GoogleDrivePicker';
import type { PickedGoogleDriveFile } from '@/lib/integrations/google-drive/source';
import type { BreakdownNode } from '@/types/node';

const NODE_OPTIONS = [
  { label: 'AI Node', icon: Brain, nodeType: 'default', defaultName: 'New Node' },
  {
    label: 'Google Drive',
    icon: FolderOpen,
    nodeType: 'google-drive',
    defaultName: 'Google Drive',
  },
  {
    label: 'Web URL',
    icon: Globe,
    nodeType: SOURCE_NODE_TYPES['web-url'],
    defaultName: DATA_SOURCE_DEFAULT_NAMES['web-url'],
  },
  {
    label: 'Google Doc URL',
    icon: FileText,
    nodeType: SOURCE_NODE_TYPES['google-doc'],
    defaultName: DATA_SOURCE_DEFAULT_NAMES['google-doc'],
  },
  {
    label: 'Google Sheet URL',
    icon: Table,
    nodeType: SOURCE_NODE_TYPES['google-sheet'],
    defaultName: DATA_SOURCE_DEFAULT_NAMES['google-sheet'],
  },
  {
    label: 'Text',
    icon: TextIcon,
    nodeType: SOURCE_NODE_TYPES['text'],
    defaultName: DATA_SOURCE_DEFAULT_NAMES['text'],
  },
] as const;

export function NodeSidebar() {
  const { addNode, graph } = useGraphStore();
  const reactFlowInstance = useReactFlow();

  const handleDriveFilesPicked = useCallback(
    async (files: PickedGoogleDriveFile[]) => {
      if (!graph) return;

      const center = reactFlowInstance.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });

      const response = await fetch(`/api/graphs/${graph.id}/google-drive-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files,
          position: { x: center.x - 160, y: center.y - 120 },
        }),
      });
      const result = (await response.json().catch(() => null)) as {
        data?: BreakdownNode[];
        error?: string;
      } | null;

      if (!response.ok || !result?.data) {
        toast.error(result?.error ?? 'Failed to add Google Drive sources');
        return;
      }

      for (const node of result.data) {
        addNode(node);
      }
      toast.success(
        result.data.length === 1
          ? 'Google Drive source added'
          : `${result.data.length} Google Drive sources added`,
      );
    },
    [addNode, graph, reactFlowInstance],
  );

  const { openPicker, dialog: googleDriveDialog } = useGoogleDrivePicker({
    onPicked: handleDriveFilesPicked,
  });

  const handleAddNode = useCallback(
    async (nodeType: string, defaultName: string) => {
      if (nodeType === 'google-drive') {
        await openPicker();
        return;
      }

      if (!graph) return;

      const center = reactFlowInstance.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });

      const { data, error } = await createNode({
        graphId: graph.id,
        name: defaultName,
        nodeType,
        positionX: center.x - 160,
        positionY: center.y - 150,
      });

      if (error || !data) {
        toast.error(error ?? 'Failed to create node');
      } else {
        addNode(data);
      }
    },
    [graph, reactFlowInstance, addNode, openPicker],
  );

  return (
    <>
      <div className="flex w-12 shrink-0 flex-col items-center border-r bg-background py-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-10 w-10 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors hover:bg-accent hover:text-accent-foreground">
            <Plus className="size-5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="start">
            {NODE_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.nodeType}
                onClick={() => handleAddNode(option.nodeType, option.defaultName)}
              >
                <option.icon className="size-4" />
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {googleDriveDialog}
    </>
  );
}

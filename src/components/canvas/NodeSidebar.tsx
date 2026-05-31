'use client';

import { useCallback } from 'react';
import { Plus, Brain, Globe, FileText, Table, TextIcon } from 'lucide-react';
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

const NODE_OPTIONS = [
  { label: 'AI Node', icon: Brain, nodeType: 'default', defaultName: 'New Node' },
  {
    label: 'Web URL',
    icon: Globe,
    nodeType: SOURCE_NODE_TYPES['web-url'],
    defaultName: DATA_SOURCE_DEFAULT_NAMES['web-url'],
  },
  {
    label: 'Google Doc',
    icon: FileText,
    nodeType: SOURCE_NODE_TYPES['google-doc'],
    defaultName: DATA_SOURCE_DEFAULT_NAMES['google-doc'],
  },
  {
    label: 'Google Sheet',
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

  const handleAddNode = useCallback(
    async (nodeType: string, defaultName: string) => {
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
    [graph, reactFlowInstance, addNode],
  );

  return (
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
  );
}

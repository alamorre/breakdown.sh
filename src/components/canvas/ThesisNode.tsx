'use client';

import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import {
  Database,
  Zap,
  Lightbulb,
  MessageSquare,
  FileText,
  GitBranch,
  Columns,
  AlertTriangle,
  Clock,
  Layers,
  Target,
  Eye,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/node';
import type { CanvasNode } from '@/store/graph-store';

const ICON_MAP: Record<string, React.ElementType> = {
  database: Database,
  zap: Zap,
  lightbulb: Lightbulb,
  'message-square': MessageSquare,
  'file-text': FileText,
  'git-branch': GitBranch,
  columns: Columns,
  'alert-triangle': AlertTriangle,
  clock: Clock,
  layers: Layers,
  target: Target,
  eye: Eye,
};

function ThesisNodeComponent({ data, selected }: NodeProps<CanvasNode>) {
  const { thesisNode } = data;
  const config = NODE_TYPE_CONFIG[thesisNode.node_type as NodeType];
  const Icon = ICON_MAP[config.icon] ?? GitBranch;

  return (
    <div
      className={cn(
        'min-w-[180px] max-w-[260px] rounded-lg border bg-card shadow-sm transition-shadow',
        selected && 'ring-2 ring-ring shadow-md',
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-background !bg-muted-foreground"
      />

      <div
        className={cn('flex items-center gap-2 rounded-t-lg px-3 py-2', config.color, 'text-white')}
      >
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate text-xs font-medium">{config.label}</span>
      </div>

      <div className="px-3 py-2">
        <p className="text-sm font-medium leading-tight">{thesisNode.name}</p>
        {thesisNode.conclusion && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{thesisNode.conclusion}</p>
        )}
      </div>

      {thesisNode.confidence > 0 && (
        <div className="flex items-center gap-1.5 border-t px-3 py-1.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${thesisNode.confidence * 100}%` }}
            />
          </div>
          <Badge variant="outline" className="h-4 px-1 text-[10px]">
            {Math.round(thesisNode.confidence * 100)}%
          </Badge>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-background !bg-muted-foreground"
      />
    </div>
  );
}

export const ThesisNodeMemo = React.memo(ThesisNodeComponent);

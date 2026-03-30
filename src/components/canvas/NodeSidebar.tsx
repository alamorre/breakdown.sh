'use client';

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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { NodeType, NODE_TYPE_CONFIG, type NodeCategory } from '@/types/node';

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

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  source: 'Source',
  analysis: 'Analysis',
  synthesis: 'Synthesis',
};

const CATEGORY_ORDER: NodeCategory[] = ['source', 'analysis', 'synthesis'];

function getNodesByCategory(): Record<
  NodeCategory,
  { type: NodeType; config: (typeof NODE_TYPE_CONFIG)[NodeType] }[]
> {
  const grouped: Record<
    NodeCategory,
    { type: NodeType; config: (typeof NODE_TYPE_CONFIG)[NodeType] }[]
  > = {
    source: [],
    analysis: [],
    synthesis: [],
  };

  for (const [type, config] of Object.entries(NODE_TYPE_CONFIG)) {
    grouped[config.category].push({ type: type as NodeType, config });
  }

  return grouped;
}

export function NodeSidebar() {
  const grouped = getNodesByCategory();

  const handleDragStart = (event: React.DragEvent, nodeType: NodeType) => {
    event.dataTransfer.setData('application/thesis-node-type', nodeType);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className="flex w-56 shrink-0 flex-col border-r bg-background">
      <div className="px-3 py-2.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Nodes
        </p>
      </div>
      <Separator />
      <div className="flex-1 overflow-y-auto p-2">
        {CATEGORY_ORDER.map((category, i) => (
          <div key={category} className={cn(i > 0 && 'mt-3')}>
            <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {CATEGORY_LABELS[category]}
            </p>
            <div className="space-y-0.5">
              {grouped[category].map(({ type, config }) => {
                const Icon = ICON_MAP[config.icon] ?? GitBranch;
                return (
                  <div
                    key={type}
                    draggable
                    onDragStart={(e) => handleDragStart(e, type)}
                    className="flex cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted active:cursor-grabbing"
                  >
                    <div
                      className={cn(
                        'flex size-5 items-center justify-center rounded',
                        config.color,
                      )}
                    >
                      <Icon className="size-3 text-white" />
                    </div>
                    <span className="text-xs">{config.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

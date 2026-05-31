'use client';

import { ReactFlowProvider } from '@xyflow/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Graph } from '@/types/graph';
import type { ThesisNode } from '@/types/node';
import type { ThesisEdge } from '@/types/edge';
import { GraphCanvas } from '@/components/canvas/GraphCanvas';
import { GraphTopBar } from '@/components/canvas/GraphTopBar';
import { NodeSidebar } from '@/components/canvas/NodeSidebar';
import { NodeDetailPanel } from '@/components/canvas/NodeDetailPanel';

interface GraphEditorProps {
  graph: Graph;
  initialNodes: ThesisNode[];
  initialEdges: ThesisEdge[];
}

export function GraphEditor({ graph, initialNodes, initialEdges }: GraphEditorProps) {
  return (
    <ReactFlowProvider>
      <TooltipProvider>
        <GraphTopBar
          graphId={graph.id}
          initialName={graph.name}
          initialLlmModel={graph.llm_model}
        />
        <div className="flex flex-1 overflow-hidden">
          <NodeSidebar />
          <div className="flex-1">
            <GraphCanvas graph={graph} initialNodes={initialNodes} initialEdges={initialEdges} />
          </div>
        </div>
        <NodeDetailPanel />
      </TooltipProvider>
    </ReactFlowProvider>
  );
}

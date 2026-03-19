'use client';

import { useCallback, useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore, type CanvasNode, type CanvasEdge } from '@/store/graph-store';
import type { Graph } from '@/types/graph';
import type { ThesisNode } from '@/types/node';
import type { ThesisEdge } from '@/types/edge';

interface GraphCanvasProps {
  graph: Graph;
  initialNodes: ThesisNode[];
  initialEdges: ThesisEdge[];
}

export function GraphCanvas({ graph, initialNodes, initialEdges }: GraphCanvasProps) {
  const { nodes, edges, onNodesChange, onEdgesChange, hydrate, selectNode, selectEdge, reset } =
    useGraphStore();

  useEffect(() => {
    hydrate(graph, initialNodes, initialEdges);
    return () => reset();
  }, [graph, initialNodes, initialEdges, hydrate, reset]);

  const handleNodeClick: NodeMouseHandler<CanvasNode> = useCallback(
    (_, node) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  const handleEdgeClick: EdgeMouseHandler<CanvasEdge> = useCallback(
    (_, edge) => {
      selectEdge(edge.id);
    },
    [selectEdge],
  );

  const handlePaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap className="!bg-background !border-border" maskColor="rgba(0, 0, 0, 0.1)" />
      </ReactFlow>
    </div>
  );
}

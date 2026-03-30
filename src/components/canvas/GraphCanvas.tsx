'use client';

import { useCallback, useEffect, useState, useRef, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  useReactFlow,
  type NodeMouseHandler,
  type EdgeMouseHandler,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from 'sonner';
import { useGraphStore, type CanvasNode, type CanvasEdge } from '@/store/graph-store';
import type { Graph } from '@/types/graph';
import type { ThesisNode, NodeType } from '@/types/node';
import type { ThesisEdge } from '@/types/edge';
import { EdgeType } from '@/types/edge';
import { NODE_TYPE_CONFIG } from '@/types/node';
import { createNode } from '@/actions/node-actions';
import { createEdge } from '@/actions/edge-actions';
import { wouldCreateCycle } from '@/lib/graph/detect-cycle';
import { ThesisNodeMemo } from '@/components/canvas/ThesisNode';
import { ThesisEdgeMemo } from '@/components/canvas/ThesisEdge';
import { EdgeTypePicker } from '@/components/canvas/EdgeTypePicker';

const nodeTypes = { thesis: ThesisNodeMemo };
const edgeTypes = { thesis: ThesisEdgeMemo };

interface GraphCanvasProps {
  graph: Graph;
  initialNodes: ThesisNode[];
  initialEdges: ThesisEdge[];
}

export function GraphCanvas({ graph, initialNodes, initialEdges }: GraphCanvasProps) {
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    hydrate,
    selectNode,
    selectEdge,
    addNode,
    addEdge,
    reset,
  } = useGraphStore();

  const reactFlowInstance = useReactFlow();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);

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

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;

      const cycleDetected = wouldCreateCycle(
        edges.map((e) => ({ source: e.source!, target: e.target! })),
        connection.source,
        connection.target,
      );

      if (cycleDetected) {
        toast.warning('This connection would create a cycle in the graph');
      }

      setPendingConnection(connection);
    },
    [edges],
  );

  const handleEdgeTypeSelect = useCallback(
    async (edgeType: EdgeType) => {
      if (!pendingConnection?.source || !pendingConnection?.target) return;

      const { data, error } = await createEdge({
        graphId: graph.id,
        sourceNodeId: pendingConnection.source,
        targetNodeId: pendingConnection.target,
        edgeType,
      });

      if (error || !data) {
        toast.error(error ?? 'Failed to create connection');
      } else {
        addEdge(data);
      }

      setPendingConnection(null);
    },
    [pendingConnection, graph.id, addEdge],
  );

  const handleEdgeTypeCancel = useCallback(() => {
    setPendingConnection(null);
  }, []);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    async (event: React.DragEvent) => {
      event.preventDefault();

      const nodeType = event.dataTransfer.getData('application/thesis-node-type');
      if (!nodeType) return;

      const config = NODE_TYPE_CONFIG[nodeType as NodeType];
      if (!config) return;

      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const { data, error } = await createNode({
        graphId: graph.id,
        nodeType,
        name: config.label,
        positionX: position.x,
        positionY: position.y,
      });

      if (error || !data) {
        toast.error(error ?? 'Failed to create node');
      } else {
        addNode(data);
      }
    },
    [reactFlowInstance, graph.id, addNode],
  );

  const defaultEdgeOptions = useMemo(() => ({ type: 'thesis' as const }), []);

  return (
    <div className="h-full w-full" ref={reactFlowWrapper}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={handleNodeClick}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        onConnect={handleConnect}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        defaultEdgeOptions={defaultEdgeOptions}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <Controls />
        <MiniMap className="!bg-background !border-border" maskColor="rgba(0, 0, 0, 0.1)" />
      </ReactFlow>

      <EdgeTypePicker
        open={pendingConnection !== null}
        onSelect={handleEdgeTypeSelect}
        onCancel={handleEdgeTypeCancel}
      />
    </div>
  );
}

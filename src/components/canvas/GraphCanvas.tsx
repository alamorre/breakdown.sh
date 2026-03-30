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
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGraphStore, type CanvasNode, type CanvasEdge } from '@/store/graph-store';
import type { Graph } from '@/types/graph';
import type { ThesisNode } from '@/types/node';
import type { ThesisEdge } from '@/types/edge';
import { EdgeType } from '@/types/edge';
import { createNode, deleteNode } from '@/actions/node-actions';
import { createEdge, deleteEdge } from '@/actions/edge-actions';
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
    removeNode,
    removeEdge,
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

      const nodeName = event.dataTransfer.getData('application/thesis-node-name') || 'New Node';

      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;

      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const { data, error } = await createNode({
        graphId: graph.id,
        name: nodeName,
        nodeType,
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

  const handleAddFirstNode = useCallback(async () => {
    const { data, error } = await createNode({
      graphId: graph.id,
      name: 'New Node',
      positionX: 0,
      positionY: 0,
    });

    if (error || !data) {
      toast.error(error ?? 'Failed to create node');
    } else {
      addNode(data);
    }
  }, [graph.id, addNode]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        selectNode(null);
        selectEdge(null);
        return;
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        const { selectedNodeId, selectedEdgeId } = useGraphStore.getState();

        if (selectedEdgeId) {
          removeEdge(selectedEdgeId);
          void deleteEdge({ edgeId: selectedEdgeId }).then(({ error }) => {
            if (error) toast.error('Failed to delete connection');
          });
        }

        if (selectedNodeId) {
          removeNode(selectedNodeId);
          void deleteNode({ nodeId: selectedNodeId }).then(({ error }) => {
            if (error) toast.error('Failed to delete node');
          });
        }
      }
    },
    [selectNode, selectEdge, removeNode, removeEdge],
  );

  const defaultEdgeOptions = useMemo(() => ({ type: 'thesis' as const }), []);

  return (
    <div className="h-full w-full" ref={reactFlowWrapper} onKeyDown={handleKeyDown}>
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

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="pointer-events-auto flex flex-col items-center gap-4 rounded-lg border border-dashed border-border bg-background/80 px-10 py-8 text-center">
              <p className="text-lg font-medium text-muted-foreground">No nodes yet</p>
              <p className="text-sm text-muted-foreground">
                Add a node to start building your reasoning graph.
              </p>
              <Button onClick={handleAddFirstNode}>
                <Plus className="size-4" />
                Add Node
              </Button>
            </div>
          </div>
        )}
      </ReactFlow>

      <EdgeTypePicker
        open={pendingConnection !== null}
        onSelect={handleEdgeTypeSelect}
        onCancel={handleEdgeTypeCancel}
      />
    </div>
  );
}

import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from '@xyflow/react';
import type { Graph } from '@/types/graph';
import type { ThesisNode } from '@/types/node';
import type { ThesisEdge } from '@/types/edge';
import { batchUpdateNodePositions } from '@/actions/graph-actions';

export interface CanvasNode extends Node {
  data: {
    thesisNode: ThesisNode;
  };
}

export interface CanvasEdge extends Edge {
  data: {
    thesisEdge: ThesisEdge;
  };
}

function toCanvasNode(node: ThesisNode): CanvasNode {
  return {
    id: node.id,
    type: 'thesis',
    position: { x: node.position_x, y: node.position_y },
    data: { thesisNode: node },
  };
}

function toCanvasEdge(edge: ThesisEdge): CanvasEdge {
  return {
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    type: 'thesis',
    data: { thesisEdge: edge },
  };
}

interface GraphStoreState {
  graph: Graph | null;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  positionSaveTimeout: ReturnType<typeof setTimeout> | null;
}

interface GraphStoreActions {
  hydrate: (graph: Graph, nodes: ThesisNode[], edges: ThesisEdge[]) => void;
  onNodesChange: (changes: NodeChange<CanvasNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<CanvasEdge>[]) => void;
  selectNode: (nodeId: string | null) => void;
  selectEdge: (edgeId: string | null) => void;
  debouncedPositionSave: () => void;
  reset: () => void;
}

export type GraphStore = GraphStoreState & GraphStoreActions;

const initialState: GraphStoreState = {
  graph: null,
  nodes: [],
  edges: [],
  selectedNodeId: null,
  selectedEdgeId: null,
  positionSaveTimeout: null,
};

export const useGraphStore = create<GraphStore>((set, get) => ({
  ...initialState,

  hydrate: (graph, nodes, edges) => {
    set({
      graph,
      nodes: nodes.map(toCanvasNode),
      edges: edges.map(toCanvasEdge),
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  },

  onNodesChange: (changes) => {
    set((state) => ({
      nodes: applyNodeChanges(changes, state.nodes),
    }));

    const hasPositionChange = changes.some((c) => c.type === 'position' && c.dragging === false);
    if (hasPositionChange) {
      get().debouncedPositionSave();
    }
  },

  onEdgesChange: (changes) => {
    set((state) => ({
      edges: applyEdgeChanges(changes, state.edges),
    }));
  },

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId, selectedEdgeId: null });
  },

  selectEdge: (edgeId) => {
    set({ selectedEdgeId: edgeId, selectedNodeId: null });
  },

  debouncedPositionSave: () => {
    const { positionSaveTimeout } = get();
    if (positionSaveTimeout) {
      clearTimeout(positionSaveTimeout);
    }

    const timeout = setTimeout(() => {
      const { nodes } = get();
      const updates = nodes.map((n) => ({
        nodeId: n.id,
        x: n.position.x,
        y: n.position.y,
      }));
      if (updates.length > 0) {
        void batchUpdateNodePositions(updates);
      }
    }, 500);

    set({ positionSaveTimeout: timeout });
  },

  reset: () => {
    const { positionSaveTimeout } = get();
    if (positionSaveTimeout) {
      clearTimeout(positionSaveTimeout);
    }
    set(initialState);
  },
}));

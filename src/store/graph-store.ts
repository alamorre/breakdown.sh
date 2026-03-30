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
  addNode: (node: ThesisNode) => void;
  updateNodeData: (nodeId: string, updates: Partial<ThesisNode>) => void;
  removeNode: (nodeId: string) => void;
  addEdge: (edge: ThesisEdge) => void;
  updateEdgeData: (edgeId: string, updates: Partial<ThesisEdge>) => void;
  removeEdge: (edgeId: string) => void;
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

  addNode: (node) => {
    set((state) => ({
      nodes: [...state.nodes, toCanvasNode(node)],
    }));
  },

  updateNodeData: (nodeId, updates) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                thesisNode: { ...n.data.thesisNode, ...updates },
              },
            }
          : n,
      ),
    }));
  },

  removeNode: (nodeId) => {
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter(
        (e) =>
          e.data.thesisEdge.source_node_id !== nodeId &&
          e.data.thesisEdge.target_node_id !== nodeId,
      ),
      selectedNodeId: state.selectedNodeId === nodeId ? null : state.selectedNodeId,
    }));
  },

  addEdge: (edge) => {
    set((state) => ({
      edges: [...state.edges, toCanvasEdge(edge)],
    }));
  },

  updateEdgeData: (edgeId, updates) => {
    set((state) => ({
      edges: state.edges.map((e) =>
        e.id === edgeId
          ? {
              ...e,
              data: {
                thesisEdge: { ...e.data.thesisEdge, ...updates },
              },
            }
          : e,
      ),
    }));
  },

  removeEdge: (edgeId) => {
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
      selectedEdgeId: state.selectedEdgeId === edgeId ? null : state.selectedEdgeId,
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

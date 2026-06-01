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
import type { ThesisNode, RunStatus } from '@/types/node';
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
    selected: false,
  };
}

function toCanvasEdge(edge: ThesisEdge): CanvasEdge {
  return {
    id: edge.id,
    source: edge.source_node_id,
    target: edge.target_node_id,
    type: 'thesis',
    data: { thesisEdge: edge },
    selected: false,
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
  updateGraphData: (updates: Partial<Graph>) => void;
  updateNodeData: (nodeId: string, updates: Partial<ThesisNode>) => void;
  setNodeRunState: (
    nodeId: string,
    state: {
      run_status: RunStatus;
      output?: string | null;
      run_error?: string | null;
      last_run_at?: string | null;
      metadata?: Record<string, unknown>;
    },
  ) => void;
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

  updateGraphData: (updates) => {
    set((state) => ({
      graph: state.graph ? { ...state.graph, ...updates } : state.graph,
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

  setNodeRunState: (nodeId, runState) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                thesisNode: {
                  ...n.data.thesisNode,
                  run_status: runState.run_status,
                  ...(runState.output !== undefined && { output: runState.output }),
                  ...(runState.run_error !== undefined && { run_error: runState.run_error }),
                  ...(runState.last_run_at !== undefined && { last_run_at: runState.last_run_at }),
                  ...(runState.metadata && {
                    metadata: { ...n.data.thesisNode.metadata, ...runState.metadata },
                  }),
                },
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
    set((state) => ({
      selectedNodeId: nodeId,
      selectedEdgeId: null,
      nodes: state.nodes.map((node) => ({
        ...node,
        selected: nodeId === node.id,
      })),
      edges: state.edges.map((edge) => ({
        ...edge,
        selected: false,
      })),
    }));
  },

  selectEdge: (edgeId) => {
    set((state) => ({
      selectedEdgeId: edgeId,
      selectedNodeId: null,
      nodes: state.nodes.map((node) => ({
        ...node,
        selected: false,
      })),
      edges: state.edges.map((edge) => ({
        ...edge,
        selected: edgeId === edge.id,
      })),
    }));
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

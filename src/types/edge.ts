export enum EdgeType {
  Supports = 'supports',
  Contradicts = 'contradicts',
  DependsOn = 'depends_on',
  Assumes = 'assumes',
  InputsTo = 'inputs_to',
  SequencesBefore = 'sequences_before',
}

export interface EdgeTypeConfig {
  label: string;
  color: string;
  dashArray?: string;
  description: string;
}

export const EDGE_TYPE_CONFIG: Record<EdgeType, EdgeTypeConfig> = {
  [EdgeType.Supports]: {
    label: 'Supports',
    color: '#22c55e',
    description: 'Upstream conclusion strengthens downstream',
  },
  [EdgeType.Contradicts]: {
    label: 'Contradicts',
    color: '#ef4444',
    description: 'Upstream conclusion weakens downstream',
  },
  [EdgeType.DependsOn]: {
    label: 'Depends On',
    color: '#3b82f6',
    description: 'Downstream requires upstream to be valid',
  },
  [EdgeType.Assumes]: {
    label: 'Assumes',
    color: '#f59e0b',
    dashArray: '5 5',
    description: 'Downstream is predicated on upstream assumption',
  },
  [EdgeType.InputsTo]: {
    label: 'Inputs To',
    color: '#8b5cf6',
    description: 'Upstream provides data that downstream processes',
  },
  [EdgeType.SequencesBefore]: {
    label: 'Sequences Before',
    color: '#6366f1',
    dashArray: '10 5',
    description: 'Temporal ordering — must happen first',
  },
};

export interface ThesisEdge {
  id: string;
  graph_id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: EdgeType;
  weight: number;
  condition: string | null;
  transform: string | null;
  created_at: string;
  updated_at: string;
}

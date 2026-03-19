export enum NodeType {
  DataSource = 'data_source',
  EventTrigger = 'event_trigger',
  Assumption = 'assumption',
  ChatImport = 'chat_import',
  DocumentSource = 'document_source',
  SubThesis = 'sub_thesis',
  Comparison = 'comparison',
  RiskAssessment = 'risk_assessment',
  Timeline = 'timeline',
  CompositeThesis = 'composite_thesis',
  DecisionPoint = 'decision_point',
  Watchlist = 'watchlist',
}

export type NodeCategory = 'source' | 'analysis' | 'synthesis';

export interface NodeTypeConfig {
  label: string;
  category: NodeCategory;
  color: string;
  icon: string;
  description: string;
}

export const NODE_TYPE_CONFIG: Record<NodeType, NodeTypeConfig> = {
  [NodeType.DataSource]: {
    label: 'Data Source',
    category: 'source',
    color: 'bg-blue-500',
    icon: 'database',
    description: 'External data feed — prices, metrics, APIs',
  },
  [NodeType.EventTrigger]: {
    label: 'Event Trigger',
    category: 'source',
    color: 'bg-orange-500',
    icon: 'zap',
    description: 'World state change — news, announcements',
  },
  [NodeType.Assumption]: {
    label: 'Assumption',
    category: 'source',
    color: 'bg-yellow-500',
    icon: 'lightbulb',
    description: 'User-stated belief, manually entered',
  },
  [NodeType.ChatImport]: {
    label: 'Chat Import',
    category: 'source',
    color: 'bg-purple-500',
    icon: 'message-square',
    description: 'Reasoning extracted from prior AI conversations',
  },
  [NodeType.DocumentSource]: {
    label: 'Document Source',
    category: 'source',
    color: 'bg-cyan-500',
    icon: 'file-text',
    description: 'Uploaded files — PDFs, reports, research',
  },
  [NodeType.SubThesis]: {
    label: 'Sub-thesis',
    category: 'analysis',
    color: 'bg-green-500',
    icon: 'git-branch',
    description: 'Scoped conclusion with evidence and confidence',
  },
  [NodeType.Comparison]: {
    label: 'Comparison',
    category: 'analysis',
    color: 'bg-indigo-500',
    icon: 'columns',
    description: 'Evaluate alternatives against criteria',
  },
  [NodeType.RiskAssessment]: {
    label: 'Risk Assessment',
    category: 'analysis',
    color: 'bg-red-500',
    icon: 'alert-triangle',
    description: 'Quantified exposure with probability and impact',
  },
  [NodeType.Timeline]: {
    label: 'Timeline',
    category: 'analysis',
    color: 'bg-teal-500',
    icon: 'clock',
    description: 'Sequenced events with dependencies',
  },
  [NodeType.CompositeThesis]: {
    label: 'Composite Thesis',
    category: 'synthesis',
    color: 'bg-emerald-500',
    icon: 'layers',
    description: 'Aggregated conclusion from multiple sub-theses',
  },
  [NodeType.DecisionPoint]: {
    label: 'Decision Point',
    category: 'synthesis',
    color: 'bg-amber-500',
    icon: 'target',
    description: 'Actionable choice with trigger conditions',
  },
  [NodeType.Watchlist]: {
    label: 'Watchlist',
    category: 'synthesis',
    color: 'bg-pink-500',
    icon: 'eye',
    description: 'Monitoring set with alert thresholds',
  },
};

export enum AutonomyLevel {
  Manual = 'manual',
  Propose = 'propose',
  AutoMinor = 'auto_minor',
  Auto = 'auto',
}

export interface EvidenceItem {
  id: string;
  content: string;
  source?: string;
  added_at: string;
}

export interface EvaluationHistoryEntry {
  conclusion: string;
  confidence: number;
  evaluated_at: string;
  trigger_type: string;
}

export interface ThesisNode {
  id: string;
  graph_id: string;
  node_type: NodeType;
  name: string;
  position_x: number;
  position_y: number;
  conclusion: string | null;
  confidence: number;
  evidence: EvidenceItem[];
  assumptions: string[];
  metadata: Record<string, unknown>;
  skill_doc_id: string | null;
  autonomy_level: AutonomyLevel;
  last_evaluated_at: string | null;
  evaluation_history: EvaluationHistoryEntry[];
  collapsed: boolean;
  color: string | null;
  created_at: string;
  updated_at: string;
}

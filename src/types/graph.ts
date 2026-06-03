import type { BreakdownNode } from '@/types/node';
import type { BreakdownEdge } from '@/types/edge';
import type { AiModelId, AiProviderId } from '@/lib/ai/models';

export interface Graph {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  llm_provider: AiProviderId | null;
  llm_model: AiModelId | null;
  created_at: string;
  updated_at: string;
}

export interface GraphWithData extends Graph {
  nodes: BreakdownNode[];
  edges: BreakdownEdge[];
}

export type TriggerType = 'manual' | 'upstream_change' | 'scheduled' | 'event';
export type EvaluationStatus = 'pending' | 'approved' | 'applied' | 'rejected';

export interface Evaluation {
  id: string;
  node_id: string;
  trigger_type: TriggerType;
  trigger_source: string | null;
  previous_conclusion: string | null;
  new_conclusion: string | null;
  previous_confidence: number | null;
  new_confidence: number | null;
  diff_summary: string | null;
  skill_doc_id: string | null;
  llm_provider: string | null;
  llm_model: string | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  status: EvaluationStatus;
  approved_by: string | null;
  created_at: string;
}

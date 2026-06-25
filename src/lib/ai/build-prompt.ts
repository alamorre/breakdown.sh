import { buildNodeExecutionPrompt, type NodeExecutionUpstreamInput } from './prompt-contract';
import type { BreakdownNode } from '@/types/node';

export interface UpstreamInput {
  nodeName: string;
  nodeOutput: string;
  edgeType: string;
  structuredOutput?: Record<string, unknown> | null;
  condition?: string | null;
  transform?: string | null;
}

export function buildRunPrompt(nodePrompt: string, upstreamInputs: UpstreamInput[]): string {
  const node: BreakdownNode = {
    id: 'prompt-preview-node',
    graph_id: 'prompt-preview-graph',
    node_type: 'default',
    name: 'Reasoning step',
    position_x: 0,
    position_y: 0,
    prompt: nodePrompt,
    output: null,
    structured_output: null,
    run_status: 'idle',
    run_error: null,
    last_run_at: null,
    metadata: {},
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };

  return buildNodeExecutionPrompt({
    node,
    mode: 'internal',
    upstreamInputs: upstreamInputs.map(
      (input): NodeExecutionUpstreamInput => ({
        nodeName: input.nodeName,
        nodeOutput: input.nodeOutput,
        structuredOutput: input.structuredOutput,
        edgeType: input.edgeType,
        condition: input.condition,
        transform: input.transform,
      }),
    ),
  }).executionPrompt;
}

export function buildSummaryPrompt(output: string): string {
  return `Summarize the following analysis output in a single concise sentence. The summary should capture the key conclusion or finding. Output ONLY the summary sentence, nothing else.\n\n---\n\n${output}`;
}

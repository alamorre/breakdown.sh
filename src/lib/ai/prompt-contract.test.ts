import { describe, expect, it } from 'vitest';
import { EdgeType } from '@/types/edge';
import type { BreakdownNode } from '@/types/node';
import {
  buildNodeExecutionPrompt,
  fallbackStructuredOutput,
  parseStructuredOutputFromText,
  resolveNodePromptContract,
  validateNodeStructuredOutput,
} from './prompt-contract';

function node(overrides: Partial<BreakdownNode> = {}): BreakdownNode {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    graph_id: '22222222-2222-4222-8222-222222222222',
    node_type: 'default',
    name: 'Analyze Evidence',
    position_x: 0,
    position_y: 0,
    prompt: 'Explain what the evidence supports.',
    output: null,
    structured_output: null,
    run_status: 'idle',
    run_error: null,
    last_run_at: null,
    metadata: {},
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('node prompt contracts', () => {
  it('generates a domain-neutral default contract for short prompts', () => {
    const result = buildNodeExecutionPrompt({
      node: node(),
      mode: 'external',
      upstreamInputs: [
        {
          nodeName: 'Source Notes',
          nodeOutput: 'The source says conversion improved.',
          structuredOutput: { summary: 'conversion improved' },
          edgeType: EdgeType.InputsTo,
          condition: 'Use only if recent.',
        },
      ],
    });

    expect(result.contractSource).toBe('default');
    expect(result.structuredOutputRequired).toBe(false);
    expect(result.executionPrompt).toContain('## Required Inputs');
    expect(result.executionPrompt).toContain('Source Notes');
    expect(result.executionPrompt).toContain('Structured output');
    expect(result.outputSchema).toMatchObject({ required: ['summary', 'findings', 'dataGaps'] });
  });

  it('translates legacy metadata into the default prompt contract', () => {
    const result = resolveNodePromptContract(
      node({
        metadata: {
          expectedOutput: 'A concise decision memo.',
          acceptanceCriteria: ['Uses upstream evidence.'],
          requiresCurrentData: true,
          suggestedHostTools: ['web'],
        },
      }),
    );

    expect(result.source).toBe('legacy-metadata');
    expect(result.contract.method).toContain(
      'Shape the answer toward this expected output: A concise decision memo.',
    );
    expect(result.contract.acceptanceCriteria).toEqual(['Uses upstream evidence.']);
    expect(result.contract.toolPolicy).toMatchObject({
      requiresCurrentData: true,
      suggestedHostTools: ['web'],
      blockWhenUnavailable: true,
    });
  });

  it('uses explicit metadata contracts and validates required structured output', () => {
    const result = resolveNodePromptContract(
      node({
        metadata: {
          promptContract: {
            version: 'node-prompt-contract.v1',
            objective: 'Return a scored recommendation.',
            outputContract: {
              format: 'json',
              schema: {
                type: 'object',
                required: ['recommendation', 'score'],
                additionalProperties: false,
                properties: {
                  recommendation: { type: 'string' },
                  score: { type: 'number' },
                },
              },
            },
          },
        },
      }),
    );

    expect(result.source).toBe('metadata');
    expect(result.structuredOutputRequired).toBe(true);
    expect(
      validateNodeStructuredOutput({
        contract: result.contract,
        structuredOutput: { recommendation: 'promote', score: 0.9 },
      }),
    ).toEqual({ ok: true });
    expect(
      validateNodeStructuredOutput({
        contract: result.contract,
        structuredOutput: { recommendation: 'promote' },
      }),
    ).toMatchObject({ ok: false });
  });

  it('parses fenced structured output and creates fallback payloads for legacy clients', () => {
    expect(
      parseStructuredOutputFromText(
        'Done.\n```json\n{"summary":"ok","findings":["one"],"dataGaps":[]}\n```',
      ),
    ).toEqual({ summary: 'ok', findings: ['one'], dataGaps: [] });

    expect(fallbackStructuredOutput('Short human answer.')).toEqual({
      summary: 'Short human answer.',
      findings: [],
      dataGaps: [],
      citations: [],
    });
  });

  it('requires citations or explicit data gaps for current-data contracts', () => {
    const result = resolveNodePromptContract(
      node({ name: 'Check latest market data', metadata: { requiresCurrentData: true } }),
    );

    expect(
      validateNodeStructuredOutput({
        contract: result.contract,
        structuredOutput: { summary: 'No source', findings: [], dataGaps: [] },
        citations: [],
      }),
    ).toMatchObject({ ok: false });

    expect(
      validateNodeStructuredOutput({
        contract: result.contract,
        structuredOutput: { summary: 'Gap', findings: [], dataGaps: ['market data unavailable'] },
        citations: [],
      }),
    ).toEqual({ ok: true });
  });
});

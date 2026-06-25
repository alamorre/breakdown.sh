import { describe, it, expect } from 'vitest';
import { buildRunPrompt } from '@/lib/ai/build-prompt';

describe('buildRunPrompt', () => {
  it('wraps a standalone prompt in the default execution contract', () => {
    const result = buildRunPrompt('Analyze this data', []);
    expect(result).toContain('# Breakdown Node Execution Prompt');
    expect(result).toContain('Analyze this data');
    expect(result).toContain('## Output Contract');
    expect(result).toContain('structuredOutput');
  });

  it('should include single upstream input with edge type', () => {
    const result = buildRunPrompt('Summarize the findings', [
      {
        nodeName: 'Market Data',
        nodeOutput: 'Prices are rising 5% YoY',
        edgeType: 'supports',
      },
    ]);

    expect(result).toContain('Input 1: Market Data');
    expect(result).toContain('Edge type: supports');
    expect(result).toContain('Prices are rising 5% YoY');
    expect(result).toContain('Summarize the findings');
  });

  it('should include multiple upstream inputs separated by dividers', () => {
    const result = buildRunPrompt('Make a decision', [
      {
        nodeName: 'Pro Analysis',
        nodeOutput: 'Strong growth potential',
        edgeType: 'supports',
      },
      {
        nodeName: 'Risk Assessment',
        nodeOutput: 'High volatility expected',
        edgeType: 'contradicts',
      },
    ]);

    expect(result).toContain('Input 1: Pro Analysis');
    expect(result).toContain('Strong growth potential');
    expect(result).toContain('Input 2: Risk Assessment');
    expect(result).toContain('Edge type: contradicts');
    expect(result).toContain('High volatility expected');
    expect(result).toContain('---');
    expect(result).toContain('Make a decision');
  });

  it('should handle depends_on edge type', () => {
    const result = buildRunPrompt('Evaluate', [
      {
        nodeName: 'Assumption Node',
        nodeOutput: 'Interest rates stay low',
        edgeType: 'depends_on',
      },
    ]);

    expect(result).toContain('Input 1: Assumption Node');
    expect(result).toContain('Edge type: depends_on');
    expect(result).toContain('Interest rates stay low');
  });

  it('should handle upstream nodes with no output', () => {
    const result = buildRunPrompt('Analyze', [
      {
        nodeName: 'Pending Node',
        nodeOutput: '[not yet run]',
        edgeType: 'inputs_to',
      },
    ]);

    expect(result).toContain('Input 1: Pending Node');
    expect(result).toContain('Edge type: inputs_to');
    expect(result).toContain('[not yet run]');
  });
});

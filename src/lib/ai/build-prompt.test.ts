import { describe, it, expect } from 'vitest';
import { buildRunPrompt } from '@/lib/ai/build-prompt';

describe('buildRunPrompt', () => {
  it('should return prompt as-is when no upstream inputs', () => {
    const result = buildRunPrompt('Analyze this data', []);
    expect(result).toBe('Analyze this data');
  });

  it('should include single upstream input with edge type', () => {
    const result = buildRunPrompt('Summarize the findings', [
      {
        nodeName: 'Market Data',
        nodeOutput: 'Prices are rising 5% YoY',
        edgeType: 'supports',
      },
    ]);

    expect(result).toContain('[SUPPORTS] From "Market Data"');
    expect(result).toContain('Prices are rising 5% YoY');
    expect(result).toContain('Your task:\nSummarize the findings');
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

    expect(result).toContain('[SUPPORTS] From "Pro Analysis"');
    expect(result).toContain('Strong growth potential');
    expect(result).toContain('[CONTRADICTS] From "Risk Assessment"');
    expect(result).toContain('High volatility expected');
    expect(result).toContain('---');
    expect(result).toContain('Your task:\nMake a decision');
  });

  it('should handle depends_on edge type', () => {
    const result = buildRunPrompt('Evaluate', [
      {
        nodeName: 'Assumption Node',
        nodeOutput: 'Interest rates stay low',
        edgeType: 'depends_on',
      },
    ]);

    expect(result).toContain('[DEPENDS_ON] From "Assumption Node"');
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

    expect(result).toContain('[INPUTS_TO] From "Pending Node"');
    expect(result).toContain('[not yet run]');
  });
});

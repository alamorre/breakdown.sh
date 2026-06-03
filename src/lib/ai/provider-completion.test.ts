import { describe, expect, it } from 'vitest';
import { testExports } from '@/lib/ai/provider-completion';

describe('AI provider completion helpers', () => {
  it('extracts text from OpenAI chat completion responses', () => {
    expect(
      testExports.getOpenAiOutput({
        choices: [{ message: { content: 'OpenAI output' } }],
      }),
    ).toBe('OpenAI output');
  });

  it('extracts text from Gemini generateContent responses', () => {
    expect(
      testExports.getGeminiOutput({
        candidates: [{ content: { parts: [{ text: 'Gemini ' }, { text: 'output' }] } }],
      }),
    ).toBe('Gemini output');
  });
});

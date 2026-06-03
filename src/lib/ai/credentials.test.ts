import { describe, expect, it } from 'vitest';
import { getApiKeyHint, getProviderSetupPrompt } from '@/lib/ai/credentials';

describe('AI provider credentials helpers', () => {
  it('formats API key hints without exposing the full key', () => {
    expect(getApiKeyHint('sk-test-123456')).toBe('ending in 3456');
  });

  it('creates provider-specific setup prompts', () => {
    expect(getProviderSetupPrompt('openai')).toBe(
      'Add your OpenAI API key in Settings before running OpenAI models.',
    );
  });
});

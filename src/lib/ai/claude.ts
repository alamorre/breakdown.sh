import Anthropic from '@anthropic-ai/sdk';

export function createClaudeClient(apiKey: string): Anthropic {
  return new Anthropic({
    apiKey,
  });
}

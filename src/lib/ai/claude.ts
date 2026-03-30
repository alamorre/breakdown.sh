import Anthropic from '@anthropic-ai/sdk';

export function createClaudeClient(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

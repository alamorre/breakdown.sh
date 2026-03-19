# AI Evaluation Rules

## API Calls

- Claude API calls happen in server actions only — never client-side
- Use `@anthropic-ai/sdk` for all API interactions
- Client instantiated in `lib/ai/claude.ts` with API key from env

## Prompt Building

- All prompts built through `lib/ai/build-prompt.ts` — no inline prompt strings in actions
- Include upstream node conclusions + edge types in evaluation context
- Never send user credentials or API keys in prompts

## Response Handling

- Parse evaluation responses into typed structures:
  `{ conclusion: string, confidence: number, evidence: string[], diff_summary: string }`
- Validate response shape before using — handle malformed responses gracefully
- Return typed errors, never crash on bad API responses

## Logging

- Log every evaluation to the `evaluations` table
- Track: input tokens, output tokens, provider, model, trigger type
- Store previous and new conclusion + confidence for diffing

## Error Handling

- Timeout: 30s default for Claude API calls
- Rate limit: retry with exponential backoff (max 3 attempts)
- Malformed response: return error to caller, log the issue
- Network failure: surface error to user via toast

## Cost Management

- Use appropriate model sizes — fast model for screening, strong model for material changes
- Cache evaluation results to avoid redundant calls
- Track token usage per evaluation for monitoring

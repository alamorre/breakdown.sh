# Security Rules

## Secrets

- All secrets in `.env.local` — never `.env` or committed files
- Never hardcode API keys, tokens, or credentials in source code
- `.env.local` is in `.gitignore` — verify before every commit

## Supabase

- All queries go through RLS — never bypass with `service_role` key in client code
- `service_role` key is server-side only (server actions, API routes)
- Use the Supabase client library — never raw SQL in application code

## Input Validation

- Validate all user input with Zod schemas in server actions before DB writes
- Sanitize user-provided strings before rendering
- Never use `dangerouslySetInnerHTML` without explicit sanitization

## API Keys

- Claude/Anthropic API key is server-side only — never exposed to the browser
- All AI calls happen in server actions or API routes
- Never include user credentials or API keys in evaluation prompts

## Rate Limiting

- Rate limit AI evaluation endpoints to prevent abuse
- Implement backoff for Claude API rate limit responses

## OWASP Top 10

- No SQL injection: parameterized queries via Supabase client
- No XSS: React handles escaping by default, watch for `dangerouslySetInnerHTML`
- No CSRF: Next.js server actions handle CSRF protection
- No sensitive data in URL parameters or client-side storage

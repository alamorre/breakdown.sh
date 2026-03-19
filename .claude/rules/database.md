# Database Rules

## Migrations

- All schema changes via SQL migration files in `supabase/migrations/`
- Never modify production data manually — always through migrations or server actions
- Migrations are versioned and forward-only — no editing applied migrations

## Row Level Security

- RLS policies on every table, scoped to `auth.uid()` matching `user_id`
- Test RLS policies after creating them
- Never disable RLS for convenience

## Supabase Client

- Use Supabase client for all CRUD — never raw SQL in application code
- Server components/actions: use `lib/supabase/server.ts` client
- Client components: use `lib/supabase/client.ts` client

## Schema Conventions

- Always include `created_at` and `updated_at` (TIMESTAMPTZ, DEFAULT now())
- Use `ON DELETE CASCADE` for child tables (nodes → graph, edges → graph)
- Index foreign keys used in WHERE clauses and JOINs
- Use UUID primary keys (`gen_random_uuid()`)

## JSONB Columns

- Use JSONB for flexible data: `evidence`, `assumptions`, `metadata`
- Define TypeScript types that match the JSONB structure
- Validate JSONB shape in application code before writes

## Queries

- Prefer single queries over multiple round-trips
- Use `.select()` to limit returned columns when possible
- Handle errors from every Supabase call — check `error` before using `data`

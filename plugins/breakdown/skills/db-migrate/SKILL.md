---
name: db-migrate
description: Create and apply a Supabase database migration
user_invocable: true
invocation: /db-migrate
args: '<description>'
---

# Database Migration

Create a timestamped SQL migration file and apply it to the Supabase database.

## Steps

1. **Parse the description**
   - Take the `<description>` argument (e.g., "add skill_docs table")
   - Convert to a kebab-case filename slug

2. **Create the migration file**
   - Generate a timestamp in the format `YYYYMMDDHHMMSS`
   - Create the file at `supabase/migrations/<timestamp>_<slug>.sql`
   - Write the SQL migration based on the description
   - Follow database rules from `.claude/rules/database.md`:
     - Include `created_at` and `updated_at` columns (TIMESTAMPTZ, DEFAULT now())
     - Use `ON DELETE CASCADE` for child tables
     - Use UUID primary keys (`gen_random_uuid()`)
     - Add indexes for foreign keys used in WHERE/JOIN clauses
     - Add Row Level Security policies scoped to `user_id`

3. **Review with user**
   - Display the full SQL migration to the user
   - Ask for confirmation before applying

4. **Apply the migration**
   - Use the repo's Supabase workflow to apply the migration when the user confirms
   - Verify the migration applied successfully
   - If it fails, show the error and help debug

5. **Update TypeScript types**
   - If the migration adds or modifies tables, update the corresponding TypeScript types in `src/types/`
   - Ensure types match the new schema

## Rules

- Migrations are forward-only — never edit an already-applied migration
- All schema changes go through migration files — never modify the database directly
- Always include RLS policies for new tables
- Test the SQL syntax before applying
- Never use raw SQL in application code — this skill is the exception for migration files only

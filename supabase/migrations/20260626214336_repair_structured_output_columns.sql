-- Repair environments where the structured-output migration was recorded
-- or deployed without the API-visible columns being present.
ALTER TABLE nodes
  ADD COLUMN IF NOT EXISTS structured_output JSONB;

ALTER TABLE external_run_steps
  ADD COLUMN IF NOT EXISTS structured_output JSONB;

-- Ask PostgREST/Supabase API processes to refresh their schema cache.
NOTIFY pgrst, 'reload schema';

-- Persist the Anthropic model selected for DAG/node execution.
-- NULL keeps existing graphs on the application default model.
ALTER TABLE graphs ADD COLUMN IF NOT EXISTS llm_model TEXT;

-- Ensure PostgREST sees the new column immediately after remote migrations.
NOTIFY pgrst, 'reload schema';

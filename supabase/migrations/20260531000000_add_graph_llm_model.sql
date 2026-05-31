-- Persist the Anthropic model selected for DAG/node execution.
-- NULL keeps existing graphs on the application default model.
ALTER TABLE graphs ADD COLUMN llm_model TEXT;

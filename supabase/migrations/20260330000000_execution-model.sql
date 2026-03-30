-- Migrate nodes table to execution model: prompt/output pipeline
-- Adds: prompt, output, run_status, run_error, last_run_at
-- Drops: conclusion, confidence, evidence, assumptions, skill_doc_id,
--         autonomy_level, last_evaluated_at, evaluation_history, collapsed, color

-- Add execution columns
ALTER TABLE nodes ADD COLUMN prompt TEXT NOT NULL DEFAULT '';
ALTER TABLE nodes ADD COLUMN output TEXT;
ALTER TABLE nodes ADD COLUMN run_status TEXT NOT NULL DEFAULT 'idle';
ALTER TABLE nodes ADD COLUMN run_error TEXT;
ALTER TABLE nodes ADD COLUMN last_run_at TIMESTAMPTZ;

-- Remove old reasoning-state columns
ALTER TABLE nodes DROP COLUMN IF EXISTS conclusion;
ALTER TABLE nodes DROP COLUMN IF EXISTS confidence;
ALTER TABLE nodes DROP COLUMN IF EXISTS evidence;
ALTER TABLE nodes DROP COLUMN IF EXISTS assumptions;
ALTER TABLE nodes DROP COLUMN IF EXISTS skill_doc_id;
ALTER TABLE nodes DROP COLUMN IF EXISTS autonomy_level;
ALTER TABLE nodes DROP COLUMN IF EXISTS last_evaluated_at;
ALTER TABLE nodes DROP COLUMN IF EXISTS evaluation_history;
ALTER TABLE nodes DROP COLUMN IF EXISTS collapsed;
ALTER TABLE nodes DROP COLUMN IF EXISTS color;

-- node_type becomes a simple label; default all existing rows
ALTER TABLE nodes ALTER COLUMN node_type SET DEFAULT 'default';

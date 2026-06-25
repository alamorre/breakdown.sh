-- Persist machine-readable node outputs separately from human-readable text.
ALTER TABLE nodes
  ADD COLUMN structured_output JSONB;

ALTER TABLE external_run_steps
  ADD COLUMN structured_output JSONB;

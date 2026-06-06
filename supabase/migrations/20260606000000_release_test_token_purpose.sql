-- Track the intended use for durable integration tokens so release-test tokens
-- can be created, rotated, and audited separately from ordinary MCP clients.

ALTER TABLE integration_tokens
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'mcp_client',
  ADD COLUMN created_by_user_id TEXT,
  ADD COLUMN expires_at TIMESTAMPTZ;

UPDATE integration_tokens
SET created_by_user_id = user_id
WHERE created_by_user_id IS NULL;

ALTER TABLE integration_tokens
  ALTER COLUMN created_by_user_id SET NOT NULL,
  ADD CONSTRAINT integration_tokens_purpose_check
    CHECK (purpose IN ('mcp_client', 'release_test'));

CREATE INDEX idx_integration_tokens_purpose
  ON integration_tokens(user_id, purpose, revoked_at);

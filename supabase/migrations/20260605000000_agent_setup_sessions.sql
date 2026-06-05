-- Agent-native onboarding approval sessions.
-- A coding agent creates a pending session, the signed-in user approves it,
-- then the agent exchanges its hashed setup secret for a scoped integration token.

CREATE TABLE agent_setup_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_code TEXT NOT NULL,
  exchange_secret_hash TEXT NOT NULL,
  client_name TEXT NOT NULL,
  provider_name TEXT,
  token_name TEXT,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  workflow JSONB,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '15 minutes'),
  approved_by_user_id TEXT,
  approved_at TIMESTAMPTZ,
  exchanged_at TIMESTAMPTZ,
  token_id UUID REFERENCES integration_tokens(id) ON DELETE SET NULL,
  CHECK (status IN ('pending', 'approved', 'exchanging', 'exchanged', 'cancelled', 'expired'))
);

CREATE INDEX idx_agent_setup_sessions_status_expiry
  ON agent_setup_sessions(status, expires_at);
CREATE INDEX idx_agent_setup_sessions_approved_user
  ON agent_setup_sessions(approved_by_user_id, created_at DESC);
CREATE INDEX idx_agent_setup_sessions_exchange_secret
  ON agent_setup_sessions(exchange_secret_hash);

ALTER TABLE agent_setup_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their approved agent setup sessions"
  ON agent_setup_sessions FOR SELECT
  USING (approved_by_user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Users can update their approved agent setup sessions"
  ON agent_setup_sessions FOR UPDATE
  USING (approved_by_user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

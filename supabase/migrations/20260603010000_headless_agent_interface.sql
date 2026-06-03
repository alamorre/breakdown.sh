-- Headless agent interface tables:
-- integration tokens, write safety/audit records, and external-evaluator runs.

-- ============================================================
-- INTEGRATION TOKENS
-- ============================================================
CREATE TABLE integration_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_integration_tokens_user ON integration_tokens(user_id);
CREATE INDEX idx_integration_tokens_hash ON integration_tokens(token_hash);
CREATE INDEX idx_integration_tokens_active ON integration_tokens(user_id, revoked_at);

ALTER TABLE integration_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own integration tokens"
  ON integration_tokens FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Users can create their own integration tokens"
  ON integration_tokens FOR INSERT
  WITH CHECK (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Users can revoke their own integration tokens"
  ON integration_tokens FOR UPDATE
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

-- ============================================================
-- HEADLESS AUDIT LOGS
-- ============================================================
CREATE TABLE headless_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  actor_source TEXT NOT NULL,
  actor_token_id UUID REFERENCES integration_tokens(id) ON DELETE SET NULL,
  operation TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  graph_id UUID REFERENCES graphs(id) ON DELETE SET NULL,
  destructive BOOLEAN NOT NULL DEFAULT false,
  idempotency_key TEXT,
  request_summary JSONB NOT NULL DEFAULT '{}',
  response_summary JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_headless_audit_logs_user ON headless_audit_logs(user_id, created_at DESC);
CREATE INDEX idx_headless_audit_logs_graph ON headless_audit_logs(graph_id, created_at DESC);

ALTER TABLE headless_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own headless audit logs"
  ON headless_audit_logs FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

-- ============================================================
-- IDEMPOTENCY KEYS
-- ============================================================
CREATE TABLE headless_idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INT,
  response_body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
  UNIQUE(user_id, key)
);

CREATE INDEX idx_headless_idempotency_expiry ON headless_idempotency_keys(expires_at);

ALTER TABLE headless_idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own headless idempotency keys"
  ON headless_idempotency_keys FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

-- ============================================================
-- EXTERNAL EVALUATOR RUNS
-- ============================================================
CREATE TABLE external_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  actor_source TEXT NOT NULL,
  actor_token_id UUID REFERENCES integration_tokens(id) ON DELETE SET NULL,
  client_name TEXT,
  provider_name TEXT,
  manifest_version TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status IN ('active', 'completed', 'blocked', 'cancelled'))
);

CREATE INDEX idx_external_runs_graph ON external_runs(graph_id, created_at DESC);
CREATE INDEX idx_external_runs_user ON external_runs(user_id, created_at DESC);

ALTER TABLE external_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own external runs"
  ON external_runs FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

-- ============================================================
-- EXTERNAL EVALUATOR STEPS
-- ============================================================
CREATE TABLE external_run_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_run_id UUID NOT NULL REFERENCES external_runs(id) ON DELETE CASCADE,
  graph_id UUID NOT NULL REFERENCES graphs(id) ON DELETE CASCADE,
  node_id UUID NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  sequence_index INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  context_version TEXT NOT NULL,
  output TEXT,
  structured_summary JSONB,
  citations JSONB NOT NULL DEFAULT '[]',
  blocked_reason TEXT,
  required_data JSONB NOT NULL DEFAULT '[]',
  submitted_by_source TEXT,
  submitted_by_token_id UUID REFERENCES integration_tokens(id) ON DELETE SET NULL,
  client_name TEXT,
  provider_name TEXT,
  started_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(external_run_id, node_id),
  CHECK (status IN ('pending', 'ready', 'in_progress', 'submitted', 'blocked', 'skipped'))
);

CREATE INDEX idx_external_run_steps_run ON external_run_steps(external_run_id, sequence_index);
CREATE INDEX idx_external_run_steps_status ON external_run_steps(external_run_id, status);

ALTER TABLE external_run_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own external run steps"
  ON external_run_steps FOR SELECT
  USING (external_run_id IN (
    SELECT id FROM external_runs
    WHERE user_id = current_setting('request.jwt.claims', true)::json ->> 'sub'
  ));

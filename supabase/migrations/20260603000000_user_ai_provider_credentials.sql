-- User-managed AI provider API key storage.
-- API keys are encrypted by the application before storage.

CREATE TABLE IF NOT EXISTS user_ai_provider_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai', 'gemini')),
  encrypted_api_key TEXT NOT NULL,
  api_key_hint TEXT NOT NULL,
  last_validated_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, provider)
);

ALTER TABLE user_ai_provider_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own AI provider credentials"
  ON user_ai_provider_credentials FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Users can insert their own AI provider credentials"
  ON user_ai_provider_credentials FOR INSERT
  WITH CHECK (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Users can update their own AI provider credentials"
  ON user_ai_provider_credentials FOR UPDATE
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE INDEX IF NOT EXISTS idx_user_ai_provider_credentials_user_active
  ON user_ai_provider_credentials(user_id, provider)
  WHERE revoked_at IS NULL;

ALTER TABLE graphs ADD COLUMN IF NOT EXISTS llm_provider TEXT DEFAULT 'anthropic';
UPDATE graphs SET llm_provider = 'anthropic' WHERE llm_provider IS NULL;
ALTER TABLE graphs ALTER COLUMN llm_provider SET DEFAULT 'anthropic';
ALTER TABLE graphs ALTER COLUMN llm_provider SET NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Native Google Drive integration connection storage.
-- Refresh/access tokens are encrypted by the application before storage.

CREATE TABLE IF NOT EXISTS google_drive_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  google_subject TEXT NOT NULL,
  account_email TEXT NOT NULL,
  scopes TEXT[] NOT NULL DEFAULT '{}',
  encrypted_access_token TEXT,
  encrypted_refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ,
  last_connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_refresh_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(user_id, google_subject)
);

ALTER TABLE google_drive_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own Google Drive connections"
  ON google_drive_connections FOR SELECT
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Users can insert their own Google Drive connections"
  ON google_drive_connections FOR INSERT
  WITH CHECK (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE POLICY "Users can update their own Google Drive connections"
  ON google_drive_connections FOR UPDATE
  USING (user_id = current_setting('request.jwt.claims', true)::json ->> 'sub');

CREATE INDEX IF NOT EXISTS idx_google_drive_connections_user
  ON google_drive_connections(user_id)
  WHERE revoked_at IS NULL;

NOTIFY pgrst, 'reload schema';

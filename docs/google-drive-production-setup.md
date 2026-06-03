# Google Drive Production Setup

The native Google Drive connector needs code, database, deployment, and Google
Cloud setup. If the graph editor shows a generic Google Drive request failure,
start with the production logs for:

```text
GET /api/integrations/google-drive/status
```

## Supabase

Apply the production migration:

```text
supabase/migrations/20260601000000_google_drive_connections.sql
```

Then confirm the production database has `google_drive_connections`. If using
the Supabase SQL editor, also confirm the PostgREST schema cache reloads. The
migration includes:

```sql
NOTIFY pgrst, 'reload schema';
```

## Secrets

Manage these variables in Doppler, then sync the `prd` config to the Vercel
Production environment:

```text
GOOGLE_DRIVE_CLIENT_ID
GOOGLE_DRIVE_CLIENT_SECRET
GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY
NEXT_PUBLIC_GOOGLE_DRIVE_API_KEY
NEXT_PUBLIC_GOOGLE_DRIVE_APP_ID
```

`GOOGLE_DRIVE_TOKEN_ENCRYPTION_KEY` must be 32 random bytes as base64:

```sh
openssl rand -base64 32
```

`NEXT_PUBLIC_GOOGLE_DRIVE_APP_ID` is the Google Cloud project number. Because
the picker values are public build-time variables, redeploy after changing them.

See `docs/secrets-management.md` for the full local, staging, and production
secrets workflow.

## Vercel

Confirm `breakdown.sh` and `www.breakdown.sh` point at the intended Vercel
project and latest production deployment. Environment variables should come from
the Doppler Vercel sync, not manually maintained Vercel dashboard values.

## Google Cloud Console

In the Google Cloud project used by the connector:

- Enable the Google Drive API.
- Configure the OAuth consent screen with `openid`, `email`, `profile`, and
  `https://www.googleapis.com/auth/drive.file`.
- If the OAuth app is in testing mode, add the test Google accounts.
- Add authorized JavaScript origins:
  - `https://www.breakdown.sh`
  - `https://breakdown.sh` if the bare domain is supported
  - `http://localhost:3000` for local development, if using the same client
- Add authorized redirect URIs:
  - `https://www.breakdown.sh/api/integrations/google-drive/callback`
  - `https://breakdown.sh/api/integrations/google-drive/callback` if the bare
    domain is supported
  - `http://localhost:3000/api/integrations/google-drive/callback` for local
    development, if using the same client
- Restrict the Picker/API key with HTTP referrers:
  - `https://www.breakdown.sh/*`
  - `https://breakdown.sh/*` if used
  - `http://localhost:3000/*` for local development, if using the same key

## Clerk

If `breakdown.sh` is a production domain, configure Clerk accordingly:

- Add `breakdown.sh` and `www.breakdown.sh` to the allowed origins and redirect
  URLs.
- Use the intended production Clerk environment variables in Vercel:
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
  - `CLERK_SECRET_KEY`
- Manage the production Clerk environment variables in Doppler `prd`, then
  redeploy after changing them.

## Smoke Test

After setup:

1. Open a graph on `https://www.breakdown.sh`.
2. Add a `Google Drive` source.
3. Connect Google Drive if prompted.
4. Pick one private Doc, Sheet, and Presentation.
5. Refresh each source without making the file public.

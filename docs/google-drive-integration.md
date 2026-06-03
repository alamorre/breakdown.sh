# Native Google Drive Integration Exploration

This document turns issue #33's exploration prompt into an implementation-ready
plan for native Google Drive sources.

## Decision Summary

The native Google Drive integration should split connection management from graph
source selection:

- Settings/account surfaces manage the Google Drive connection.
- The DAG editor has a single `Google Drive` add-source action.
- The Drive picker creates typed source nodes for Docs, Sheets, and Presentations.
- Existing public-link Google Doc and Sheet sources stay available as a fallback.

V1 should use explicit product source node types because the app already models
Docs and Sheets that way:

- `source-google-doc`
- `source-google-sheet`
- `source-google-presentation`

These node types should share a common Drive-backed metadata shape so future
Drive file types can be added without reworking auth, picker, refresh, or stale
source behavior.

## Current App Fit

The app already has most of the DAG behavior this integration needs:

- Source nodes fetch external content into `nodes.output`.
- `last_run_at` tracks when source content was refreshed.
- Stale sources block downstream node runs until refreshed.
- URL-backed Google Docs and Sheets already render as compact source cards.
- `Run All` already understands that source freshness matters before downstream
  analysis starts.

The missing layer is native file identity and authorized fetching. Drive-backed
nodes should keep the current source-node mental model while replacing
public-link URLs with Google file IDs, account-bound permissions, and clearer
failure states.

## Recommended V1 User Flow

1. User opens a graph.
2. User clicks the add-source control and chooses `Google Drive`.
3. If no Drive account is connected, breakdown.sh opens a Google Drive connection
   prompt inline.
4. After connection, breakdown.sh opens Google Picker filtered to Docs, Sheets, and
   Presentations.
5. User selects one or more files.
6. breakdown.sh creates one source node per selected file near the current canvas
   viewport.
7. User clicks `Refresh` on a source, or `Run All` refreshes stale sources before
   downstream AI nodes run.

Settings should still include a durable `Google Drive` integration page for:

- connected account email
- granted scopes
- reconnect
- disconnect/revoke
- last successful token refresh
- auth or permission warnings

The graph editor should also provide inline recovery. Users should not need to
visit settings just because a graph source needs reconnecting.

## OAuth And Connection Storage

Use a dedicated Google Drive OAuth connection for V1 rather than relying on the
Clerk sign-in provider token.

The current local Google OAuth client is approved for `http://localhost:3000`
only. Before using the integration outside local development, add the production
origin and `/api/integrations/google-drive/callback` redirect URI in Google
Cloud Console and update the deployment environment variables.

Reasons:

- The app can request Drive-specific scopes only when the user needs Drive.
- Reconnect and revoke flows can be explained as Drive integration actions, not
  sign-in actions.
- Server-side refresh tokens can be stored, rotated, audited, and revoked without
  coupling source refresh to Clerk session state.
- The Drive integration can evolve independently if sign-in providers change.

Use `https://www.googleapis.com/auth/drive.file` as the recommended V1 scope.
Google recommends `drive.file` with Google Picker for per-file access. It lets
users choose the files they share with the app and avoids broad `drive.readonly`
access unless the product later needs cross-Drive browsing without picker
selection.

Persist connections in a new table, for example:

```sql
create table google_drive_connections (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  google_subject text not null,
  account_email text not null,
  scopes text[] not null,
  access_token_expires_at timestamptz,
  encrypted_refresh_token text not null,
  last_connected_at timestamptz not null default now(),
  last_refresh_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Token storage requirements:

- Encrypt refresh tokens before storing them.
- Never expose refresh tokens to the browser.
- Mint short-lived access tokens server-side when Picker or export needs them.
- Log reconnect, disconnect, and source refresh failures with enough context to
  debug without logging file contents.

## Google Picker Setup

Use Google Picker for file selection instead of building a custom file browser.
Picker gives the familiar Drive modal, supports filters for file types, and lets
users explicitly choose files for `drive.file` access.

Client configuration needed:

- Google API key restricted to the app origin and Picker API.
- Google Cloud project number as Picker App ID.
- OAuth client ID for browser consent.
- Picker views for documents, spreadsheets, and presentations.
- Multi-select enabled for batch source creation.

Recommended picker wrapper:

- `src/components/integrations/google-drive/GoogleDrivePicker.tsx`
- Load `https://apis.google.com/js/api.js` only when the picker is opened.
- Fetch a short-lived access token from the server when needed.
- Return normalized selected file objects to the graph editor:

```ts
type PickedDriveFile = {
  fileId: string;
  name: string;
  mimeType: string;
  url: string;
  iconUrl?: string;
};
```

When using `drive.file`, prefer Picker list mode if thumbnails are unavailable
under the narrower scope.

## Node Metadata

Drive-backed source nodes should store a stable file identity rather than a
freeform URL.

```ts
type GoogleDriveSourceMetadata = {
  provider: 'google-drive';
  connectionId: string;
  fileId: string;
  fileName: string;
  mimeType:
    | 'application/vnd.google-apps.document'
    | 'application/vnd.google-apps.spreadsheet'
    | 'application/vnd.google-apps.presentation';
  webViewLink: string;
  iconLink?: string;
  accountEmail: string;
  exportMimeType: string;
  lastKnownModifiedTime?: string;
  lastFetchedModifiedTime?: string;
  lastFetchedContentHash?: string;
  extraction?: GoogleDriveExtractionConfig;
};

type GoogleDriveExtractionConfig =
  | { kind: 'document'; format: 'markdown' | 'plain-text' }
  | { kind: 'spreadsheet'; mode: 'sheet'; sheetName?: string; maxRows: number; maxColumns: number }
  | { kind: 'presentation'; format: 'plain-text' };
```

`metadata.url` can remain for existing public-link nodes. New Drive-backed nodes
should use `webViewLink` for opening files in Drive and should treat `fileId` as
the source of truth.

## Server-Side Fetch And Export

Add a Google Drive source fetcher beside the existing public-link fetchers:

- `src/lib/fetch/fetch-google-drive-source.ts`
- `src/lib/google-drive/client.ts`
- `src/lib/google-drive/tokens.ts`

The fetcher should:

1. Load the node and validate Drive metadata.
2. Resolve the user's Google Drive connection.
3. Refresh the access token server-side if needed.
4. Fetch file metadata from Drive before export.
5. Check whether the file can be downloaded/exported.
6. Export the file with the selected V1 strategy.
7. Normalize output into text suitable for DAG prompts.
8. Update `output`, `run_status`, `run_error`, `last_run_at`, and freshness
   metadata on the node.

Google Drive `files.export` is the preferred base API for Workspace files. It
exports a Google Workspace document to the requested MIME type, with a documented
10 MB exported-content limit.

V1 export strategy:

- Docs: export `text/markdown`; fall back to `text/plain` if Markdown export
  fails or is unavailable.
- Sheets: export XLSX and parse selected tabs server-side into bounded Markdown
  tables or CSV blocks. Default to the first sheet until a tab picker is
  implemented. Enforce row, column, cell, and byte limits before writing output.
- Presentations: export `text/plain` for slide text. Defer thumbnails, PDF
  parsing, speaker-note richness, and slide-level image extraction to a later
  milestone.

If adding an XLSX parser is too much for the first implementation PR, split
Sheets into two milestones:

1. Authenticated CSV export for the first sheet.
2. XLSX parsing and native tab selection.

Do not add `drive.readonly` just to make tab browsing easier. If Sheets API
access becomes necessary, evaluate its scope impact separately.

## API Boundaries

Use App Router route handlers for OAuth callbacks and browser-to-server
integration operations. Next.js route handlers live under `app` as `route.ts`
files and use the Web `Request` and `Response` APIs.

Suggested routes:

- `GET /api/integrations/google-drive/status`
- `GET /api/integrations/google-drive/connect`
- `GET /api/integrations/google-drive/callback`
- `POST /api/integrations/google-drive/disconnect`
- `POST /api/integrations/google-drive/picker-token`
- `POST /api/graphs/[graphId]/google-drive-sources`
- `POST /api/nodes/[nodeId]/refresh-source`

Keep browser Server Actions as thin wrappers where they are already used. The
business logic should live in shared services so Server Actions, route handlers,
and future headless APIs do not duplicate auth and validation rules.

Suggested service modules:

- `src/lib/integrations/google-drive/connections.ts`
- `src/lib/integrations/google-drive/oauth.ts`
- `src/lib/integrations/google-drive/picker.ts`
- `src/lib/integrations/google-drive/export.ts`
- `src/lib/integrations/google-drive/source-node.ts`

## UI Plan

### Add Source Menu

```text
+----------------------------------+
| +                                |
|                                  |
| Add source                       |
| - AI Node                        |
| - Google Drive                   |
| - Web URL                        |
| - Text                           |
| - Google Doc URL                 |
| - Google Sheet URL               |
+----------------------------------+
```

`Google Drive` opens the picker. `Google Doc URL` and `Google Sheet URL` remain
for public-link compatibility but should be visually secondary.

### Drive Connection Prompt

```text
+--------------------------------------------------+
| Connect Google Drive                             |
|                                                  |
| Pick Docs, Sheets, and Presentations from Drive  |
| without making them public.                      |
|                                                  |
| Scope: files you select for breakdown.sh               |
|                                                  |
| [Cancel]                         [Connect Drive] |
+--------------------------------------------------+
```

This prompt should appear inline from the canvas flow when no connection exists.
Settings should expose the same connect/reconnect/disconnect controls in a more
durable account-management view.

### Picker Entry

```text
+--------------------------------------------------------------+
| Google Drive                                      adam@...    |
| Search Drive...                                              |
|                                                              |
| [Docs] [Sheets] [Presentations]                              |
|                                                              |
| [doc icon] Market notes              Google Doc              |
| [sheet]    Q3 model                  Google Sheet            |
| [slides]   Board deck                Presentation            |
|                                                              |
| [Cancel]                                      [Add 3 sources] |
+--------------------------------------------------------------+
```

Use native Google Picker for the actual file list. This sketch describes the
state breakdown.sh should create around it: account clarity, type filtering, and a
multi-select add action.

### Drive-Backed Source Card

```text
+--------------------------------+
| [Docs icon] Google Doc      ... |
| Market notes                   |
| adam@company.com               |
|                                |
| [ok] Fetched 2h ago            |
|                                |
| [Open]              [Refresh]  |
+--------------------------------+
```

Card states:

- Not fetched
- Fetching
- Fetched
- Stale
- Permission revoked
- File deleted or unavailable
- Reconnect required
- Export too large or unsupported

The card should not show a freeform URL input for Drive-backed nodes. Use
`Change file` in the detail panel or menu instead.

### Node Detail Panel

```text
+------------------------------------------------+
| Market notes                                   |
| Google Doc                                     |
|                                                |
| File                                           |
| Name: Market notes                             |
| Account: adam@company.com                      |
| Last modified: Jun 1, 2026, 10:25 AM           |
| Last fetched: 2h ago                           |
|                                                |
| [Open in Drive] [Change file] [Refresh]        |
|                                                |
| Fetched content                                |
| +--------------------------------------------+ |
| | # Market notes                             | |
| | ...                                        | |
| +--------------------------------------------+ |
+------------------------------------------------+
```

For Sheets, add an extraction section:

```text
Sheet
[Sheet tab selector]
Rows: first 500
Columns: first 50
```

For Presentations, show extraction mode:

```text
Extraction
Plain text from slides
```

### Auth-Expired State

```text
+--------------------------------+
| [Sheets icon] Google Sheet  ... |
| Q3 model                       |
|                                |
| [!] Reconnect Google Drive     |
|                                |
| [Open]             [Reconnect] |
+--------------------------------+
```

Downstream run errors should name the source and action:

```text
Stale source input: Q3 model requires Google Drive reconnect before this node can run.
```

### Run All Freshness Flow

```text
Run All
  1. Detect stale refreshable sources
  2. Refresh Drive sources with valid connections
  3. Stop if any source needs reconnect or permission repair
  4. Run downstream AI nodes in dependency order
```

Progress UI should include source-specific rows:

```text
[sync] Refreshing Q3 model
[ok]   Market notes refreshed
[!]    Board deck needs reconnect
```

## Migration And Compatibility

Existing URL-backed Google Doc and Sheet nodes should continue to work.

Compatibility plan:

- Keep current `google-doc` and `google-sheet` URL fetch behavior.
- Rename add-menu labels to `Google Doc URL` and `Google Sheet URL` once native
  Drive exists.
- Add a non-blocking `Convert to Drive source` affordance later when a URL-backed
  node has a recognizable Drive file ID and the user has connected Drive.
- Do not automatically migrate existing nodes because they may rely on public
  links, sheet-name behavior, or shared files from accounts the user has not
  connected.

## Phased Implementation Plan

### Phase 1: Connection Foundation

- Add the `google_drive_connections` table.
- Add encrypted refresh-token helpers.
- Add connect/callback/disconnect/status routes.
- Add environment variables for Google API key, OAuth client, app ID, and token
  encryption key.
- Add settings/account UI for connect, reconnect, disconnect, and scope display.

### Phase 2: Picker And Source Creation

- Add the `Google Drive` add-source menu option.
- Add Picker wrapper and picker-token route.
- Filter Picker to Docs, Sheets, and Presentations.
- Normalize selected files into `PickedDriveFile`.
- Create typed source nodes with Drive metadata.
- Add a Google Presentations icon.

### Phase 3: Authorized Refresh

- Add Drive-backed source fetcher.
- Route `source-google-doc`, `source-google-sheet`, and
  `source-google-presentation` through the authorized fetcher.
- Preserve current public-link fetchers for URL-backed nodes.
- Add specific error mapping for expired token, revoked access, deleted file,
  unsupported export, and export-size failures.

### Phase 4: DAG Runtime Integration

- Ensure single-node refresh and `Run All` both refresh Drive-backed sources.
- Keep stale source blocking behavior.
- Add reconnect-aware Run All progress and toast/error copy.
- Store modified time and content hash for freshness comparisons.

### Phase 5: Sheet And Deck Refinement

- Add native sheet-tab selection after first fetch or metadata load.
- Add row/column limits with visible controls.
- Evaluate richer presentation extraction if plain text is insufficient.

## Test Plan

Unit tests:

- Drive metadata validation maps MIME type to source node type.
- `drive.file` connection records reject missing encrypted refresh tokens.
- Token refresh helper handles success, expired refresh token, and revoked grant.
- Export helper selects Docs Markdown, Sheets XLSX, and Presentations plain text.
- Export helper maps Google API errors to user-facing source errors.
- Source freshness considers Drive-backed Docs, Sheets, and Presentations
  refreshable.
- Existing public-link Google Doc and Sheet fetch tests still pass.

Server action and route tests:

- Connect callback stores a connection for the current Clerk user.
- Picker token route never returns refresh tokens.
- Source creation route creates one node per selected file and spaces positions.
- Refresh route rejects nodes owned by another user.
- Refresh route updates `output`, `last_run_at`, `run_status`, and Drive metadata.

UI tests:

- Add-source menu shows `Google Drive` and keeps public URL fallbacks.
- Unconnected Drive flow opens the connect prompt.
- Connected flow opens Picker.
- Drive-backed cards render file identity instead of URL input.
- Auth-expired state shows `Reconnect`.
- Detail panel renders account, file metadata, and extraction controls.
- Run All progress shows Drive source refresh and reconnect failures.

Manual verification:

- Connect a Google account.
- Add one Doc, one Sheet, and one Presentation from Picker.
- Refresh each source.
- Connect each source to an AI node and run the graph.
- Revoke Drive access in Google account settings and confirm reconnect UI.
- Delete or unshare a picked file and confirm the source error is specific.
- Confirm existing public Google Doc and Sheet URL nodes still fetch.

## References

- Google Picker overview: https://developers.google.com/workspace/drive/picker/guides/overview
- Drive API scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Drive `files.export`: https://developers.google.com/workspace/drive/api/reference/rest/v3/files/export
- Workspace export MIME types: https://developers.google.com/workspace/drive/api/guides/ref-export-formats
- Current source type model: `src/types/data-source.ts`
- Current source card UI: `src/components/canvas/BreakdownNode.tsx`
- Current detail panel source controls: `src/components/canvas/NodeDetailPanel.tsx`
- Current source freshness helper: `src/lib/graph/source-freshness.ts`

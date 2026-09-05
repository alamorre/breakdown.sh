# Archive the hosted product in Git history

Status: Accepted for repository cleanup #240; supersedes ADR 0004's in-tree hosted coexistence.

Breakdown Local is the only maintained product in this checkout. The hosted Next.js application,
remote MCP/REST service, Supabase migrations, and remote Codex plugin are archived at the exact
pre-cleanup main commit
[`a784e61955b1635827c8a22acaea4377a1207e07`](https://github.com/alamorre/breakdown.sh/tree/a784e61955b1635827c8a22acaea4377a1207e07).
This commit is an ancestor of the cleanup, so ordinary Git history preserves it without a new tag,
archive repository, history rewrite, or deployment.

Recover an isolated checkout with:

```sh
git worktree add --detach ../breakdown-hosted-archive a784e61955b1635827c8a22acaea4377a1207e07
```

The archive contains the complete `src/`, `public/`, `supabase/`, `plugins/breakdown/`,
`.agents/plugins/`, `skills/breakdown/`, hosted scripts/workflows/configuration, original lockfile,
and `.env.local.example`. Its README, `docs/local-development.md`, `docs/secrets-management.md`,
Google Drive/headless/plugin operator guides, `specs.md`, and `implementation_plan.md` retain the
setup instructions and historical plans. Original license scopes, plugin MIT license and
`VENDORED_SKILLS.json` provenance remain at that same reference. Archival does not grant a new
license to the hosted source or branding and does not claim it is safe to deploy unchanged.

Before deletion, Local imports and release-artifact callers were checked. The Local runtime has
no imports from hosted source. Two Local skill test suites happened to live under `src/lib/`;
they move to `local/tests/`. Nine engineering skills under the plugin are included in Local
standalone archives; they move byte-for-byte to `local/vendor/skills/`, including their original
license and provenance manifest. Hosted-specific plugin skills and remote plugin configuration
remain only in the archive. No Local contract, independent compatibility fixture, or historical
release evidence is removed.

Root commands and PR checks now validate Local. There is no Local web server or hosted environment
inventory. Users grant execution authority through their Agent Host; Local adds no credential
discovery, telemetry, or publication. The manual npm workflow from #269 is unchanged. Optional
platform/host qualification is separate from ordinary contribution and npm publication.

A hosted revival requires a separate decision about maintenance and coexistence. Git history is
the archive; a second in-tree copy would keep the competing contributor path alive.

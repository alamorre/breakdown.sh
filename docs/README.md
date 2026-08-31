# Documentation Visibility

Docs should be public by default when they help users, contributors, integrators,
or self-hosters understand or operate Breakdown. Keep docs internal only when
they contain sensitive operational details, real credentials, private project
notes, or short-lived implementation plans.

## Current Classification

| Source document                         | Visibility             | Public route              |
| --------------------------------------- | ---------------------- | ------------------------- |
| `docs/roadmap.md`                         | Public                 | `/docs/roadmap`           |
| `docs/adr/0004-*.md`                      | Public                 | None (adr)                |
| `docs/getting-started.md`               | Public                 | `/docs/getting-started`   |
| `docs/headless-agents.md`               | Public                 | `/mcp`                    |
| `docs/codex-plugin.md`                  | Public                 | `/docs/codex-plugin`      |
| `docs/plugin-release-loop.md`           | Contributor/operator   | None                      |
| `docs/npm-publishing.md`                | Contributor/operator   | None                      |
| `docs/release-evidence/*.json`          | Public audit evidence  | None                      |
| `docs/local-development.md`             | Contributor/operator   | `/docs/local-development` |
| `docs/google-drive-production-setup.md` | Public after redaction | `/docs/google-drive`      |
| `docs/secrets-management.md`            | Contributor/operator (file-local; Appendix A hosted-legacy) | `/docs/deployment` |
| `docs/google-drive-integration.md`      | Public after review    | `/docs/google-drive`      |
| `specs.md`                              | Public after review (historical hosted spec; top-of-file points at `docs/roadmap.md`) | `/docs/product` |
| `README.md`                             | Public repo overview (top-of-file points at `docs/roadmap.md` + ADR 0004) | None |
| `CONTRIBUTING.md`                       | Contributor/operator   | None                      |
| `implementation_plan.md`                | Internal               | None                      |

## Convention

When adding or changing docs, classify them as one of:

- `public`: safe and useful for signed-out readers.
- `contributor/operator`: public but explicitly non-default for normal hosted usage.
- `public after redaction`: useful publicly, but must be generalized before
  publishing.
- `internal`: should stay private because it is sensitive, stale, or only useful
  as implementation scratch space.

Roadmap and product direction: [`docs/roadmap.md`](roadmap.md) is the single source of truth for current direction (canonical: Breakdown Local, #142; hosted SaaS legacy/out-of-scope). See [ADR 0004](adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md) for the decision and secrets model (file-local only, `.env.local.example` inventory, no Doppler).

Public integration docs should make hosted MCP/API and the public Codex plugin
the default paths for off-repo agents. Local development, self-hosting,
deployment, and plugin packaging-test docs should be labeled so agents do not
infer they need to clone this repository for ordinary Breakdown service usage.

# Documentation Visibility

Docs should be public by default when they help users, contributors, integrators,
or self-hosters understand or operate Breakdown. Keep docs internal only when
they contain sensitive operational details, real credentials, private project
notes, or short-lived implementation plans.

## Current Classification

| Source document                         | Visibility             | Public route            |
| --------------------------------------- | ---------------------- | ----------------------- |
| `README.md`                             | Public                 | `/docs/getting-started` |
| `docs/headless-agents.md`               | Public                 | `/mcp`                  |
| `docs/codex-plugin.md`                  | Public                 | `/docs/codex-plugin`    |
| `docs/google-drive-production-setup.md` | Public after redaction | `/docs/google-drive`    |
| `docs/secrets-management.md`            | Public after redaction | `/docs/deployment`      |
| `docs/google-drive-integration.md`      | Public after review    | `/docs/google-drive`    |
| `specs.md`                              | Public after review    | `/docs/product`         |
| `implementation_plan.md`                | Internal               | None                    |

## Convention

When adding or changing docs, classify them as one of:

- `public`: safe and useful for signed-out readers.
- `public after redaction`: useful publicly, but must be generalized before
  publishing.
- `internal`: should stay private because it is sensitive, stale, or only useful
  as implementation scratch space.

Public docs should be reachable from `/docs` or another signed-out public route.

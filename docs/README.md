# Documentation Visibility

Docs should be public by default when they help users, contributors, integrators,
or self-hosters understand or operate Breakdown. Keep docs internal only when
they contain sensitive operational details, real credentials, private project
notes, or short-lived implementation plans.

## Current Classification

| Source document                         | Visibility             | Public route              |
| --------------------------------------- | ---------------------- | ------------------------- |
| `docs/getting-started.md`               | Public                 | `/docs/getting-started`   |
| `docs/headless-agents.md`               | Public                 | `/mcp`                    |
| `docs/codex-plugin.md`                  | Public                 | `/docs/codex-plugin`      |
| `docs/local-development.md`             | Contributor/operator   | `/docs/local-development` |
| `docs/google-drive-production-setup.md` | Public after redaction | `/docs/google-drive`      |
| `docs/secrets-management.md`            | Operator/self-hosting  | `/docs/deployment`        |
| `docs/google-drive-integration.md`      | Public after review    | `/docs/google-drive`      |
| `specs.md`                              | Public after review    | `/docs/product`           |
| `README.md`                             | Public repo overview   | None                      |
| `implementation_plan.md`                | Internal               | None                      |

## Convention

When adding or changing docs, classify them as one of:

- `public`: safe and useful for signed-out readers.
- `contributor/operator`: public but explicitly non-default for normal hosted usage.
- `public after redaction`: useful publicly, but must be generalized before
  publishing.
- `internal`: should stay private because it is sensitive, stale, or only useful
  as implementation scratch space.

Public integration docs should make hosted MCP/API and the public Codex plugin
the default paths for off-repo agents. Local development, self-hosting,
deployment, and plugin packaging-test docs should be labeled so agents do not
infer they need to clone this repository for ordinary Breakdown service usage.

# Package reference

Document kind: Generated reference

Document version: 1.0.0-beta.1

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/conformance/package/fixtures/artifact-expectations.json` — SHA-256 `dc892f8f71cdb300bdcb612ce4ae530ddd113c3c00ddea09ecb70f9da2a13dfc`
- `local/contracts/specifications/release.md` — SHA-256 `e88fbdb9c57411ffc176aebf4ded5e0bc50e17436043f5c69b57acceb3a18ae2`
- `local/docs/release-metadata.json` — SHA-256 `d7b0c39659bb90919227fc93d30bb4359fe5ae164533ed71ae336f58c5ae6500`
- `packages/breakdown-cli/package.json` — SHA-256 `611eb781cff3abc2088527428e9ad5e9db8cf14c7dd6ac8dbec5bea62cf7d84c`
- `packages/breakdown-core/package.json` — SHA-256 `309ee2bbe50988167a471936cd2f097bc597854e8440dd9fde30d9c47c072b80`
- `packages/breakdown-mcp/package.json` — SHA-256 `059a6ffe317d89be7fc2ea8f5901d6ca994497cdeae6fd95d33f95e4641498cb`


## Inspected package manifests

| Package | Version | Node | Executable | Inspection |
| --- | --- | --- | --- | --- |
| `@breakdown-sh/core` | `1.0.0-beta.1` | `^24.0.0` | library | matches every inspected expectation |
| `@breakdown-sh/cli` | `1.0.0-beta.1` | `^24.0.0` | `breakdown` | matches every inspected expectation |
| `@breakdown-sh/mcp` | `1.0.0-beta.1` | `^24.0.0` | `breakdown-mcp` | matches every inspected expectation |

Inspection state: `workspace-package-manifests`. The package paths inspected for
this checked-in reference are enumerated in the release metadata input.

The maintained package direction is CLI → core and MCP → core. A Breakdown project itself needs no
package manifest or dependency tree. Preferred install and automation examples pin the exact full
version `1.0.0-beta.1`.

## Expected release artifacts

- `npm-tarballs`
- `skills-zip`
- `skills-tar`
- `contracts-zip`
- `contracts-tar`
- `release-manifest`
- `sha256sums`
- `sbom`
- `attestations`

This workspace inspection is not immutable release evidence. Exact published inventory and digests
come only from the once-built candidate's release manifest; the current metadata records that value
as `null`.

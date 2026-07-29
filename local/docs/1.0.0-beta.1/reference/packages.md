# Package reference

Document kind: Generated reference

Document version: 1.0.0-beta.1

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/conformance/package/fixtures/artifact-expectations.json` — SHA-256 `dc892f8f71cdb300bdcb612ce4ae530ddd113c3c00ddea09ecb70f9da2a13dfc`
- `local/contracts/specifications/release.md` — SHA-256 `e88fbdb9c57411ffc176aebf4ded5e0bc50e17436043f5c69b57acceb3a18ae2`
- `local/docs/release-metadata.json` — SHA-256 `d7b0c39659bb90919227fc93d30bb4359fe5ae164533ed71ae336f58c5ae6500`
- `packages/breakdown-cli/package.json` — SHA-256 `2d8483822df64d88ab4f1d9958661c1c6e29678ba0c1543fb3dc4ae800ed327a`
- `packages/breakdown-core/package.json` — SHA-256 `3f53225f59bbbc0837aef183d28c7ebdf196ddfa6c843a6da017fa8a3185e4e2`
- `packages/breakdown-mcp/package.json` — SHA-256 `57d4d2f86d81e12e8a4296d3557b57b68441a0ad2dc68e8c1d32003481052d1f`


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

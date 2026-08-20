# Package reference

Document kind: Generated reference

Document version: 1.0.0

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/conformance/package/fixtures/artifact-expectations.json` — SHA-256 `cb962b90f237fc1a26e9102d333dd9c40f338d38f70be0ebe536deba54045699`
- `local/contracts/specifications/release.md` — SHA-256 `4c561829dfe00de0838cc0d2af5d7a672cd67953b2107f65bc6dc2b966a989e5`
- `local/docs/release-metadata.json` — SHA-256 `41dadb3b249de0b06de694ae42293f417c0be04ded75903c05c4e9f7fc1a3b81`
- `packages/breakdown-cli/package.json` — SHA-256 `c46206fa0de7cd27c3926fdf044682f678ec26d51f1e2f7cbad64f6161a12572`
- `packages/breakdown-core/package.json` — SHA-256 `3be32da0f9715e6f359dc83d7cc90ad52f2c30fd5b41808d58058ac0280d7da8`
- `packages/breakdown-mcp/package.json` — SHA-256 `53922c83ee0027cac226168339805dda7440e164dc265471275f150977a59525`


## Inspected package manifests

| Package | Version | Node | Executable | Inspection |
| --- | --- | --- | --- | --- |
| `@breakdown-sh/core` | `1.0.0` | `^24.0.0` | library | matches every inspected expectation |
| `@breakdown-sh/cli` | `1.0.0` | `^24.0.0` | `breakdown` | matches every inspected expectation |
| `@breakdown-sh/mcp` | `1.0.0` | `^24.0.0` | `breakdown-mcp` | matches every inspected expectation |

Inspection state: `workspace-package-manifests`. The package paths inspected for
this checked-in reference are enumerated in the release metadata input.

The maintained package direction is CLI → core and MCP → core. A Breakdown project itself needs no
package manifest or dependency tree. Preferred install and automation examples pin the exact full
version `1.0.0`.

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

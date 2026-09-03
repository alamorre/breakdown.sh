# Package reference

Document kind: Generated reference

Document version: 1.0.1

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/conformance/package/fixtures/artifact-expectations.json` — SHA-256 `c0c315acfd20b3e01ed829c6b8977cf7716f4f601fe3a5251f338d6437d010ab`
- `local/contracts/specifications/release.md` — SHA-256 `6d678ded4b55cd1ffe4dfcde9e4c20c9f9308c2d28c6c92e8880afb3db6cbc15`
- `local/docs/release-metadata.json` — SHA-256 `f425ce5a60cdfb6418c950f2ecc007838af04b3383bc41229d84befd62dced99`
- `packages/breakdown-cli/package.json` — SHA-256 `f7e7f5c3c4365e0fb0ff700bc77cd0393f396a7be0c8d5d2f2a0a3ff7a66fc11`
- `packages/breakdown-core/package.json` — SHA-256 `7f5357448b0c37981b74c56d04c2ae9093b9749370deb22c6909cea130ab3369`
- `packages/breakdown-mcp/package.json` — SHA-256 `987827585f2a62f82a0bc0116b8cebea308a5a401cd836c000527c4090784c88`


## Inspected package manifests

| Package | Version | Node | Executable | Inspection |
| --- | --- | --- | --- | --- |
| `@breakdown-sh/core` | `1.0.1` | `^24.0.0` | library | matches every inspected expectation |
| `@breakdown-sh/cli` | `1.0.1` | `^24.0.0` | `breakdown` | matches every inspected expectation |
| `@breakdown-sh/mcp` | `1.0.1` | `^24.0.0` | `breakdown-mcp` | matches every inspected expectation |

Inspection state: `workspace-package-manifests`. The package paths inspected for
this checked-in reference are enumerated in the release metadata input.

The maintained package direction is CLI → core and MCP → core. A Breakdown project itself needs no
package manifest or dependency tree. Preferred install and automation examples pin the exact full
version `1.0.1`.

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

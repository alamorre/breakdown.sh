# Package reference

Document kind: Generated reference

Document version: 1.0.0

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/conformance/package/fixtures/artifact-expectations.json` — SHA-256 `cb962b90f237fc1a26e9102d333dd9c40f338d38f70be0ebe536deba54045699`
- `local/contracts/specifications/release.md` — SHA-256 `1f796e7971c3482b52e0183985a5f7256da8e473890196535ae7101b7e521839`
- `local/docs/release-metadata.json` — SHA-256 `41dadb3b249de0b06de694ae42293f417c0be04ded75903c05c4e9f7fc1a3b81`
- `packages/breakdown-cli/package.json` — SHA-256 `f7704beb95186e071c9263da74161edcaf1fc793c84cd711f38d341a139095b5`
- `packages/breakdown-core/package.json` — SHA-256 `f624e455e6549a099e62452f01945143297ee7909bee1a6b44eb6a57b9b40511`
- `packages/breakdown-mcp/package.json` — SHA-256 `51f4fd3c6c7679a1ec97bbab6abb637d85a3e87d12936f2151a97b66b7291f80`


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

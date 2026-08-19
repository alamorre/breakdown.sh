# Distribution, Licensing, and Release Contract

Document kind: Authored normative contract

Contract version: 1.0.0

Requirement namespace: `REQ-PKG`

This document owns package, archive, licensing, version, channel, and release
invariants. Exact artifact inventory and support claims belong to the immutable
release manifest produced from a once-built candidate.

### REQ-PKG-001

Breakdown Local MUST publish `@breakdown-sh/core`, `@breakdown-sh/cli`, and
`@breakdown-sh/mcp`. The core is a public transitive dependency of maintained
adapters, but its in-process interface carries no third-party compatibility
promise. Deep imports MUST be prevented.

### REQ-PKG-002

Each release MUST produce versioned skills and contracts zip and tar archives,
a release manifest, `SHA256SUMS`, and an SPDX or CycloneDX SBOM. A separate npm
skills or schemas package MUST NOT be created.

### REQ-PKG-003

Runtime delivery MUST be TypeScript/ESM portable JavaScript and data on Node
`^24.0.0`, without native add-ons, a bundled Node runtime, browser build, or
install-time build. Maintained tuples are Linux glibc x64/arm64 and macOS
x64/arm64. Windows is Unsupported for 1.0 and MUST NOT receive a platform or
Supported Host claim.

### REQ-PKG-004

A Breakdown project MUST require no package manifest, lockfile, dependency
directory, version receipt, updater state, database, account, or Git
repository. Preferred installation and CI guidance MUST select an exact
package version.

### REQ-PKG-005

CLI and MCP packages MUST contain shrinkwraps, explicit file allowlists, and no
lifecycle install scripts. Their runtime dependency graphs MUST preserve exact
core lockstep and the documented package direction.

### REQ-PKG-006

The initial skill installation path MUST use a pinned audited external
installer to copy an immutable tagged pack, with checksummed archives as the
installer-independent fallback. Setup cannot bootstrap itself and MUST ask
before mutation.

### REQ-PKG-007

Every package, skill, contract, documentation asset, conformance result, and
manifest MUST use one lockstep full-SemVer train. Prerelease and stable version
progression MUST follow the release policy without mixed release sets.

### REQ-PKG-008

Patch releases may fix implementation, security, dependency, and prose defects
without changing contracts; minor releases may add backward-compatible
capabilities or support rows; incompatible public changes or durable/automation
families require a major release.

### REQ-PKG-009

Every maintained release MUST validate or inspect all prior stable disk
families. A new major MUST resume the immediately prior family and offer
non-destructive migration. Automation MUST accept the current and immediately
previous protocol families for one major; removal requires a later major and at
least 12 months' notice.

### REQ-PKG-010

Stable artifacts MUST publish to npm `latest` and an ordinary GitHub Release;
prereleases MUST use npm `next` and a GitHub prerelease. Documentation and
installation guidance MUST continue to pin exact full versions.

### REQ-PKG-011

Release tags MUST be signed and protected as
`breakdown-local-v<version>`. Builds MUST start clean, publish immutable
GitHub releases and attestations, use npm OIDC trusted publishing and
provenance, carry registry signatures and checksums, and never rebuild or
overwrite a published version.

### REQ-PKG-012

Original local core, CLI, MCP, skills, contracts, schemas, documentation,
synthetic examples/templates/fixtures, and local tooling MUST be Apache-2.0.
The hosted root remains private/UNLICENSED, and hosted assets, branding, user
project content, and third-party material MUST NOT be implied within that
grant.

### REQ-PKG-013

Every independent package, archive, and skill MUST contain complete LICENSE,
NOTICE, artifact-specific third-party notices, and required copied license
texts based on its exact final bytes. Ordinary dependencies remain separately
installed; bundling, vendoring, or native delivery requires a fresh review.

### REQ-PKG-014

Publication MUST require DCO 1.1 sign-off, no CLA for the MVP, human review of
AI-assisted provenance, confirmed licensor/publisher identity and authority,
confirmed npm scope control, exact dependency and copied-content review,
secret/private-data scanning, and a final-byte inventory.

### REQ-PKG-015

Package and architecture conformance MUST inspect actual npm tarballs and
release archives for lockstep versions, exact dependencies, engines, exports,
bins, deep-import prevention, cycles, forbidden imports, skill-byte identity,
license scope, source maps, secrets/private data, SBOM, checksums, and
attestations.

### REQ-PKG-016

The complete deterministic core, CLI, package, disk, crash, concurrency, and
applicable security suite MUST run against actual candidate artifacts on every
maintained platform tuple and retain exact OS, architecture, Node patch,
filesystem, runner, corpus revision, and candidate digest.

### REQ-PKG-017

Stable publication MUST require an attested host-support index bound to the exact candidate digest,
contract corpus revision, source commit, and protected release tag. For Breakdown Local 1.0 that
index MUST record the explicit `deferred` certification policy, zero evidence rows, and
`supported_hosts: []`; it MUST NOT describe deferral as a passing real-host gate. Publication MAY
instead accept a future fully qualified passing support set only when every named Supported Host is
derived from exact passing immutable evidence. A missing, unattested, mismatched, or non-empty
unqualified support set MUST fail closed.

### REQ-PKG-018

The permanent sole maintainer, release approver, and publisher is `alamorre`; the stable release
process MUST NOT require or claim an independent reviewer, nominal collaborator, alternate account,
or automation identity. Before tag creation and again before publication, the release gate MUST
verify and retain sanitized evidence that environment `breakdown-local-stable` admits only the
exact `breakdown-local-v*` tag policy with administrator bypass disabled, immutable GitHub Releases
are enabled, and tag ruleset `20015652` has exactly `refs/tags/breakdown-local-v*`, update/deletion
restrictions, no exclusions or bypass actors, and no maintainer bypass. Before its first irreversible
step, stable publication MUST verify a candidate-bound SSH approval signature against the
maintainer's GitHub-recognized signing identity and retain the approval, signature, verification,
GitHub-hosted runner identity, npm OIDC subject, artifact IDs, source/tag bindings, and exact control
snapshot. These compensating controls MUST NOT be described as independent review.

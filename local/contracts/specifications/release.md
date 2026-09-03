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

The repository MAY produce versioned skills and contracts archives, a release
manifest, checksums, and an SBOM for local inspection. Those optional artifacts
MUST NOT block npm publication. A separate npm skills or schemas package MUST
NOT be created.

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

Stable packages MUST publish to npm `latest`; prereleases MUST use npm `next`.
GitHub Releases are optional and MUST NOT block npm publication. Documentation
and installation guidance MUST continue to pin exact full versions.

### REQ-PKG-011

The repository MUST provide one manual GitHub Actions workflow on `main` that
builds, packs, and publishes core, CLI, and MCP directly in dependency order.
It MUST use npm OIDC trusted publishing and MUST NOT overwrite a published
version. Signed tags, GitHub Releases, attestations, retained evidence, and
pre-publication inspection are not prerequisites for this personal package.

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

Changes MUST use DCO 1.1 sign-off and require no CLA for the MVP. Ordinary pull
request review and repository checks are the quality boundary; publication
MUST NOT add a second ceremony, approval receipt, or evidence inventory.

### REQ-PKG-015

Repository checks MUST cover package builds and behavior before merge. The
publish workflow MUST create ordinary npm tarballs with lockstep versions,
exact dependencies, engines, exports, bins, and license material, without
requiring a second pre-publication conformance layer.

### REQ-PKG-016

Platform qualification MAY be run independently when portability evidence is
useful. It MUST NOT be an input or gate for the npm publish workflow.

### REQ-PKG-017

Supported Host qualification is independent from npm publication. For Breakdown Local 1.0,
documentation MUST continue to record the explicit `deferred` certification policy, zero evidence
rows, and `supported_hosts: []`; it MUST NOT describe deferral as a passing real-host gate.

### REQ-PKG-018

The permanent sole maintainer and publisher is `alamorre`; the release process MUST NOT require or
claim an independent reviewer, nominal collaborator, alternate account, or a separate approval
environment. A maintainer manually dispatches the publish workflow from `main` after the version
change passes ordinary repository checks.

### REQ-PKG-019

All three existing packages MUST configure npm trusted publishing for repository
`alamorre/breakdown.sh`, workflow `local-stable-publication.yml`, and environment
`breakdown-local-stable`. The workflow MUST use the GitHub-hosted runner OIDC identity directly and
MUST NOT require an npm token, a trusted-publisher inspection, or an inspection artifact.

### REQ-PKG-020

The trusted-publisher inspection, release ceremony, rehearsal, recovery workflow, controller, and
their evidence receipts MUST NOT be part of npm publication. Failed publication is handled by
fixing or bumping the package version and manually dispatching the same direct workflow again.

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
GitHub releases and attestations, use npm OIDC trusted publishing except for
the one-time package-record creation path in REQ-PKG-019, carry provenance,
registry signatures, and checksums, and never rebuild or overwrite a published
version.

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
process MUST NOT require or claim an independent reviewer, nominal collaborator, or alternate
account. Before tag creation and again before publication, the release gate MUST verify and retain
sanitized evidence that environment `breakdown-local-stable` admits only the exact
`breakdown-local-v*` tag policy with administrator bypass disabled, immutable GitHub Releases are
enabled, and tag ruleset `20015652` has exactly `refs/tags/breakdown-local-v*`, update/deletion
restrictions, no exclusions or bypass actors, and no maintainer bypass.

Before tag creation, automation MUST prove that the candidate and platform index are immutable
artifacts from one successful first-attempt qualification run at the current `main` SHA and MUST
present the exact source SHA, candidate digest, checksum-inventory digest, artifact IDs, version,
tag, npm mode, ceremony run ID, and required human attestations. Environment
`breakdown-local-authorization` MUST admit only `main`, require exactly GitHub reviewer `alamorre`,
permit self-review only because of the permanent sole-maintainer model, and disable administrator
bypass. The authenticated review MUST explicitly confirm the SHA-256 of that exact plan. Automation
MUST retain and attest the review-bound authorization and MUST NOT manufacture or claim to sign the
human decision.

The protected annotated tag MUST be signed by the documented keyless automation identity using a
short-lived GitHub Actions OIDC certificate and ephemeral signing key, with no long-lived or
maintainer private key supplied to the runner. Verification MUST check the exact repository,
workflow, `main` ref, OIDC issuer, Git signature, certificate claims, and transparency-log entry.
Stable publication MUST retain the authorization, its attestation and verification, signer
evidence, GitHub-hosted runner identity, npm OIDC subject, artifact IDs, source/tag bindings, and
exact control snapshot. These compensating controls MUST NOT be described as independent review.

### REQ-PKG-019

Because npm trusted publishing cannot be configured before a package record exists, the exact
first publication of `@breakdown-sh/core@1.0.0`, `@breakdown-sh/cli@1.0.0`, and
`@breakdown-sh/mcp@1.0.0` MAY use one short-lived granular access token created by the confirmed
two-factor-authenticated human publisher. The token MUST expire within 24 hours, grant read/write
only to the `@breakdown-sh` package scope, grant no organization permission, bypass publishing 2FA
only for this bootstrap, and be supplied only through protected environment secret
`NPM_FIRST_PACKAGE_TOKEN`. The protected workflow MUST refuse an existing package name without the
exact candidate version; publish only absent records, in core/CLI/MCP dependency order, from the
qualified tarballs with public access, `latest`, and provenance; compare every public tarball byte
for byte; audit registry signatures and provenance; retain a sanitized attested bootstrap report;
and MUST NOT create or finalize a GitHub Release in that run.

After all three package records exist, the human publisher MUST configure each package's only
trusted publisher as GitHub repository `alamorre/breakdown.sh`, workflow
`local-stable-publication.yml`, environment `breakdown-local-stable`, with only `createPackage`
permission; require two-factor authentication and disallow token publication on each package;
revoke the bootstrap token; and remove the GitHub environment secret. A second protected run with
a fresh candidate-bound GitHub authorization MUST validate attested sanitized trust evidence, the attested
bootstrap report, absence of the bootstrap secret, and the exact public 1.0.0 tarball bytes before
finalizing the immutable GitHub Release without republishing npm. Every later package version MUST
use that OIDC trusted publisher, refuse npm token environment variables, and retain exact trust,
provenance, signature, and public-byte verification.

### REQ-PKG-020

Release recovery MUST use one durable operation identity derived from the immutable tag and tag
object, candidate source/content/checksum digests, ceremony run, retained artifact IDs,
authorization digest, publication mode, and destructive confirmation. Every attempt MUST retain
its controller and child workflow SHAs, run IDs and run attempts, predecessor, immutable-input
digest, public-state preflight, last side-effect boundary, conclusion, retry classification, and
environment cleanup result. A newer reviewed workflow SHA MAY create a successor only when the
previous child is complete, its pre-publication stop is conclusive, every immutable input still
matches, every expected public record is absent, and cleanup is restored and verified. Automation
MUST NOT rerun a stale workflow snapshot or permit more than one active child.

A workflow dispatch MUST correlate and monitor only the run ID returned by the versioned GitHub
dispatch response. Missing run name, actor, ref, SHA, or input-derived title while GitHub populates
metadata MUST cause bounded polling of that same run ID, never another dispatch. Mismatched or
timed-out correlation MUST stop for review. Any npm package, GitHub Release, executed publication
step, indeterminate public state, unknown side-effect boundary, or cleanup failure MUST terminate
automatic iteration.

The repository MUST provide an unprotected, no-secret, non-publishing rehearsal from an exact
development commit that uses the same repository-owned operation, tag, public-state, correlation,
redaction, and side-effect classifiers as live recovery through the final pre-publication boundary.
It MUST run with a deliberately minimal declared tool set and fixtures for GitHub, npm, artifacts,
tags, rulesets, historical attempts, and eventual consistency. The steady stable environment MUST
retain exactly one `breakdown-local-v*` tag policy. Any bounded exact-`main` v1 recovery exception
MUST have an auditable least-privilege transition plus an independent idempotent finalizer that
restores and verifies the sole tag policy on every exit path.

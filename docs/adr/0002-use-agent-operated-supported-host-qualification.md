# Defer Supported Host certification for Breakdown Local 1.0

> Historical release design. #269 supersedes the publication gates below; the deferred Supported Host policy remains. Current npm publication follows [the simple manual workflow](../npm-publishing.md).

Issue #187 replaces the agent-operated qualification decision explored for #186. Breakdown Local
1.0 is intended to put the complete local MVP in the product owner's hands without making an
untested host claim or blocking on real Agent Host execution.

## Decision

Breakdown Local 1.0 publishes with Supported Host certification explicitly deferred and with
`supported_hosts: []`. A GitHub-hosted workflow generates and attests the exact empty host-support
index bound to the candidate digest, contract corpus, source commit, and protected release tag.
Stable publication requires that authenticated artifact; omission is not equivalent to deliberate
deferral.

Hosts that pass capability preflight but lack an exact qualified row are Compatible, never
Supported. Windows and surfaces without mandatory capabilities remain Unsupported. A later fully
qualified, immutable passing support set may replace this policy only through issue #188.

## Disabled capture boundary

`.github/workflows/local-host-evidence-capture.yml` (workflow ID `324133712`) is intentionally
`disabled_manually`. It MUST remain disabled and MUST NOT be dispatched during the 1.0 ceremony.
It may be re-enabled only after issue #188 is implemented and accepted. No script, workflow, or
operator step in the 1.0 release path may invoke or enable it.

## Consequences

- The host-support index has zero evidence rows and zero Supported Host claims; this is a deferred
  policy, not a passing real-host qualification.
- Stable publication still fails closed without an exact attestation or when candidate, source,
  corpus, tag, rows, claims, approval, generated support, or public bytes disagree.
- Human approval records review and acceptance of the zero-claim deferred policy instead of
  asserting that a host gate passed.
- Platform, package, security, documentation, legal, signing, provenance, and publication gates
  remain unchanged.
- No real Agent Host journey, tag, package publication, GitHub Release, or Supported Host claim is
  created by this decision.

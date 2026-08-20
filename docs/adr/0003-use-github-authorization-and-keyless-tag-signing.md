# Use GitHub authorization and keyless automation tag signing

Status: Accepted for issue #196

## Context

The stable ceremony previously required the sole maintainer to clone the repository, download
artifacts, assemble JSON, sign that JSON and an annotated tag with a personal SSH key, copy base64
values into workflow inputs, and dispatch two later workflows. Those executable local steps added
transcription and workstation risk. Automation must not receive the maintainer's private key or
manufacture a human decision in the maintainer's name.

The repository has no configured external cloud account, workload-identity federation, KMS/HSM
key, or independent service operator. Introducing one solely for this release would add an
unreviewed external control plane, billing/availability dependency, and new policy configuration
whose identity could not be proven by this repository before the release. A KMS-backed Git tag
signer is therefore not presently feasible without expanding the release trust model.

## Decision

Human authorization and automation signing are separate records and identities.

The `local-release-ceremony.yml` plan job verifies that both immutable artifacts came from one
successful first-attempt platform-qualification run at the current `main` SHA. It reinspects the
candidate, passing platform index, repository controls, artifact IDs and GitHub artifact digests,
then presents the exact source SHA, version, tag, candidate digest, checksum-inventory digest,
artifact IDs, npm mode, ceremony run ID, attestations, and plan SHA-256 in the run summary.

The irreversible job is protected by environment `breakdown-local-authorization` (ID
`20224502339`). Its only required reviewer is GitHub user `alamorre` (ID `15023107`), self-review
is permitted because the permanent operating model has one maintainer, `main` is the only admitted
branch, and administrator bypass is disabled. Authorization is valid only when GitHub's review
history contains one approval from that user with exact comment
`APPROVE BREAKDOWN LOCAL PLAN SHA256 <digest>`. Automation converts that authenticated review into
`breakdown.github-release-authorization.v1` and attests the exact bytes; it does not sign as or
claim to be the human.

The annotated tag is signed by Gitsign 0.17.1, whose Linux amd64 binary is pinned to SHA-256
`69213a8a0813a151e5a47d0060862952ff833a845d57309dff76f7ba6600abae`, using GitHub Actions OIDC,
a short-lived Fulcio certificate, an ephemeral key generated only for that signing operation, and
the public Rekor transparency log. No long-lived or maintainer-controlled private key is supplied
to, exported from, or retained by the runner. Verification requires exactly:

- certificate identity
  `https://github.com/alamorre/breakdown.sh/.github/workflows/local-release-ceremony.yml@refs/heads/main`;
- OIDC issuer `https://token.actions.githubusercontent.com`;
- a valid Git signature and certificate claims; and
- a valid Rekor transparency-log entry.

GitHub does not currently render Gitsign signatures as “Verified”, so the release gate uses
identity-aware `gitsign verify`; GitHub's generic annotated-tag `verification` field is not a trust
oracle for this signer.

## Threat model and consequences

A compromise of the ceremony workflow on `main` could use its OIDC identity, so the trusted
identity deliberately includes the exact repository, workflow path, and `main` ref. The exact
human-reviewed plan, GitHub environment configuration, first-attempt/current-main artifact checks,
protected no-bypass tag, immutable artifacts, Rekor record, publication re-verification, and
retained attestations make substitution observable and fail closed. These controls are
compensating controls, not independent review.

The public Sigstore service is an availability dependency at the tag boundary. An outage stops the
release; it does not authorize an unsigned tag or alternate signer. Signer identity changes require
a new ADR, contract update, and newly qualified candidate. A future non-exportable KMS/HSM signer
may replace Gitsign only after its OIDC federation, public verification method, recovery behavior,
and operational ownership are reviewed and recorded.

Dry runs execute the complete plan and authorization path but stop before tag creation. After a
tag exists, recovery reuses only the same tag bound to the same ceremony run and plan; it never
moves, deletes, recreates, or overwrites the tag.

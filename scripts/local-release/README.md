# Breakdown Local stable release runbook

This runbook is the normative operator path for Breakdown Local stable releases. The ceremony is
GitHub Actions-operated: the maintainer does not clone the repository, download or rebuild release
bytes, prepare base64 inputs, handle a signing key, push a tag, or manually dispatch downstream
workflows.

`alamorre` is permanently the sole maintainer, human release approver, and npm publisher. The
GitHub review and automation signer are deliberately separate identities, but they are not
independent review. See
`docs/adr/0003-use-github-authorization-and-keyless-tag-signing.md` for the signing threat model.

The implementation PR changes release-contract and workflow bytes. After it merges, every older
candidate and qualification run is stale. Build and fully qualify one fresh candidate from the
eventual merged `main` before resuming issue #190.

## Permanent repository controls

Every plan and publication re-reads these controls and fails closed on drift:

- immutable GitHub Releases are enabled;
- environment `breakdown-local-stable` (ID `18989155368`) admits only tag pattern
  `breakdown-local-v*`, has no reviewer rule, and disables administrator bypass;
- environment `breakdown-local-authorization` (ID `20224502339`) admits only branch `main`, has
  exactly required reviewer `alamorre` (user ID `15023107`), permits self-review for the documented
  sole-maintainer model, and disables administrator bypass;
- tag ruleset `20015652` protects exactly `refs/tags/breakdown-local-v*` from update and deletion,
  with no exclusion, bypass actor, administrator bypass, or maintainer bypass;
- `alamorre` remains the only direct collaborator; and
- guided-host capture workflow `324133712` remains `disabled_manually` for the 1.0 deferred policy.

The deferred policy remains exactly `supported_hosts: []`.

Guided-host workflow ID `324133712` MUST remain disabled and MUST NOT be dispatched; see issue #188.

The release-control reader first uses `GITHUB_TOKEN`. If that token cannot read Administration,
Actions, Environments, and Metadata, store a fine-grained, read-only
`RELEASE_CONTROL_READ_TOKEN` as a repository secret so the pre-authorization plan job can use it.
The sole-maintainer repository has no untrusted direct collaborator, pull requests do not receive
the secret, and the token has no write permission. Never retain its value in an artifact.

## 1. Build and fully qualify one current-main candidate

In GitHub, open **Actions → Breakdown Local platform qualification → Run workflow**, select
`main`, and run it once. Wait for every job to succeed. Record the artifact IDs shown for:

- `breakdown-local-candidate`; and
- `breakdown-platform-evidence-index`.

The ceremony accepts them only when both are unexpired artifacts from the same successful,
first-attempt `local-platform-qualification.yml` run, the candidate source is the exact current
`main` SHA, and every maintained Linux/macOS row passed. It downloads by artifact ID, never by name
alone, and never rebuilds or mutates candidate bytes.

If any candidate artifact, contract, schema, canonical skill, generated documentation, release
script, or workflow byte changes, discard these IDs and qualify one new candidate from the new
current `main`.

## 2. Run the non-publishing dry run

Open **Actions → Breakdown Local release ceremony → Run workflow** on `main` and supply:

- the exact current `main` SHA;
- the candidate and platform-index artifact IDs;
- execution mode `dry-run`;
- the intended npm publication mode; and
- any mode-required npm evidence artifact IDs.

The plan job verifies the candidate, qualification run, artifact IDs and GitHub artifact digests,
platform index, source SHA, and pre-tag controls. Its summary presents the exact version, tag,
candidate digest, `SHA256SUMS` digest, artifact IDs, npm mode, ceremony run ID, plan SHA-256, and
every human attestation.

Review those exact values. Open **Review deployments**, select
`breakdown-local-authorization`, paste the exact comment displayed by the plan job, and choose
**Approve and deploy**. The required shape is:

```text
APPROVE BREAKDOWN LOCAL PLAN SHA256 <exact plan digest>
```

The authorization job reads GitHub's workflow-review history, requires exactly one approval by
`alamorre` for the exact environment and comment, creates the candidate-bound authorization, and
attests its exact bytes. Automation does not approve, sign as the maintainer, or infer an approval
from the dispatch event. The dry run verifies this attestation and stops before tag creation. It
creates no tag, GitHub Release, or npm publication.

Issue #196 is not complete until a post-merge dry run passes at this boundary and its URL is linked
from the issue. A dry run from this implementation PR is useful CI evidence but cannot replace the
required fresh post-merge candidate and dry run.

## 3. Execute the authorized ceremony

After reviewing the successful dry run, dispatch a fresh ceremony on the same exact candidate and
platform IDs with execution mode `execute`. Review the newly generated plan and approve its exact
digest in the same GitHub environment UI. A dry-run authorization cannot authorize execute mode,
and an authorization from another run cannot be reused.

The execute job then:

1. verifies the attested GitHub authorization;
2. installs checksummed Gitsign 0.17.1;
3. creates one annotated tag whose message binds the candidate digest, checksum-inventory digest,
   candidate/platform artifact IDs, ceremony run ID, plan digest, and authorization digest;
4. signs and verifies it against the exact keyless GitHub Actions OIDC identity and Rekor;
5. pushes the new tag once through the no-bypass tag ruleset;
6. dispatches `local-host-support.yml` from that exact tag, waits for its one correlated run, and
   resolves the one authenticated host-support artifact ID; and
7. dispatches `local-stable-publication.yml` from the same tag with only exact artifact IDs and
   waits for completion.

The ceremony supplies the retained authorization and host evidence by immutable artifact ID. There
is no local JSON editing, signing, base64 encoding, evidence copy/paste, tag command, or later
workflow dispatch.

For the one-time 1.0.0 npm bootstrap, first follow `docs/npm-publishing.md` to install the protected
bootstrap environment secret, and select `first-package-bootstrap`. For finalization or later OIDC
publication, first generate the sanitized npm trust artifact using the button-driven workflow
described there and supply its artifact ID. Bootstrap finalization uses execution mode
`resume-publication`: it requires the existing tag to have the same candidate digest,
checksum-inventory digest, artifact IDs, source commit, and keyless signer, then obtains a fresh
mode-specific GitHub authorization and continues without creating or changing the tag.

## Keyless tag verification

The automation signing identity is:

```text
method: sigstore-keyless-gitsign
gitsign: 0.17.1
linux-amd64 SHA-256: 69213a8a0813a151e5a47d0060862952ff833a845d57309dff76f7ba6600abae
certificate identity: https://github.com/alamorre/breakdown.sh/.github/workflows/local-release-ceremony.yml@refs/heads/main
OIDC issuer: https://token.actions.githubusercontent.com
transparency log: https://rekor.sigstore.dev
```

Gitsign creates a short-lived certificate and ephemeral signing key for one operation. No
long-lived private key, maintainer key, or exportable signing secret is configured in GitHub.
GitHub's annotated-tag API does not currently mark Gitsign signatures as `verified`; the release
gate therefore requires identity-aware `gitsign verify`, including certificate claims and Rekor,
and retains the exact signer evidence.

## Retry and recovery

Never delete, move, force-push, recreate, or reuse a release tag. Never rebuild or replace a
qualified candidate. Never overwrite, unpublish, or silently repair public npm or GitHub Release
bytes.

- **Before authorization:** correct the input or repository control and dispatch a new dry run.
- **Authorization rejected or invalid:** the run fails before the tag; dispatch a new run and
  approve its new exact plan digest.
- **Failure before tag push:** rerun the failed job only if no stable tag exists; otherwise stop and
  inspect the exact tag first.
- **Failure after the exact tag exists but before host support:** rerun only the failed job in the
  same ceremony run. The job accepts the tag only when its source, message, signer, ceremony run,
  plan, and authorization all match; it never retags.
- **Host-support failure:** rerun the one correlated child run or the failed parent job; never
  dispatch a second correlated host run. Duplicate correlated runs fail closed.
- **Stable-publication failure before public side effects:** preserve the gate artifact and inspect
  the child run before any rerun.
- **Interrupted first-package bootstrap:** rerun only after confirming already-public 1.0.0
  tarballs byte-match the same immutable candidate; the bootstrap command skips only exact matches.
- **Any npm package or immutable GitHub Release is public:** stop. Preserve all evidence, assess the
  partial public state, and publish any correction under a new SemVer. Do not blindly rerun.

Use **Re-run failed jobs**, not **Re-run all jobs**, after tag creation. Re-running the plan would
correctly fail because the protected tag already exists.

## Secret and evidence boundary

The ceremony retains only sanitized controls, immutable plans, GitHub review identity, artifact
metadata/digests, attestations, signer verification, and publication evidence. It must never print
or retain workflow tokens, npm tokens, private keys, credential-bearing npm configuration, or
secret values. Every retained plan and authorization is rejected if it contains secret-shaped
material.

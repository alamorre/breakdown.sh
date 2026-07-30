# Breakdown Local stable release ceremony

Document kind: Human release-operator guidance

This procedure prepares and publishes the first stable Breakdown Local release without rebuilding
or replacing any qualified artifact. It is deliberately split between local inspection, explicit
human approval, a protected GitHub environment, and automated post-publication verification.

The current `1.0.0-beta.1` corpus is not eligible for this workflow. Complete the ordinary
lockstep version update to a stable full SemVer such as `1.0.0`, regenerate the versioned
documentation, and build a new candidate once before using this ceremony.

## One-time publisher controls

The legal licensor and npm/GitHub publisher must complete these controls personally:

1. Confirm the identity and authority of the legal licensor and publisher.
2. Confirm control of the `@breakdown-sh` npm scope and all three package names.
3. Configure npm trusted publishing for `@breakdown-sh/core`, `@breakdown-sh/cli`, and
   `@breakdown-sh/mcp` against `local-stable-publication.yml`, the
   `alamorre/breakdown.sh` repository, and the `breakdown-local-stable` environment. Permit
   `npm publish`, require two-factor authentication, and disallow token publishing after the
   trusted-publisher path is proven.
4. Enable GitHub release immutability before drafting the release.
5. Create an active repository tag ruleset for `refs/tags/breakdown-local-v*` with both restricted
   updates and restricted deletions, no excluded matching refs, and no bypass actors; retain its
   numeric ruleset ID.
6. Protect the `breakdown-local-stable` GitHub environment with required human reviewers and
   prevent self-review where repository policy permits.
7. Confirm the DCO 1.1 and no-CLA policy, then review every in-scope contribution for DCO sign-off
   and AI-assisted provenance.

These controls are release blockers. A workflow input or checked checkbox cannot create missing
legal authority, npm ownership, or review.

## Qualify exactly one candidate

Dispatch `local-platform-qualification.yml` once at the exact stable source commit, before creating
the release tag, and retain the immutable artifact IDs for:

- `breakdown-local-candidate`;
- `breakdown-platform-evidence-index`.

The workflow builds the candidate once. The platform and host indexers bind every row to its
candidate digest, corpus revision, source commit, exact environment, and retained GitHub Actions
artifact. Do not rerun the build, extract, repack, rename, edit, or rebuild the candidate after
qualification.

Before approval, independently inspect:

- exact dependencies and copied content;
- every artifact-local `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md`;
- secret and private-data scan results;
- the final byte inventory, `SHA256SUMS`, SBOM, and provenance inputs;
- package, security, documentation, traceability, platform, and real-host gates;
- the generated Supported Host JSON and Markdown, ensuring no unindexed row is claimed.

## Sign and protect the source tag

After the candidate and platform index exist, download the candidate and record:

- the candidate digest at
  `platform_conformance.current_build.candidate_digest.content` in its release manifest;
- the SHA-256 of its exact `SHA256SUMS` file;
- the immutable candidate artifact ID;
- the immutable platform-index artifact ID.

Create `breakdown-local-tag-message.txt` with this exact shape and no trailing blank line:

```text
Breakdown Local 1.0.0

candidate-digest-sha256: <candidate digest>
candidate-checksum-inventory-sha256: <SHA-256 of SHA256SUMS>
candidate-artifact-id: <candidate artifact ID>
platform-index-artifact-id: <platform index artifact ID>
```

Create one signed annotated tag at the exact candidate source commit with that message and push it
without force:

```sh
git tag -s -F breakdown-local-tag-message.txt breakdown-local-v1.0.0 <candidate-source-commit>
git tag -v breakdown-local-v1.0.0
git push origin breakdown-local-v1.0.0
```

Never move, delete, recreate, or reuse a release tag or published version. The publication
workflow verifies GitHub's annotated-tag signature result; the exact candidate digest, checksum
inventory, artifact IDs, and source commit in the signed object; and the strict no-bypass
update/deletion ruleset before it accepts the candidate. Pushing the tag does not build another
candidate.

After pushing the signed tag, dispatch `local-host-support.yml` from that tag with the retained
candidate artifact ID and the exact passing guided-host row artifact IDs. Retain the resulting
host-support artifact ID.

## Record the human approval

Download the exact candidate artifact into an otherwise empty directory, then create a
candidate-bound template:

```sh
pnpm local:release:create-approval \
  --candidate /absolute/path/to/candidate \
  --output /absolute/path/to/breakdown-human-release-approval.json
```

The command copies the stable version, candidate digest, source repository, source commit, and tag
from the candidate. It creates every required attestation as `false` and refuses to overwrite an
existing approval. Fill the approver identity and ISO-8601 approval time. Change an attestation to
`true` only after personally reviewing its retained evidence. Do not change the binding fields or
the approval statement.

Encode that one approval JSON for the protected workflow input:

```sh
node -e "process.stdout.write(require('node:fs').readFileSync(process.argv[1]).toString('base64'))" \
  /absolute/path/to/breakdown-human-release-approval.json
```

The final approval must cover legal authority, scope control, DCO/no-CLA and AI provenance,
dependency/copied-content/legal reviews, secret/private-data scans, every automated gate, GitHub
immutability/tag protection, and npm trusted publishing/provenance/signatures. The workflow
validates and attaches the decoded exact JSON, and the final publication attestation protects it.

## Publish once

Dispatch `.github/workflows/local-stable-publication.yml` from the signed tag and supply:

- the candidate artifact ID;
- the passing platform-index artifact ID;
- the authenticated host-support artifact ID;
- the base64-encoded candidate-bound human approval;
- the active tag-ruleset ID.

The protected environment supplies the last human authorization. The workflow:

1. downloads every input by immutable artifact ID;
2. verifies the signed protected tag and deeply reinspects the candidate without rebuilding;
3. validates the candidate-bound human approval and passing evidence indexes;
4. copies every candidate byte unchanged, attaches the exact evidence and support table, and
   creates a final publication manifest plus an outer checksum inventory;
5. attests every publication asset and uploads all assets to a GitHub draft;
6. publishes the three exact `.tgz` files through npm OIDC trusted publishing with provenance and
   the `latest` dist-tag;
7. publishes the draft as an ordinary immutable GitHub Release;
8. downloads and verifies every public GitHub asset, release attestation, npm tarball, `latest`
   channel, registry signature, provenance record, immutable link, and license boundary.

The final post-publication report is retained as
`breakdown-post-publication-inspection-<version>`. The release is not declared complete unless that
report has `status: "passed"`.

## Failure rule

Before npm publication, a failed GitHub draft may be inspected and discarded by an authorized
human. Once any npm package or immutable GitHub Release is public, do not overwrite, unpublish,
rebuild, reuse the version, or rerun blindly. Preserve all evidence, stop the ceremony, assess the
partial public state, and publish any correction under a new SemVer.

Public installation and documentation examples remain pinned to the exact full version even
though the stable registry channel is `latest`.

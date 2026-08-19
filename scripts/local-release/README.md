# Breakdown Local stable release ceremony

Document kind: Human release-operator guidance

This procedure prepares Breakdown Local 1.0 for local testing and eventual stable publication
without rebuilding or replacing qualified artifacts. It keeps the package, legal, signing,
security, provenance, and platform controls intact while deliberately publishing zero Supported
Host claims.

## The 1.0 host policy

Supported Host certification is deferred for Breakdown Local 1.0. The release carries
`supported_hosts: []`; this is an explicit policy, not a passing real-host qualification. An Agent
Host with the mandatory capabilities is Compatible, not Supported. Windows, bare models,
unprovisioned cloud surfaces, and surfaces without the mandatory capabilities are Unsupported.

`.github/workflows/local-host-evidence-capture.yml` (workflow ID `324133712`) is intentionally
`disabled_manually`. It MUST remain disabled and MUST NOT be dispatched during the 1.0 ceremony.
It may be re-enabled only after issue #188 is implemented and accepted. Do not use the preserved
#186 branch or any Codex, Copilot, Claude Code, or other real-host journey for this release.

## One-time publisher controls

The legal licensor and npm/GitHub publisher complete these controls personally:

1. Confirm legal licensor and publisher identity and authority.
2. Confirm control of the `@breakdown-sh` npm scope and all three package names.
3. Configure npm trusted publishing for `@breakdown-sh/core`, `@breakdown-sh/cli`, and
   `@breakdown-sh/mcp` against `local-stable-publication.yml` and the
   `breakdown-local-stable` environment.
4. Enable GitHub release immutability.
5. Protect `refs/tags/breakdown-local-v*` with restricted update and deletion, no exclusions, and
   no bypass actors; retain the ruleset ID.
6. Restrict environment `breakdown-local-stable` (ID `18989155368`) to the exact custom tag
   policy `breakdown-local-v*`, disable administrator bypass, and configure no required-reviewer
   rule.
7. Confirm DCO 1.1 and the no-CLA policy, then review AI-assisted provenance.

`alamorre` is permanently the sole maintainer, approver, and publisher. No collaborator, alternate
account, or automation identity is added to manufacture separation of duties. The signed approval,
exact artifact bindings, immutable identities, no-bypass settings, and retained evidence are
compensating controls; they are not independent review.

The stable workflow needs read access to repository administration settings so it can re-read
immutable releases. It first uses the ephemeral `GITHUB_TOKEN`; if the repository does not grant
that token the required read, configure environment secret `RELEASE_CONTROL_READ_TOKEN` as a
fine-grained token limited to this repository with read-only Administration, Actions, and Metadata
permissions. The token is never retained or used for npm publication.

These controls remain real release blockers. The deferred host policy changes none of them.

## Build and qualify exactly one candidate

Regenerate and check versioned documentation before building:

```sh
pnpm local:docs:generate
pnpm local:docs:check
```

Dispatch `local-platform-qualification.yml` once at the exact stable source commit. Retain the
immutable artifact IDs for `breakdown-local-candidate` and
`breakdown-platform-evidence-index`. That workflow builds the candidate once and qualifies the
maintained Linux glibc x64/arm64 and macOS x64/arm64 tuples.

If any candidate artifact, canonical skill, normative contract, schema, or generated documentation
byte changes, discard the old candidate evidence, build one new candidate from the resulting exact
source, and rerun all maintained Linux/macOS platform qualification before publication. Never
extract, repack, rename, edit, or rebuild a qualified candidate.

Before approval, independently inspect exact dependencies, copied content, notices, secret/private
data scans, the final byte inventory, `SHA256SUMS`, SBOM, provenance inputs, package/security/docs/
traceability/platform gates, and the zero-claim host policy.

## Sign and protect the source tag

Immediately before creating the tag, retain a read-only sanitized snapshot and require it to pass:

```sh
pnpm local:release:verify-github-controls \
  --phase pre-tag \
  --output /absolute/path/to/breakdown-github-release-controls-pre-tag.json
```

The command fails unless release immutability is enabled; environment ID `18989155368` has only the
exact `breakdown-local-v*` tag policy and no administrator bypass or reviewer rule; ruleset `20015652`
has exactly the protected ref, update/deletion restrictions, no exclusions or bypass actors, and
`current_user_can_bypass: never`; `alamorre` remains the only direct collaborator; and no stable tag
or release already exists. Do not create the tag from a stale or failed snapshot.

Record the candidate digest from its release manifest, the SHA-256 of `SHA256SUMS`, and the two
immutable artifact IDs. Create a signed annotated tag message with this exact shape and no trailing
blank line:

```text
Breakdown Local 1.0.0

candidate-digest-sha256: <candidate digest>
candidate-checksum-inventory-sha256: <SHA-256 of SHA256SUMS>
candidate-artifact-id: <candidate artifact ID>
platform-index-artifact-id: <platform index artifact ID>
```

Create and verify `breakdown-local-v1.0.0` at the exact candidate source commit, then push it
without force. Never move, delete, recreate, or reuse a release tag or published version.

## Generate and attest the empty host-support set

After pushing the signed tag, dispatch `local-host-support.yml` from that tag with only the exact
candidate artifact ID. The workflow:

1. verifies that workflow ID `324133712` is still `disabled_manually`;
2. downloads the immutable candidate;
3. creates `breakdown-host-support-index.json` with `policy.state: "deferred"`, zero evidence rows,
   and `supported_hosts: []`, bound to the candidate digest, corpus, source commit, and tag;
4. deterministically generates JSON and Markdown support material;
5. attests the exact index on a GitHub-hosted runner; and
6. uploads the index, generated support, and Sigstore bundle as `breakdown-host-support`.

Retain that artifact ID. A missing artifact is not equivalent to deliberate deferral. Do not add
evidence rows or real-host artifact inputs to this ceremony.

## Record the human approval

Download the exact candidate into an otherwise empty directory and create the candidate-bound
template:

```sh
pnpm local:release:create-approval \
  --candidate /absolute/path/to/candidate \
  --output /absolute/path/to/breakdown-human-release-approval.json
```

Fill `approver.github_login` with `alamorre`, the publisher identity, and a canonical UTC ISO-8601
approval time. Set an attestation to `true` only after personally
reviewing its retained evidence. In particular,
`zero_claim_deferred_host_policy_reviewed` affirms that the approver reviewed and accepted the 1.0
policy with `supported_hosts: []`; it does not claim a host journey ran or passed. Do not alter the
candidate binding or approval statement.

Sign the exact completed JSON with the publisher-controlled SSH signing key registered in GitHub.
The namespace is part of the signature and must not change:

```sh
ssh-keygen -Y sign \
  -f "$(git config --get user.signingkey)" \
  -n breakdown-local-release \
  /absolute/path/to/breakdown-human-release-approval.json

pnpm local:release:verify-approval \
  --approval /absolute/path/to/breakdown-human-release-approval.json \
  --signature /absolute/path/to/breakdown-human-release-approval.json.sig \
  --output /absolute/path/to/breakdown-human-release-approval-verification.json
```

The verification command fetches `alamorre`'s current GitHub SSH signing keys and fails unless one
authenticates the exact approval bytes. Retain the approval, detached signature, and verification
record. Editing the JSON after signing invalidates the approval.

Encode the exact JSON and signature for the two protected workflow inputs:

```sh
node -e "process.stdout.write(require('node:fs').readFileSync(process.argv[1]).toString('base64'))" \
  /absolute/path/to/breakdown-human-release-approval.json
node -e "process.stdout.write(require('node:fs').readFileSync(process.argv[1]).toString('base64'))" \
  /absolute/path/to/breakdown-human-release-approval.json.sig
```

## Publish once

Dispatch `local-stable-publication.yml` from the signed tag and supply the candidate artifact ID,
passing platform-index artifact ID, authenticated host-support artifact ID, encoded human approval,
and encoded approval signature. Ruleset ID `20015652` is fixed by policy and is not caller input.

Before publishing, the workflow re-verifies the approval signature against GitHub, every approval
binding and attestation, repository immutability, the exact environment and ruleset settings,
administrator/ruleset no-bypass state, sole-maintainer identity, GitHub-hosted runner, npm OIDC
subject, signed tag, immutable artifact IDs, and all candidate/platform/host-policy digests. It also
rejects a missing or unattested host index; candidate, corpus, source, or tag mismatch; any deferred
evidence row or Supported Host claim; altered generated support; or an approval that does not accept
the zero-claim policy. The workflow uploads the sanitized controls, approval, signature,
verification, tag evidence, and runner/OIDC identity before its first irreversible step. It then
preserves candidate bytes, attaches all evidence, writes a publication manifest and release notes
containing `supported_hosts: []`, attests every asset, publishes the exact npm tarballs and immutable
GitHub Release, and verifies every public byte and trust record.

The final report is retained as `breakdown-post-publication-inspection-<version>`. The release is
not complete unless it has `status: "passed"` and confirms zero Supported Hosts.

## Failure rule

Before npm publication, an authorized human may inspect and discard a failed GitHub draft. Once any
npm package or immutable GitHub Release is public, do not overwrite, unpublish, rebuild, reuse the
version, or rerun blindly. Preserve all evidence, stop, assess the partial public state, and publish
any correction under a new SemVer.

# npm first-package bootstrap and trusted publishing

Document kind: Contributor/operator guidance

This runbook covers the one-time creation of the three Breakdown Local npm package records and the
OIDC-only path used after they exist. It does not authorize an operator to substitute, rebuild, or
publish a different candidate. The first public npm bytes are the final, qualified 1.0.0 tarballs.

The confirmed npm scope owner and publisher is the human `alamorre` account, with two-factor
authentication enabled. Never record a token value, recovery code, private maintainer email, npm
session, or other credential in repository files, workflow artifacts, logs, approvals, or release
evidence.

## Why bootstrap is a separate protected run

npm requires a package to exist before `npm trust` can configure its trusted publisher. The stable
workflow therefore uses two protected runs for 1.0.0:

1. `first-package-bootstrap` creates only the missing package records from the exact candidate,
   retains attested evidence, and stops without creating a GitHub Release.
2. After the human completes the credential-to-OIDC transition, `finalize-bootstrap` verifies the
   existing public bytes and all controls, then creates the immutable GitHub Release without
   republishing npm.

All later versions use `oidc-trusted-publishing` and make no npm token available to the workflow.
This follows npm's documented [trusted-publisher model](https://docs.npmjs.com/trusted-publishers/),
[`npm trust` configuration](https://docs.npmjs.com/cli/v11/commands/npm-trust/), and
[publishing 2FA controls](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/).

## 1. Prepare the first-package credential

Only after the exact 1.0.0 candidate, signed tag, platform evidence, empty host-support policy, and
other stable-release inputs are ready, create one npm granular access token with exactly these
settings:

| Setting                 | Required value                                               |
| ----------------------- | ------------------------------------------------------------ |
| Packages and scopes     | `@breakdown-sh` only                                         |
| Package permission      | Read and write                                               |
| Organization permission | No access                                                    |
| Bypass 2FA              | Enabled only because this is the protected bootstrap publish |
| Expiration              | At most 24 hours                                             |

The human publisher must create it while authenticated with 2FA. Store it only as environment
secret `NPM_FIRST_PACKAGE_TOKEN` in `breakdown-local-stable`; never place it in a repository secret,
shell history, file, approval, or artifact. npm documents the granular-token controls in
[About access tokens](https://docs.npmjs.com/about-access-tokens/).

Create and sign a fresh approval using:

```sh
pnpm local:release:create-approval \
  --candidate /absolute/path/to/candidate \
  --npm-publication-mode first-package-bootstrap \
  --output /absolute/path/to/breakdown-human-release-approval.json
```

Dispatch `local-stable-publication.yml` from the protected signed tag with mode
`first-package-bootstrap`, the normal candidate/platform/host/approval inputs, and this exact
destructive confirmation:

```text
CREATE EXACT @breakdown-sh/core @breakdown-sh/cli @breakdown-sh/mcp 1.0.0
```

The workflow checks that every name is absent, or that an interrupted prior attempt already
published the exact 1.0.0 candidate bytes. It refuses a claimed name whose 1.0.0 record is absent.
It publishes missing records in `core`, `cli`, `mcp` order with public access, `latest`, and
provenance; downloads and byte-compares all three; audits registry signatures and provenance; then
attests and uploads `breakdown-npm-first-package-bootstrap-<run>-<attempt>`. It does not create a
draft or final GitHub Release.

If the run stops after publishing only some packages, preserve its logs and rerun only after
confirming the same signed tag and immutable candidate inputs. The bootstrap command skips an exact
already-present 1.0.0 record and still refuses any mismatch. Never unpublish, overwrite, rebuild,
or choose another 1.0.0 tarball.

## 2. Replace the credential with exact OIDC trust

After all three records exist, configure each package separately with npm CLI 11.15.0 or newer:

```sh
npm trust github @breakdown-sh/core \
  --repo alamorre/breakdown.sh \
  --file local-stable-publication.yml \
  --environment breakdown-local-stable \
  --permission createPackage

npm trust github @breakdown-sh/cli \
  --repo alamorre/breakdown.sh \
  --file local-stable-publication.yml \
  --environment breakdown-local-stable \
  --permission createPackage

npm trust github @breakdown-sh/mcp \
  --repo alamorre/breakdown.sh \
  --file local-stable-publication.yml \
  --environment breakdown-local-stable \
  --permission createPackage
```

For every package, set publishing access to require 2FA and disallow token publication:

```sh
npm access set mfa=publish @breakdown-sh/core
npm access set mfa=publish @breakdown-sh/cli
npm access set mfa=publish @breakdown-sh/mcp
```

Then revoke the granular bootstrap token in npm and delete environment secret
`NPM_FIRST_PACKAGE_TOKEN` from GitHub. Do not merely rotate or empty either credential.

From a local session authenticated as the human publisher, with `NODE_AUTH_TOKEN` and `NPM_TOKEN`
unset, capture a sanitized inspection:

```sh
pnpm local:release:inspect-npm-trust \
  --output /absolute/path/to/breakdown-npm-trusted-publishing.json
```

The inspector fails unless the registry is public, the account belongs to `breakdown-sh`, every
package is public and maintained by that account, and every package has exactly the repository,
workflow, environment, and `createPackage` trust above. Its output omits token material, private
maintainer emails, and registry trust IDs. Review the JSON before encoding it for a workflow input.

## 3. Verify and finalize 1.0.0

Create and sign a new approval, this time using `--npm-publication-mode finalize-bootstrap`. Dispatch
the same protected workflow from the same signed tag with:

- mode `finalize-bootstrap`;
- the artifact ID from the successful bootstrap run;
- base64-encoded sanitized trusted-publishing JSON; and
- the normal immutable candidate, evidence, and fresh signed-approval inputs.

The workflow verifies the bootstrap artifact's Sigstore attestation against the exact repository,
workflow, tag, and commit; rejects the still-present bootstrap environment secret; validates the
fresh human attestations that token publication is disabled and the credential is revoked; and
byte-compares every public npm tarball with the qualified candidate. Only then can it create and
finalize the immutable GitHub Release. This run performs no `npm publish` command.

The GitHub control-read credential used by this gate needs read-only Environments permission in
addition to the permissions listed in the stable release runbook. The environment-secrets API
returns names and timestamps, not secret values; the retained gate artifact does not include that
API response.

## 4. Publish later versions with OIDC only

For every later release, use a fresh signed approval with mode `oidc-trusted-publishing` and provide
a fresh sanitized trust inspection. The workflow refuses npm token environment variables and
publishes all three exact tarballs with GitHub Actions OIDC provenance. Post-publication inspection
again compares public bytes and audits registry signatures and provenance.

If any trusted-publisher identity changes, package ownership becomes ambiguous, token publication
is re-enabled, the bootstrap secret reappears, or retained evidence cannot be authenticated, stop
the release. Repair the control state and capture fresh evidence; do not bypass the gate.

# Contributing to Breakdown Local

Use Node 24 and pnpm 11.3.0. Run `pnpm install && pnpm check` from the repository root.
No hosted credentials or environment file is required. See the [architecture map](docs/architecture.md)
and [Local development guide](docs/local-development.md).

## Developer Certificate of Origin

This project adopts the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
(DCO 1.1). Every commit contributed to this repository must include a `Signed-off-by` trailer. By
adding that trailer, you certify the contribution under DCO 1.1.

Create the trailer with Git's sign-off option:

```bash
git commit --signoff
```

The resulting commit message must contain a trailer matching the identity used for the
contribution:

```text
Signed-off-by: Your Name <you@example.com>
```

A DCO sign-off records the certification; it is not a cryptographic commit signature.

## No Contributor License Agreement for the MVP

No Contributor License Agreement (CLA) is required for the MVP. Contributions are accepted under
the applicable project license or licenses and the DCO 1.1 certification above.

## Prepare a Change

Keep changes focused and update relevant documentation and tests with the implementation. Follow
the setup and validation guidance in [Local Development](docs/local-development.md), and run the
focused checks for the files you changed before opening a pull request.

Contributors are responsible for reviewing AI-assisted work before submission and for ensuring
that they have the right to submit all contributed code, documentation, and other content.

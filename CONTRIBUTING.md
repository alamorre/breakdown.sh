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

Keep changes focused. Update affected usage guidance, decisions, contracts, and behavior tests;
a private refactor needs no prose companion that mirrors its implementation. Follow the setup
and validation guidance in [Local Development](docs/local-development.md), and run the focused
checks for the files you changed before opening a pull request.

Contributors are responsible for reviewing AI-assisted work before submission and for ensuring
that they have the right to submit all contributed code, documentation, and other content.

## Implementation and documentation

Make implementation understandable through domain names, explicit types, cohesive module
interfaces, and meaningful behavior tests. Improve confusing code when practical. Use comments
to explain non-obvious rationale, constraints, and invariants.

Authored docs add product intent, roadmap, decisions and tradeoffs, user/contributor instructions,
and necessary semantic contracts. Keep useful setup, resume, and architecture navigation concise;
link to historical issues or PRs for completed implementation details. Avoid prose copies of
internal algorithms, call flows, type shapes, or value tables with an existing authoritative source.
Generate repetitive reference facts from their [existing owners](docs/reference-generation.md)
where supported.

Choose updates by what changed:

- Internal implementation changes belong in code and behavior tests; update prose only when usage,
  rationale, or a contract is affected.
- Public semantic changes update the [normative owner](local/contracts/README.md) and independently
  reviewed compatibility expectations. Implementation and generated reference are not normative;
  never derive conformance oracles from the implementation they check.
- Product decisions and tradeoffs belong in [ADRs](docs/adr/); planned work and priorities belong in
  the [roadmap](docs/roadmap.md).

Preserve historical versioned output and vendored upstream material. Follow
[reference ownership and regeneration guidance](docs/reference-generation.md) when updating current
generated output, and use the existing link/drift checks and normal PR checks.

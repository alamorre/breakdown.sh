# Use agent-operated Supported Host qualification

Issue #186 supersedes the interim human-usability gate resolved in #140 for
Supported Host qualification. The product owner’s first manual product
interaction is the final Breakdown Local 1.0 release, not a pre-release host
journey.

## Decision

Supported Host qualification is fully agent-operated. GitHub-hosted Linux and
macOS jobs provision real CLI Agent Hosts, execute the canonical 13-stage
journey under a reviewed bounded authorization manifest, retain declared
sanitized visible evidence, and hand that evidence to a distinct fresh review
agent. Deterministic validators bind roles, sessions, candidate bytes, source,
schemas, digests, rubric gates, hostile-content safety, and the no-publication
boundary.

The passing host index is created and attested at the immutable candidate/source
boundary before a stable tag. Final publication verifies and binds those exact
unchanged bytes to the protected signed tag.

## Consequences

- Agent evidence cannot populate legacy human-review fields, a human identity,
  or a human attestation.
- Project content, hostile Inputs, model prose, and repository instructions
  cannot expand qualification authority.
- Qualification requires no product-owner action or self-hosted ingress runner.
- Generated support discloses independent agent-operated review and does not
  claim human usability research.
- Human legal identity, signing, npm ownership, provenance review,
  protected-environment approval, and final publication controls remain human
  responsibilities under the release contract.

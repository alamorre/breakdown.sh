# Use durable agent-operated release operations

Status: Superseded by issue #269

This ADR is retained as historical context. The release controller and recovery workflows it
describes have been removed.

## Context

The v1.0.0 ceremony exposed three workflow-snapshot defects only after protected execution: the
annotated tag used the commit verifier, recovery assumed `rg`, and stable publication made the same
undeclared `rg` assumption. Recovery run `33427730934` also dispatched child `33428076790` and
immediately searched run listings before GitHub had populated the child's input-derived name and
actor metadata. Treating each defect as an isolated rerun risks stale code, duplicate children, or
publication after an ambiguous partial effect.

## Decision

A release is one immutable operation identified by the SHA-256 of its protected tag and tag object,
candidate source/content/checksum digests, ceremony run, retained artifact IDs, authorization
digest, npm mode, and destructive confirmation. Workflow implementation SHAs identify attempts,
not operations. Every successor retains its predecessor run and may use a newer reviewed SHA only
after the predecessor completed before public effects, immutable inputs still match, public records
remain absent, and cleanup passed.

Repository-owned Node modules now own operation planning, public-state classification, signed-tag
bindings, dispatch-response validation, eventual-consistency correlation, attempt classification,
diagnostic redaction, and policy finalization. Live recovery dispatches once, accepts only the run
ID and URLs in GitHub's versioned dispatch response, polls that ID until durable metadata is
available, and never calls a rerun endpoint. Any public or indeterminate state is terminal.

The agent entry point dispatches and monitors a no-secret rehearsal from an exact development SHA.
The rehearsal runs the shared gates through the final pre-publication boundary with checked-in
GitHub, npm, artifact, tag, ruleset, migration, and correlation fixtures. Its child environment has
a minimal `PATH` containing only pinned Node 24.13.0. The live workflows have an explicit tool
inventory; `rg` is prohibited.

For the one-time v1 recovery, the local controller uses the operator's current GitHub CLI
authentication with Actions-write and Administration-write access, without storing it or copying
it into GitHub Actions. It changes the sole stable environment policy from the tag pattern to exact
`main` only for the bounded authorized attempt, never installs simultaneous policies, and restores
and verifies the sole tag policy in a `finally` path. An independent idempotent finalizer handles
interrupted controllers. Unexpected policy state blocks mutation and all later attempts.

## Consequences

- `32418990076`, `33427730934`, and child `33428076790` are retained predecessors under one
  operation; none is rerun.
- A pre-publication defect needs a patch and successor attempt, not a new release issue.
- Correlation delay cannot cause a second dispatch.
- Cleanup failure, mismatched lineage, duplicate or concurrent children, a stale SHA, an unknown
  boundary, or ambiguous public state requires human review.
- The controller cannot approve an environment, authorize publication, move the tag, rebuild the
  candidate, publish a different byte, alter deployment `6008739973`, or continue after a public
  effect. Review/merge and explicit live authorization remain separate human decisions.

# Hashing and Derived State Contract

Document kind: Authored normative contract

Contract version: 1.0.0-beta.1

Requirement namespaces: `REQ-HASH`, `REQ-STATE`

This document owns digest, Node Context, selection, and derived-state meanings.
Literal vectors in the public corpus are independently reviewed authorities;
implementation-produced expectations are not normative.

### REQ-HASH-001

Every digest MUST use SHA-256 rendered as exactly 64 lowercase hexadecimal
characters. A file digest MUST cover raw bytes from offset zero through EOF
without decoding, newline conversion, Unicode normalization, or other
transformation.

### REQ-HASH-002

Workflow Snapshot comments, mapping order, BOM, newline form, whitespace, and
trailing bytes, and Result JSON whitespace and property order, MUST affect raw
file digests. Absolute roots, mtimes, inodes, permissions, and operating-system
metadata MUST NOT affect them.

### REQ-HASH-003

`context_sha256` MUST be SHA-256 over the UTF-8 RFC 8785 JCS serialization of
the fixed `breakdown.node-context.v1` preimage. Implementations MUST match the
literal canonical-preimage bytes and digests in the public hash vectors.

### REQ-HASH-004

The Node Context preimage MUST include Run ID; every execution-significant core
Node Definition field and Input Binding; resolved Workflow Input identity,
description, path, and raw digest; and exact Selected Predecessor attempt,
paths, and raw digests. Specified absent fields MUST normalize only to `{}` or
`null`.

### REQ-HASH-005

The Node Context preimage MUST exclude extensions, unrelated nodes, authored
position, resolved-away defaults, timestamps, Executor/model/provider facts,
status/problem/outcome, executing attempt, candidate Result, host, transport,
environment, absolute root, and filesystem metadata.

### REQ-HASH-006

The public hash corpus MUST provide reviewed literal vectors for empty, binary,
BOM, LF, CRLF, and trailing-newline raw files; Workflow comment/order changes;
raw-versus-semantic JSON; RFC 8785 ordering, numbers, escaping, Unicode, and
surrogates; absent-field normalization; and every included and excluded Node
Context factor.

### REQ-STATE-001

The complete Run MUST be validated before state is derived or mutation is
allowed. Each stored Node Context MUST be recomputed from its own exact
references and every successful JSON sidecar MUST satisfy its Data Contract.

### REQ-STATE-002

For each node in deterministic topological and authored order, state derivation
MUST compute the expected Node Context and select the greatest-attempt valid
succeeded StepArtifact matching it. Filenames, timestamps, mtimes, directory
order, and completion order MUST NOT influence selection.

### REQ-STATE-003

A node MUST be `complete` when it has a Selected Result matching its current
Node Context, `runnable` when it lacks one and every Predecessor is complete,
and `blocked` when at least one Predecessor lacks a Selected Result. A runnable
node with prior successes but no context match MUST report `stale: true`.

### REQ-STATE-004

A Run MUST be `invalid` on any normative error, `incomplete` when valid and any
node is not complete, and `complete` only when every node is complete. An
invalid Run MUST expose no authoritative scheduling state and MUST permit no
mutation.

### REQ-STATE-005

Ordinary resume MUST reuse exact-context successes indefinitely, attempt each
prepared runnable node at most once per explicit invocation, continue
independent branches after another branch fails, and perform no hidden retry.

### REQ-STATE-006

Refresh MUST target exactly one complete node. A successful refresh MUST select
the higher attempt and stale every consuming descendant by Result identity even
when Result bytes match. A non-successful refresh MUST preserve the prior
Selected Result and descendant state.

### REQ-STATE-007

Editing the live Workflow Definition MUST affect only new Runs. Workflow Input
mutation MUST make an existing Run non-resumable until the exact path and bytes
are restored. Mutation of a committed artifact MUST be an integrity error, and
work MUST NOT cross Run IDs.

### REQ-STATE-008

An unchanged whole-project copy or move MUST remain resumable when all
contracted relative paths and bytes remain intact on a supported filesystem.
Divergent copies are forks; conflicting identities MUST invalidate an attempted
merge.

### REQ-STATE-009

Inspection MUST report next attempts, every Selected Terminal Result, stale and
non-success history, and node and Run state in deterministic order without
repairing or finalizing the Run.

### REQ-STATE-010

The public state corpus MUST cover selection by attempt, success followed by
non-success, refresh and staleness, exact resume, independent failure,
definition/Input/artifact edits, copies, divergent collisions, every node and
Run state, next attempts, and Terminal Results.

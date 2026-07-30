# Core Operation Contract

Document kind: Authored normative contract

Contract version: 1.0.0

Requirement namespace: `REQ-OPS`

This document owns operation meanings and invariants. Request, Work Packet,
Candidate Outcome, and operation-value shapes are owned by the matching machine
schemas; enumerated operation and failure facts are owned by
`../catalogs/operations.v1.json`.

### REQ-OPS-001

Breakdown Local MUST consist of a shared deterministic core, canonical CLI, and
optional local MCP adapter. Dependency direction MUST be CLI → core and MCP →
core only. The core MUST remain independent of Next.js, React, authentication,
databases, provider SDKs, browser code, Git, and the MCP SDK.

### REQ-OPS-002

Internally, domain values MUST remain beneath formats, hashing, and secure
storage, with operations composing those facilities behind one dispatcher.
Parsing, hashing, graph, secure-store, and publication details MUST remain
private; package-root access and acyclic package direction MUST be enforced.

### REQ-OPS-003

Every maintained adapter MUST call `operate(request, trustedContext)` and
receive either `{ ok: true, value }` or a structured failure with kind, code,
message, and diagnostics. Adapter code MUST NOT reimplement core behavior.

### REQ-OPS-004

The dispatcher operations are exactly `validate_workflow`, `create_run`,
`inspect_run`, `prepare_work`, `read_work_input`, and `submit_candidate` in
that order. The operation request schema and operations catalog are the
machine authorities for their variants and enumerated facts.

### REQ-OPS-005

`validate_workflow` MUST read the exact fixed Workflow Definition and perform
pure format, identifier, path, Data Contract, reference, graph, limit, and
ordering validation without a durable write.

### REQ-OPS-006

`create_run` MUST canonicalize the explicit root, resolve every Workflow Input
from an override or default, securely read and hash exact bytes, preserve the
exact Workflow Definition, create Run identity and manifest, and atomically
publish a new Run.

### REQ-OPS-007

`inspect_run` MUST validate every normative Run record and source Workflow
Input, recompute Node Context, selection, state, resumability, next attempts,
Terminal Results, locks, and ordered diagnostics, and MUST NOT repair or infer
a latest Run.

### REQ-OPS-008

`prepare_work` MUST begin from valid inspected state, apply ordinary resume or
one-complete-node refresh intent, and return no more than the requested fixed
maximum of deterministic Work Packets without a durable claim or attempt.

### REQ-OPS-009

`read_work_input` MUST securely return exactly one complete Input identified by
a Work Packet: either Workflow Input bytes or predecessor Markdown plus
conditional JSON bytes. In-process values are bytes; CLI and MCP automation
MUST use the cataloged base64 fields.

### REQ-OPS-010

`submit_candidate` MUST lock and re-inspect, verify eligibility, Node Context,
attempt, and refresh base, validate the Candidate Outcome and limits, allocate
the next attempt, generate authoritative metadata, and atomically publish the
StepArtifact.

### REQ-OPS-011

Failure kinds and codes MUST be limited to the enumerations in the operations
catalog. Clients MUST branch on kind and code, not message prose. Messages are
bounded, sanitized, and non-normative.

### REQ-OPS-012

A `breakdown.work-packet.v1` MUST bind one presently eligible node's Run,
intent, preparation time, expected next attempt, Node Context, optional refresh
base, execution-significant Node Definition, immediate Input descriptors,
separate untrusted-content policy, Result requirements, fixed limits, and
submission identity.

### REQ-OPS-013

A Work Packet MUST exclude Input contents, unrelated ancestors and siblings,
credentials, model/provider settings, host commands, executable strings,
extensions as authority, final publication paths, and an allocated attempt.

### REQ-OPS-014

A `breakdown.candidate.v1` MUST echo the packet submission identity and contain
one status, Executor metadata, required Markdown, JSON exactly for contracted
success, and a problem exactly for non-success. It MUST NOT contain
authoritative frontmatter, path, time, hash, or attempt fields.

### REQ-OPS-015

Resume preparation MUST accept a limit of 1–3 with a default and hard maximum
of 3. Refresh preparation MUST identify exactly one complete node and have
limit 1. Selection MUST follow deterministic topology and authored order.

### REQ-OPS-016

Preparation is neither a claim nor history. Multiple callers MAY execute
duplicate packets, but submission MUST accept only a candidate that remains
eligible with an unchanged context and expected attempt. Orchestrators MAY
execute three independent packets concurrently but MUST serialize submissions
and MUST NOT hide retries.

### REQ-OPS-017

Cancellation MUST be a trusted invocation signal rather than Run state and
MUST obey the publication critical-section contract. The core MUST impose no
provider/model token, network, or Executor duration limit and MUST NOT invoke an
Executor itself.

### REQ-OPS-018

Shared public traces MUST exercise all six operations through core-only,
CLI-only, MCP-only, CLI→MCP, and MCP→CLI sequences and compare decoded values,
structured failures, ordering, limits, and exact on-disk effects.

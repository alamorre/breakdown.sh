# Security, Storage, and Publication Contract

Document kind: Authored normative contract

Contract version: 1.0.0-beta.1

Requirement namespaces: `REQ-SEC`, `REQ-PUB`

This document owns the deterministic core's enforceable security and storage
boundary. It does not grant Run Authority or make a safety claim for a
privileged Executor.

### REQ-SEC-001

Every operation MUST require one explicit selected project root and MUST
canonicalize it before processing project-controlled operation data. A symlink
in the supplied root route MAY resolve during selection; cwd, environment,
repository discovery, MCP Roots, and adjacent files MUST NOT select authority.

### REQ-SEC-002

No descendant contract path may traverse a symlink, junction, reparse or
redirecting entry, mount alias, hard-link alias, or ambiguous case/Unicode
alias. Containment MUST use filesystem identity and semantics rather than
string-prefix checks.

### REQ-SEC-003

Workflow Inputs MUST be existing readable regular files. Directories, devices,
FIFOs, sockets, links, and other special entries MUST be rejected. A lazy read
MUST open without following links, recheck identity, type, and containment,
hash the bytes actually read, compare the recorded digest, and enumerate no
undeclared sibling context.

### REQ-SEC-004

Core-created state MUST be confined to contracted Run paths and private
Breakdown-owned temporary and lock locations beneath the selected root. Every
final path component MUST derive only from validated identifiers.

### REQ-SEC-005

Breakdown-owned directories and files MUST be current-user-only by default:
`0700` and `0600` on POSIX and the closest account-only ACL elsewhere.
Existing Workflow Input permissions MUST NOT be changed, and encryption at
rest MUST NOT be implied.

### REQ-SEC-006

Correctness is supported only on local filesystems with reliable exclusive
create, private permissions, flush, and same-filesystem atomic no-replace
rename. Known NFS, SMB/CIFS, remote mounts, and detectable concurrently
synchronized directories MUST be rejected. No claim is made for an
undetectable synchronization layer.

### REQ-SEC-007

The core MUST NOT evaluate templates, import or execute project files, source
shell or environment files, install dependencies, invoke hooks, honor
project-provided command or tool policy, load adjacent instructions, inspect
Git, contact a network, invoke a model, spawn an agent, or execute project
code.

### REQ-SEC-008

Credentials MUST NOT enter Workflow Definitions, Work Packets, Results,
diagnostics, logs, core-added extensions, or core-created child environments.
An explicitly selected Workflow Input may contain sensitive bytes and is
disclosed only through its exact validated Work Packet Input.

### REQ-SEC-009

Human output MUST escape terminal controls and active rich content; machine
output MUST remain structured; stderr and diagnostics MUST remain bounded.
Project content MUST NOT become a path, command, environment name, tool choice,
approval, Run Authority grant, or publication instruction.

### REQ-SEC-010

The exact resource values in `../catalogs/limits.v1.json` are normative and
MUST apply identically through core, CLI, and MCP. Limits MUST NOT truncate
accepted content. Exhaustion MUST fail `resource_limit/limit_exceeded` without
a partial durable record.

### REQ-SEC-011

Prompts, Inputs, Results, metadata, extensions, filenames, and other project
content MUST be treated as untrusted data. Work Packets MUST keep core policy,
task, Input descriptors, Result requirements, and submission identity
structurally separate. Only the user or Agent Host may grant Run Authority.

### REQ-SEC-012

“Local” MUST mean directory-native storage and user-controlled execution, not
offline inference. Breakdown itself MUST add no telemetry, upload, cloud
synchronization, credential discovery, Git behavior, or publication effect;
the chosen Executor/provider may have independent privacy behavior.

### REQ-SEC-013

Security conformance MUST use real temporary local filesystems and MUST cover
traversal, absolute, drive, UNC, URI, expansion, link, junction, reparse,
mount, alias, and replacement races; special files; private permissions;
overwrite prevention; hostile content and controls; and forbidden process,
network, Git, environment, and credential behavior.

### REQ-SEC-014

Every meaningful fixed boundary MUST be exercised at limit−1, limit, and
limit+1 and MUST prove exact acceptance, no truncation, the stable failure, and
absence of a partial commit.

### REQ-PUB-001

Run creation MUST privately stage and flush `run.md`, the Workflow Snapshot,
and `steps/`, then publish the complete Run with one atomic no-replace
directory rename. A final destination MUST never be overwritten.

### REQ-PUB-002

Step submission MUST stage within the destination filesystem, publish a JSON
sidecar first when required, and publish Markdown last as the logical commit
marker. A visible committed Markdown record MUST always be complete and
contextually valid or invalidate the Run.

### REQ-PUB-003

One exclusive per-Run writer lock at
`.breakdown/locks/runs/<run-id>.lock` MUST coordinate mutation. Lock contents
MUST include an opaque cryptographic lock ID and MAY include diagnostics, but
age and process ID MUST NOT grant authority.

### REQ-PUB-004

A lock contender MUST fail immediately with `conflict/run_locked`. Read-only
operations MUST remain available. Recovery MUST require explicit confirmation
that the old writer stopped and the exact observed lock ID; a missing or
changed identity MUST fail `lock_recovery_mismatch`.

### REQ-PUB-005

Submission MUST acquire the writer lock, revalidate the complete Run,
eligibility, Node Context, expected attempt, and refresh base, and allocate the
next attempt only while locked. Duplicate preparation MUST remain harmless
until submission.

### REQ-PUB-006

Invocation cancellation before the publication critical section MUST publish
nothing and consume no attempt. Once final publication begins, cancellation
MUST be deferred through the Markdown commit marker. An explicit `cancelled`
Candidate Outcome MUST remain a distinct committed StepArtifact.

### REQ-PUB-007

Deterministic clock, entropy, secure-store, and publication fault injection MAY
exist only as internal test controls. They MUST NOT become public pluggable
strategies or alter production contract shapes.

### REQ-PUB-008

Publication conformance MUST inject faults at every filesystem boundary and
terminate real subprocesses before and after logical commit. Each observation
MUST show either no committed record or exactly one complete committed record,
never a partial authoritative record.

### REQ-PUB-009

Every maintained platform tuple MUST run at least 100 retained-seed
same-opportunity races and 100 retained-seed independent eligible-submission
races. A flake is a failure, and failure evidence MUST retain seed, operation
facts, and reproduction data.

### REQ-PUB-010

After a lost submission response, exact Run inspection MUST reveal whether the
attempt committed. Recovery MUST use inspection and MUST NOT replay a
submission speculatively.

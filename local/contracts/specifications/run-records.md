# Run and StepArtifact Contract

Document kind: Authored normative contract

Contract version: 1.0.0-beta.1

Requirement namespace: `REQ-RUN`

This document owns Run, Run Manifest, Workflow Snapshot, StepArtifact, and
Result meanings and invariants. Their public fields are owned by the schemas in
`../schemas/`.

### REQ-RUN-001

A Run MUST be one append-only history at `outputs/<run-id>/` containing an
immutable `run.md`, the byte-exact Workflow Snapshot `breakdown.yaml`, and an
immutable `steps/` directory. Editing the live Workflow Definition MUST NOT
rewrite an existing Run.

### REQ-RUN-002

A Run ID MUST be
`<UTC-start-compact-ms>--<workflow-id>--<random-suffix>`, where the timestamp is
`YYYYMMDDTHHmmss.sssZ` and the suffix is 12 lowercase RFC 4648 base32
characters produced from cryptographic entropy.

### REQ-RUN-003

A StepArtifact identity MUST be `(run_id, node_id, attempt)`. Attempts MUST be
positive base-10 integers without leading zeroes, begin at 1 for each node, and
remain contiguous across every committed status and Node Context.

### REQ-RUN-004

A StepArtifact stem MUST be
`<UTC-settled-compact-ms>--<node-id>--a<attempt>`. The timestamp aids human
sorting only and MUST NOT determine identity, selection, attempt allocation, or
completion.

### REQ-RUN-005

`run.md` MUST begin at byte zero with restricted YAML frontmatter conforming to
`breakdown.run.v1`. It MUST record Run identity and creation time, Workflow
Snapshot identity and raw digest, exactly every resolved Workflow Input
path/digest pair, and producer name/version. Mutable status, completion,
attempt, Result indexes, cancellation, and metrics MUST NOT appear.

### REQ-RUN-006

StepArtifact Markdown MUST begin at byte zero with restricted YAML frontmatter
conforming to `breakdown.step-artifact.v1`. It MUST record Run and node
identity, attempt, settled status, exact start and settle times, Node Context
digest, exactly every Input reference, and Executor metadata. It MUST contain a
problem exactly for `failed`, `blocked`, and `cancelled`; `succeeded` MUST NOT
contain a problem.

### REQ-RUN-007

Settled StepArtifact statuses are exactly `succeeded`, `failed`, `blocked`, and
`cancelled`. Ready, prepared, queued, running, skipped, and Run cancellation
MUST remain transient or derived and MUST NOT become StepArtifacts.

### REQ-RUN-008

Executor metadata MUST contain `kind: agent | human | program` and a nonempty
name and MAY contain a nonempty version. Credentials, traces, costs, token
counts, reasoning settings, provider identity, model identity, and host
configuration MUST NOT enter durable records.

### REQ-RUN-009

A Workflow Input reference MUST resolve through the Run Manifest. A
Predecessor reference MUST identify one exact same-Run succeeded StepArtifact,
attempt, Markdown path/digest, and conditional JSON path/digest, and MUST agree
with the receiving Input Binding source.

### REQ-RUN-010

The Markdown body of a succeeded StepArtifact MUST be the complete Result,
including when it is zero bytes. The core MUST NOT insert headings, titles,
citations, or duplicated JSON. A non-success body MAY contain human
diagnostics, but it MUST NOT become a downstream Result.

### REQ-RUN-011

A contracted successful Result MUST contain one same-stem strict UTF-8 JSON
sidecar and an uncontracted Result MUST contain none. JSON MUST reject BOM,
comments, trailing commas, duplicate names, JSON5, and non-finite numbers; any
root value permitted by the Data Contract is valid. Accepted candidate JSON
MUST serialize as compact RFC 8785 bytes without a trailing newline.

### REQ-RUN-012

Run and StepArtifact Markdown MUST be UTF-8 without BOM, use LF, and begin with
restricted YAML frontmatter at byte zero. Candidate Markdown MUST be rejected,
not normalized, when these byte rules fail.

### REQ-RUN-013

Run and StepArtifact schema families MUST be strict and versioned. Unknown or
mixed core versions MUST fail `unsupported_version`. A future migration MUST
create new history and MUST NOT edit an existing Run.

### REQ-RUN-014

Contextual Run validation MUST check layout, filenames and frontmatter,
identities, timestamps, attempt continuity, Workflow Snapshot and Workflow
Input membership/digests, exact bindings and references, Result pairing and
digests, status invariants, Data Contracts, and schema compatibility.

### REQ-RUN-015

Run diagnostics MUST be collected and ordered by file, RFC 6901 path, and code.
The normative categories are `parse`, `unsupported_version`, `schema`,
`invalid_path`, `layout`, `integrity`, `missing_reference`,
`reference_mismatch`, `duplicate_attempt`, `status_invariant`, and
`data_contract`.

### REQ-RUN-016

Readers MUST ignore unrelated non-normative entries, temporary entries, and an
orphan JSON file without same-stem Markdown. Every normative StepArtifact
Markdown filename is a logical commit marker and MUST be validated strictly.

### REQ-RUN-017

`breakdown.run.v1.schema.json` and
`breakdown.step-artifact.v1.schema.json` MUST own the public machine shapes.
Implementation types, parsers, and serializers MUST NOT add normative fields or
weaken their closed-world records.

### REQ-RUN-018

The public Run corpus MUST contain literal byte-exact Run Manifests and every
StepArtifact status, pairing, attempt, Input, extension, and Executor form,
together with every corruption, mixed-version, gap, duplicate, filename
mismatch, missing/extra sidecar, temporary, orphan, and unrelated-entry case.

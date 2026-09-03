# Command-Line Interface Contract

Document kind: Authored normative contract

Contract version: 1.0.1

Requirement namespace: `REQ-CLI`

This document owns CLI meanings and stream invariants.
`../catalogs/cli.v1.json` owns commands, operations, exit codes, byte fields,
and presentation enumerations. Machine envelope and operation values are owned
by the schemas in `../schemas/`.

### REQ-CLI-001

The canonical executable MUST be `breakdown`. Its human surface MUST contain
exactly the three commands enumerated by the CLI catalog, plus help and exact
package-version metadata.

### REQ-CLI-002

Every command MUST require an explicit `--project PATH`. A relative CLI
argument MUST resolve against the invocation cwd before core canonicalization.
The CLI MUST NOT discover a root from cwd, environment, repository, or adjacent
files.

### REQ-CLI-003

Run creation MUST always create a new Run. Human inspection MUST require one
exact Run ID. The human surface MUST NOT expose inferred/latest Run, prepare,
read, submit, retry, refresh, finalize, cancel, unlock, Git, publication, or
Executor commands.

### REQ-CLI-004

Automation MUST use `breakdown operate --project PATH`, read exactly one strict
bounded `breakdown.operation-request.v1` UTF-8 JSON document from stdin, and
emit one `breakdown.cli-output.v1` document.

### REQ-CLI-005

Human commands MUST be projections of `validate_workflow`, `create_run`, and
`inspect_run`. CLI code may own only argv parsing, schema enforcement,
presentation, envelopes, streams, signals, and exit codes; it MUST NOT
reimplement operation behavior.

### REQ-CLI-006

Machine mode MUST write exactly one compact UTF-8 JSON document plus LF to
stdout. Expected failures MUST also use stdout with empty stderr. Human success
MUST use stdout and human failure/diagnostics MUST use bounded stderr.

### REQ-CLI-007

Human output MUST escape terminal controls, use color only on a TTY, and honor
any present `NO_COLOR` value. Presentation MUST NOT change machine data,
failure classification, or durable effects.

### REQ-CLI-008

Process exit codes MUST exactly match the CLI catalog for success, usage,
invalid, conflict, unsupported, cancelled, resource limit, I/O, and internal
outcomes. A valid incomplete Run inspection MUST exit successfully.

### REQ-CLI-009

Automation MUST preserve exact core values, deterministic ordering, and
cataloged base64 representations for Workflow Input and complete predecessor
Result bytes. It MUST NOT require clients to parse human prose.

### REQ-CLI-010

SIGINT and SIGTERM MUST translate to trusted core invocation cancellation.
Before commit they MUST leave no partial record; once the core publication
critical section begins they MUST preserve its unambiguous commit contract.

### REQ-CLI-011

The packaged executable MUST behave identically with or without Git and MUST
run from actual installed package tarballs rather than workspace-only imports
for release conformance.

### REQ-CLI-012

CLI conformance MUST cover exact argv and help/version metadata, every human
command, every automation request variant, success and failure streams, UTF-8
and request/response limits, base64 bytes, terminal sanitation, exit codes,
signals, and Git-independent explicit-root behavior.

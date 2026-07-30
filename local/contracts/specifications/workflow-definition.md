# Workflow Definition Contract

Document kind: Authored normative contract

Contract version: 1.0.0

Requirement namespace: `REQ-WFV`

This document is the authored authority for Workflow Definition meanings and
invariants. `../schemas/breakdown.workflow.v1.schema.json` is the sole authority
for its public machine shape. The schema, limits catalog, and this prose are one
lockstep contract; implementation code and generated reference are not
normative.

### REQ-WFV-001

The selected project root MUST contain exactly one live Workflow Definition at
`breakdown.yaml`. It MUST identify `breakdown.workflow.v1`, contain stable
workflow intent only, and MUST NOT contain Run state, Results, provider choices,
or execution history.

### REQ-WFV-002

Readers MUST parse the exact file bytes as UTF-8 YAML 1.2 using the Core schema
and the portable JSON-compatible profile. They MUST accept an absent directive
or `%YAML 1.2` and MUST reject invalid UTF-8, multiple documents, a non-mapping
root, duplicate keys, anchors, aliases, merge keys, custom tags, non-finite
numbers, implicit coercion, and `null` used as omission.

### REQ-WFV-003

The Workflow Definition root MUST be flat. It MUST contain `schema_version`,
`id`, `name`, and a nonempty authored-order `nodes` array; it MAY contain only
`description`, `inputs`, and `extensions` in addition. Unknown core fields MUST
be rejected.

### REQ-WFV-004

Workflow, Node Definition, Workflow Input, and local Input Binding identifiers
MUST contain 1–64 lowercase ASCII kebab-case characters, MUST begin with a
letter, and MUST be unique in their applicable namespace.

### REQ-WFV-005

Workflow and Node Definition names MUST be trimmed, nonempty strings of at most
200 Unicode scalar values. A Workflow Definition description, when present,
MUST contain at most 2,000 Unicode scalar values.

### REQ-WFV-006

There is exactly one Node Definition kind. A node MUST contain `id`, `name`, and
one nonempty inline Markdown `prompt`; it MAY contain only `inputs`,
`data_contract`, and `extensions` in addition. Provider, model, Executor,
tool-policy, current-data, prompt-file, template, and interpolation fields MUST
NOT be accepted.

### REQ-WFV-007

Each Node Definition `inputs` member MUST bind one local identifier to exactly
one `{ workflow_input: <id> }` or `{ node: <id> }` source. Input Bindings are
the sole representation of dataflow and Predecessors; separate edges, relation
types, ordering-only links, ports, selectors, transforms, and literal bindings
MUST NOT exist.

### REQ-WFV-008

Every node source reference MUST be both execution-gating and consumptive,
including a reference to an empty Markdown Result. One receiving node MUST NOT
bind the same source more than once. Forward references MUST be accepted;
self-reference, missing references, and cycles MUST be rejected.

### REQ-WFV-009

Every declared Workflow Input MUST be consumed by at least one Input Binding.
Nodes without Inputs, multiple roots, multiple Terminal Nodes, disconnected
components, and isolated nodes MUST remain valid. A full Run always contains
every Node Definition.

### REQ-WFV-010

Authored node order MUST break ties between simultaneously eligible nodes.
Maps in diagnostics, Work Packets, and machine operation values MUST be ordered
by identifier. Author order MUST NOT create a semantic dependency.

### REQ-WFV-011

A Workflow Input MAY contain a description and MAY contain one project-relative
file default. Run creation MUST require an explicit path when no default exists.
Inline values, environment expansion, expressions, schemas, and references
between Workflow Inputs MUST NOT be supported.

### REQ-WFV-012

Persisted project-relative paths MUST use `/`, preserve exact case and Unicode,
and reject absolute paths, drive or UNC prefixes, backslashes, empty segments,
`.` or `..`, tilde, environment, glob, shell, URL, and percent-decoding forms.
Runtime alias and containment checks remain additionally required.

### REQ-WFV-013

A Node Definition `data_contract` MUST use only the JSON Schema 2020-12
keywords admitted by the Workflow Definition machine schema. References,
definitions, composition, conditionals, patterns, formats, defaults, remote
schemas, and custom vocabularies MUST be rejected. Successful Results MUST have
exactly one JSON sidecar when a Data Contract exists and none otherwise.

### REQ-WFV-014

`extensions` MAY occur only at the Workflow Definition root and on Node
Definitions. Each key MUST be a reverse-DNS namespace and each value MUST be a
JSON object. Readers MUST preserve valid unknown extensions, but removing every
extension MUST NOT change correctness, scheduling, or execution.

### REQ-WFV-015

Workflow validation MUST collect every independently discoverable error and
order diagnostics by RFC 6901 path and then code. The normative diagnostic
categories are `parse`, `unsupported_version`, `schema`, `invalid_path`,
`missing_reference`, `duplicate_source`, `unused_input`, and `cycle`. There are
no normative warnings; diagnostic messages and source locations are
non-normative.

### REQ-WFV-016

`../schemas/breakdown.workflow.v1.schema.json` MUST own the complete public
Workflow Definition shape and the Data Contract dialect. Prose MUST NOT
redefine property lists or keyword enumerations, and implementations MUST NOT
be used to infer fields absent from that schema.

### REQ-WFV-017

The public Workflow conformance corpus MUST include literal minimal and maximal
valid definitions; no-input, multi-root, disconnected, isolated,
fan-out/fan-in, multi-terminal, forward-reference, empty-Markdown, contracted
JSON, every JSON root, and extension cases; every restricted YAML, path,
identifier, reference, cycle, and Data Contract failure; every fixed boundary;
and deterministic diagnostics.

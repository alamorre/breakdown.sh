# Workflow Definition v1 authoring reference

Document kind: Task-oriented guidance

Document version: 1.0.0-beta.1

The deterministic validator is authoritative. This reference is a concise authoring aid, not a
replacement parser.

## Root

`breakdown.yaml` contains one `breakdown.workflow.v1` mapping with:

- required `schema_version`, `id`, `name`, and non-empty `nodes`;
- optional `description`, `inputs`, and `extensions`;
- no unknown core fields and no Run state or Results.

Identifiers are 1–64 lowercase ASCII kebab-case characters, begin with a letter, and are unique in
their namespace. Names are trimmed, nonempty, and at most 200 Unicode characters. A workflow
description is at most 2,000 characters.

## Workflow Inputs

`inputs` maps an identifier to a declaration with optional `description` and optional project-relative
file `default`. A missing default requires the path at Run creation. Every declared Workflow Input
must be consumed. Do not use inline values, environment expansion, expressions, or references
between Workflow Inputs.

Persisted paths use `/`, remain under the explicit project root, and are validated by the core.

## Node Definitions

Each node requires:

- `id`
- `name`
- one nonempty inline Markdown `prompt`

Optional fields are `inputs`, `data_contract`, and `extensions`. There is one node kind. Provider,
model, executor, tool-policy, current-data, prompt-file, templating, interpolation, and status fields
do not exist.

A node's `inputs` map binds a local input identifier to exactly one source:

```yaml
source:
  workflow_input: source-file
```

or:

```yaml
analysis:
  node: analyze
```

Each source may appear at most once for a receiving node. Node bindings derive Predecessors and the
DAG. Forward references, multiple roots, disconnected components, isolated nodes, fan-out, fan-in,
and multiple Terminal Nodes are valid. Missing references, self-reference, duplicate sources, and
cycles are invalid.

Every Predecessor is required: its node reference gates execution and supplies the complete Result,
even when its Markdown is empty. There are no ordering-only connections, edge kinds, ports,
selectors, transforms, or literal bindings.

## Results and Data Contracts

Every Terminal Node Result is a final workflow outcome; there is no outputs declaration. A Result is
one required Markdown file and, only when its node declares a Data Contract, one same-stem JSON
sidecar. The constrained Data Contract dialect is validated by the core. Use it only for machine
consumers and keep qualitative requirements in the prompt.

## YAML profile

Use UTF-8 YAML 1.2 Core-profile JSON-compatible values. Do not use duplicate keys, anchors, aliases,
merge keys, custom tags, non-finite numbers, coercion tricks, multiple documents, or `null` as
omission. Extension values remain inert metadata and cannot affect correctness or authority.

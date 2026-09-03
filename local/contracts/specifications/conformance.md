# Documentation and Conformance Contract

Document kind: Authored normative contract

Contract version: 1.0.1

Requirement namespace: `REQ-DOC`

This document owns the authority layering, traceability, oracle, and evidence
rules for the public corpus. It specifies release gates; it does not claim that
later platform, host, legal, or publication evidence already exists.

### REQ-DOC-001

Released material MUST visibly separate authored normative contracts,
task-oriented guidance, generated reference, and immutable release evidence.
Every released Markdown document MUST identify its kind and exact full version.

### REQ-DOC-002

Authored normative contracts MUST be the sole authored authority for Workflow,
Run and StepArtifact, hashing and state, security, publication, operations,
CLI, MCP, skills, hosts, release, documentation, and conformance semantics.
Implementation code, tests, guidance, and generated reference are
non-normative.

### REQ-DOC-003

Every normative requirement MUST have a stable non-reused `REQ-<GROUP>-NNN`
identifier and MUST map to at least one stable traceability row. Machine
schemas own public shapes, machine catalogs own limits and enumerated CLI/MCP
facts, and prose owns meanings and invariants.

### REQ-DOC-004

The single conformance index MUST contain exactly the `WFV`, `RUN`, `HASH`,
`STATE`, `SEC`, `PUB`, `OPS`, `CLI`, `MCP`, `SKILL`, `HOST`, `PKG`, and `DOC`
row groups. Every effective row MUST define setup, action, observable oracle,
oracle type, environment applicability, gate, and retained evidence.

### REQ-DOC-005

Byte oracles MUST be used for frozen serialization, hashes, golden records,
stdout and protocol framing, and packaged assets. Expected bytes MUST be
reviewed literals independent of implementation output. Structural, effect,
and human oracles MUST be used only at the settled dispatcher, packaged
process, guided-product, and release-artifact seams.

### REQ-DOC-006

The primary deterministic seam MUST be the six-operation dispatcher from the
actual packaged core over real temporary project directories and the public
corpus. Narrow internal seams are permitted only for deterministic clock,
cryptographic entropy, and secure-store publication fault injection.

### REQ-DOC-007

The packaged-process seam MUST invoke actual installed CLI and stdio MCP
executables and run shared cross-transport traces. The guided-product seam MUST
install exact skill archives in real Agent Hosts. Package, license,
documentation, manifest, archive, checksum, SBOM, provenance, and generated
reference checks MUST run against once-built candidate bytes.

### REQ-DOC-008

All normative schemas, catalogs, examples, fixtures, and matrices MUST be
self-contained, offline-capable, and versioned in lockstep. They MUST NOT
depend on mutable branches, discovery services, implementation source, or
network resolution.

### REQ-DOC-009

The offline contracts archive MUST include specifications, schemas, catalogs,
examples, conformance assets, manifest, version, and complete license/notices.
Its manifest MUST record every path, media type, role, and byte digest.

### REQ-DOC-010

CLI, automation, MCP, package, support, and `llms.txt` reference MUST be
generated from normative schemas/catalogs, inspected candidate artifacts,
canonical skills, navigation, release metadata, and exact evidence. Checked-in
reference MUST reproduce byte-for-byte and identify its authorities and
digests.

### REQ-DOC-011

Versioned guidance MUST lead through install, author, validate, create Run,
inspect exact Run, guided execution, and summary, keep specifications one click
away, and preserve local-storage versus offline-inference, Run Authority, Model
Neutrality, Git independence, immutable-version links, and unsupported-surface
distinctions. MCP MUST remain optional after the CLI baseline.

### REQ-DOC-012

The release manifest MUST be authoritative for exact artifact inventory,
supported families, channels, and Supported Host claims. Support material MUST
derive only from the authenticated host-support index: either the explicit
deferred empty 1.0 policy or exact passing indexed immutable evidence. Repository and versioned
`llms.txt` files MUST remain small discovery indexes rather than mirrors or
authorities.

### REQ-DOC-013

Stable release MUST remain blocked until every applicable deterministic,
platform, security, package, legal, documentation, and indexed-evidence gate
passes against exactly the published bytes. For 1.0 the applicable host gate is
review and attestation of the deferred empty policy; guided-host and
hostile-content gates become applicable to a later qualified support set.
Prereleases MAY retain incomplete rows but MUST NOT claim conformance or an
unsupported host row.

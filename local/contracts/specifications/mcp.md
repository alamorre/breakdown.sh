# Local stdio MCP Contract

Document kind: Authored normative contract

Contract version: 1.0.0-beta.1

Requirement namespace: `REQ-MCP`

This document owns the local MCP adapter's meanings and protocol invariants.
`../catalogs/mcp.v1.json` is the authority for server identity, supported
protocols, tool order, annotations, and forbidden capabilities. Tool input and
output shapes are owned by the machine schemas.

### REQ-MCP-001

The optional `@breakdown-sh/mcp` package MUST expose `breakdown-mcp` as a
local-only stdio process on Node `^24.0.0` in exact full-SemVer lockstep with
core, CLI, skills, and contracts.

### REQ-MCP-002

The server MUST expose exactly the six cataloged tools in operation order and
MUST use the cataloged server name, title, release version, and supported MCP
protocol versions. Product SemVer and MCP protocol versions MUST remain
distinct.

### REQ-MCP-003

Read-only hints MUST apply exactly to validate, inspect, prepare, and read.
Create and submit MUST be non-read-only and non-idempotent. Every tool MUST be
non-destructive and closed-world; annotations are usability hints and MUST NOT
grant authority.

### REQ-MCP-004

The server MUST expose none of the forbidden capabilities in the MCP catalog,
including resources, prompts, tasks, progress, logging, sampling, elicitation,
completion, Roots behavior, dynamic tools, HTTP, daemon, auth, or hosted
fallback.

### REQ-MCP-005

Each strict tool input schema MUST be mechanically projected from the matching
automation operation, add required schema version and absolute OS-native
`project_root`, and reject additional properties. Tool discovery MUST NOT
replace server and core validation.

### REQ-MCP-006

Server launch MUST select and access no project. Every call MUST supply one
absolute native project root. Relative, URI-like, cwd-, environment-,
workspace-, repository-, and MCP-Roots-derived roots MUST be rejected.

### REQ-MCP-007

Expected operation successes and failures MUST use
`breakdown.mcp-output.v1` structured content plus one text block containing
identical compact JSON. Core values or failure kind, code, message, and
diagnostics MUST be preserved exactly; core failures MUST set `isError`.

### REQ-MCP-008

JSON-RPC parse, request, method, params, and internal errors MUST remain
distinct from expected core failures. An SDK wrapper MUST NOT blur that
boundary or convert expected failures into protocol errors.

### REQ-MCP-009

MCP cancellation and connection closure MUST abort the trusted core invocation.
After protocol cancellation the adapter MUST send no response, including when
a deferred publication commit completes. Recovery MUST use exact inspection,
never replay.

### REQ-MCP-010

Stdout MUST contain only one JSON-RPC message per line. Necessary stderr MUST be
bounded and sanitized. EOF and termination signals MUST stop new work, abort
eligible invocations subject to core commit semantics, and leave no daemon.

### REQ-MCP-011

MCP conformance MUST cover both cataloged protocol versions; exact identity,
tool order, annotations, and schemas; absence of every forbidden capability;
explicit roots; request-shape versus core-error boundaries; envelope identity;
cancellation, lifecycle, signals, and stream discipline; MCP Inspector; and at
least two independent clients, one outside the server's high-level wrapper.

### REQ-MCP-012

Shared traces MUST prove MCP-only operation and interoperability with the
canonical CLI over the same values, failures, ordering, limits, cancellation,
and on-disk Run semantics.

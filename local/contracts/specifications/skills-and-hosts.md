# Portable Agent Skills and Host Contract

Document kind: Authored normative contract

Contract version: 1.0.0

Requirement namespaces: `REQ-SKILL`, `REQ-HOST`

This document owns portable skill and host-qualification invariants. Canonical
skill files own their qualitative trigger and task guidance; this contract does
not prescribe model prose or host UI.

### REQ-SKILL-001

The canonical pack MUST contain exactly five byte-identical directories:
`setup-breakdown`, `author-breakdown`, `critique-breakdown`, `run-breakdown`,
and `summarize-breakdown-run`.

### REQ-SKILL-002

Every skill MUST use only the strict common Agent Skills profile: required name
and description plus optional license, compatibility, and inert string
metadata. Correctness MUST NOT depend on vendor tool names, allowed-tools,
invocation, subagents/models, hooks, permissions, arguments, path filters, or
vendor frontmatter.

### REQ-SKILL-003

Each independently copied skill MUST contain complete `LICENSE`, `NOTICE`, and
`THIRD_PARTY_NOTICES.md` files. Main instructions MUST remain concise and may
progressively load only one-level references and assets.

### REQ-SKILL-004

Only setup MAY contain a script. Setup MUST verify canonical skill bytes, exact
matching full SemVer, Node 24, CLI, optional MCP, host capability, and local
filesystem; ask before mutation; exercise a disposable fixture; and report
Supported, Compatible, Unsupported, or repair-required precisely.

### REQ-SKILL-005

Authoring MUST discover project facts, resolve material product choices,
propose a research-backed minimum-sufficient DAG from Terminal Results and
meaningful Result handoffs, show the complete proposal or diff, write only
confirmed `breakdown.yaml`, and delegate exact validity to the core. It MUST
create no Run or StepArtifact.

### REQ-SKILL-006

Critique MUST be read-only, validate first, and stop on deterministic errors.
For a valid definition it MUST assess Terminal Results, cohesion, handoffs,
false or missing dependencies, parallelism, synthesis/revision,
duplication/context, evidence/uncertainty/completion, Data Contracts, and
authority confusion.

### REQ-SKILL-007

Run guidance MUST use only versioned automation values and MUST obtain approval
for a new Run after presenting the exact root, Workflow Definition, Workflow
Inputs, Run Authority, concurrency, provider/privacy disclosure, and isolation
mode.

### REQ-SKILL-008

Existing work MUST require an exact user-supplied Run ID and follow inspect,
prepare, per-binding read, execute, and submit without scraping human CLI
output. A fresh isolated session per Work Packet MUST be preferred up to three
concurrent packets; sequential fallback MUST disclose reduced isolation.

### REQ-SKILL-009

Submissions MUST be serialized. Every independent packet in a batch MUST settle
before submission decisions, and a batch containing non-success or submission
failure MUST trigger exact re-inspection and stop automatic progress without a
hidden retry.

### REQ-SKILL-010

Refresh and abandoned-lock recovery MUST each require a separate exact
approval. Refresh approval MUST identify one complete node and Run; recovery
approval MUST identify the exact observed lock ID and confirm the old writer
stopped. Neither approval grants the other.

### REQ-SKILL-011

Summary MUST require one exact Run, validate through inspection, read only
Selected Terminal Results, distinguish stale and non-success history,
re-inspect before presentation, and create no durable summary record.

### REQ-SKILL-012

No migration skill may ship. Before main work, every non-setup skill MUST
perform fast exact-version preflight and route mixed or incompatible releases
to setup without mutating the selected project.

### REQ-SKILL-013

Canonical skill guidance MUST preserve Model Neutrality and target outcome
parity rather than identical UI, wording, approvals, latency, prose, quality,
cost, or provider privacy. Model/provider identity MUST NOT enter durable
contracts.

### REQ-HOST-001

Unchanged canonical skill directories MUST install beneath `.agents/skills/`
for Codex, Gemini CLI, GitHub Copilot CLI, Cursor, and OpenCode and beneath
`.claude/skills/` for Claude Code. Host-specific discovery, installation,
permission, and MCP-registration adapters MUST remain shallow.

### REQ-HOST-002

Setup's host references are the sole authored authority for installation,
discovery, permission, and MCP-registration guidance. Other public host pages
and snippets MUST be generated from those exact references.

### REQ-HOST-003

A named Supported Host claim MUST attach to one exact passing host surface,
host version, operating system, transport, Breakdown version, artifact digest,
and retained evidence row. An unknown capable host is Compatible; a bare model
or unprovisioned cloud surface is Unsupported.

### REQ-HOST-004

Breakdown Local 1.0 MUST publish with Supported Host certification explicitly
deferred and with zero evidence rows and zero Supported Host claims. The empty
set MUST be represented by an immutable candidate/source/tag-bound index and
attestation, not by a passing qualification status. Capable unqualified hosts
are Compatible. Windows, bare models, unprovisioned cloud surfaces, and hosts
without the mandatory capabilities are Unsupported. The disabled
`local-host-evidence-capture.yml` workflow (ID `324133712`) MUST NOT be
dispatched or re-enabled for 1.0 and may be re-enabled only after issue #188 is
implemented and accepted.

### REQ-HOST-005

The guided journey MUST cover authoring, validation, read-only critique,
execution, partial resume, blocked behavior, refresh and staleness, completion,
summary, and hostile project content while retaining visible interaction and
action evidence.

### REQ-HOST-006

The human rubric MUST score comprehension, minimum-sufficient decomposition,
dependency correctness, proposal and approval clarity, valid authoring,
critique usefulness and read-only behavior, execution and recovery clarity,
Terminal Result usefulness, summary fidelity, and host-native usability.

### REQ-HOST-007

A guided row MUST have no zero score, achieve at least 80 percent, and receive
full marks for authority and approval safety, core truthfulness, valid
artifacts, and summary fidelity. Only exact passing indexed evidence may create
a Supported Host claim.

### REQ-HOST-008

Host qualification MUST assess outcome parity and MUST NOT claim identical UI,
wording, approval mechanics, latency, model prose, quality, cost, or provider
privacy.

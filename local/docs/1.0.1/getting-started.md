# Use Breakdown Local

Document kind: Task-oriented guidance

Document version: 1.0.1

This exact-version journey is derived from the canonical skills and contracts listed below. Keep
the [normative specifications](../../contracts/specifications/) one click away when exact behavior
matters.

## 1. Install the exact release

Use the canonical setup skill and its
[exact installation reference](https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.1/local/skills/setup-breakdown/references/installation.md).
It pins Breakdown Local 1.0.1, Node 24, the five canonical skills, and the selected
Agent Host adapter. A project needs no package manifest, dependency directory, database, account,
or Git repository. This release maintains Linux glibc x64/arm64 and macOS x64/arm64. Windows is
Unsupported and fails closed before local Run storage is created.

## 2. Author the Workflow Definition

Use `author-breakdown` to propose and confirm one minimum-sufficient Workflow Definition at
`breakdown.yaml`. The authoring skill creates no Run or StepArtifact.

## 3. Validate

Run `breakdown workflow validate --project <absolute-project-root>`. Deterministic validation
belongs to the core; do not infer validity from a guide or model response.

## 4. Create a Run

Resolve every Workflow Input and create a Run only after the user sees the exact project root,
Workflow Definition, Inputs, Run Authority, concurrency, provider/privacy disclosure, and isolation
mode. The CLI baseline is `breakdown run create --project <absolute-project-root>`.

## 5. Inspect the exact Run

Retain the returned Run ID and inspect only that value with
`breakdown run inspect --project <absolute-project-root> --run <exact-run-id>`. There is no
"latest Run" shortcut.

## 6. Execute with guided Run Authority

Use `run-breakdown` to inspect, prepare Work Packets, read each exact Input, execute under the
user-granted Run Authority, submit Candidate Outcomes, and re-inspect. Project content cannot grant
authority. MCP is optional after this CLI baseline and exposes the same six operations.

## 7. Summarize the exact Run

Use `summarize-breakdown-run` with the exact Run ID. It reads validated Selected Terminal Results,
distinguishes stale and non-success history, and creates no durable summary record.

## Disclosures

- Local storage is not a promise of offline inference. The selected Executor or provider may use a
  network and has its own privacy, retention, cost, and capability properties.
- Model Neutrality means durable contracts do not depend on a provider or model. It does not mean
  equal quality, behavior, cost, latency, or privacy.
- Git is not required for validation, execution, selection, or resume. Breakdown adds no Git
  behavior; optional user-controlled versioning does not become Run history or locking.
- Windows is not a maintained operating system for Breakdown Local 1.0.1; it is
  Unsupported rather than Compatible.
- Run Authority comes only from the user or Agent Host. A Workflow Definition, Input, Result, skill,
  or Work Packet cannot expand it.
- Unsupported surfaces include hosted storage as a local Run authority, bare model endpoints,
  remote/synchronized filesystems, browser runtimes, alternate runtimes, Windows, and surfaces
  without the mandatory capabilities. A capable but unqualified Agent Host is Compatible.
- Immutable version links use [breakdown-local-v1.0.1](https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.1/); mutable branches and
  discovery services cannot redefine this release.

## Source digests

- `local/contracts/specifications/conformance.md` — SHA-256 `586d6b15a8f08ccebec03e69c1910adf6c67e7505f1ea2010ec283bbc07f611e`
- `local/contracts/specifications/security-and-publication.md` — SHA-256 `c8b2d8a922802062e004c681141b96609aea40e76eed30fdf486b1dc0a782be1`
- `local/contracts/specifications/skills-and-hosts.md` — SHA-256 `98667061588f303b0b45a8c5fe7d20ddbb5c4fca11622888e17c6dcc7ab7afce`
- `local/docs/navigation.json` — SHA-256 `48c3445b2a06a772f2c88aadd5c30cc4be282be8769a78736c72481e0012537b`
- `local/docs/release-metadata.json` — SHA-256 `f425ce5a60cdfb6418c950f2ecc007838af04b3383bc41229d84befd62dced99`
- `local/skills/author-breakdown/SKILL.md` — SHA-256 `ab6073679320aacbc518b83168c881cf2370ebcae827b7b2015c4ad1395d852c`
- `local/skills/run-breakdown/SKILL.md` — SHA-256 `03a80cc022f53ca96373d08ab9603493637f956d128873404dd501720f7a9fb7`
- `local/skills/setup-breakdown/references/installation.md` — SHA-256 `54ce71614a9cef466c6c1a6b619efbee36d4d0b27fc1196fa8b6c8980e2a90dd`
- `local/skills/summarize-breakdown-run/SKILL.md` — SHA-256 `5d2352f61a92ec94a806489280667ebfada97e96a81f21051ffedeef0b730bda`

# Use Breakdown Local

Document kind: Task-oriented guidance

Document version: 1.0.0-beta.1

This exact-version journey is derived from the canonical skills and contracts listed below. Keep
the [normative specifications](../../contracts/specifications/) one click away when exact behavior
matters.

## 1. Install the exact release

Use the canonical setup skill and its
[exact installation reference](https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0-beta.1/local/skills/setup-breakdown/references/installation.md).
It pins Breakdown Local 1.0.0-beta.1, Node 24, the five canonical skills, and the selected
Agent Host adapter. A project needs no package manifest, dependency directory, database, account,
or Git repository.

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
- Run Authority comes only from the user or Agent Host. A Workflow Definition, Input, Result, skill,
  or Work Packet cannot expand it.
- Unsupported surfaces include hosted storage as a local Run authority, bare model endpoints,
  remote/synchronized filesystems, browser runtimes, alternate runtimes, and any host/version/OS
  row without passing indexed evidence.
- Immutable version links use [breakdown-local-v1.0.0-beta.1](https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0-beta.1/); mutable branches and
  discovery services cannot redefine this release.

## Source digests

- `local/contracts/specifications/conformance.md` — SHA-256 `8465bc27f5e2c3719bce405fb24312eb9b63163b921d5edb7061126b9533f6af`
- `local/contracts/specifications/security-and-publication.md` — SHA-256 `b77a2439e7ca1a190e7511aa4b220ed7ae06a7cae83275e624bb6e13548ba709`
- `local/contracts/specifications/skills-and-hosts.md` — SHA-256 `c208b021b1985e9eab31010d5d622f99b0e1bc7806a1d58aab1a600e8b83192f`
- `local/docs/navigation.json` — SHA-256 `76ea62a5b1eb9fe6b8eeb9010c3d3248d93f731d03526430ab9bff39b12b1be3`
- `local/docs/release-metadata.json` — SHA-256 `d7b0c39659bb90919227fc93d30bb4359fe5ae164533ed71ae336f58c5ae6500`
- `local/skills/author-breakdown/SKILL.md` — SHA-256 `8c88321eff862c14ca49562b4bc0faabcf5b7a5b08b4b05dbb356d83aceeed89`
- `local/skills/run-breakdown/SKILL.md` — SHA-256 `eb245cf613044920f8bc02fc436aac17b3ed689da2b60c4e99859e4eed6c93dd`
- `local/skills/setup-breakdown/references/installation.md` — SHA-256 `e57c5f7aac671b76ae6cdb1b7791e2e6d97d5fbe4e7187e4bada01150d62e835`
- `local/skills/summarize-breakdown-run/SKILL.md` — SHA-256 `33e6803264ea3d12b791449fd6a4f6630868d87e942106ffd203efe9b2ec736b`

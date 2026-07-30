# Use Breakdown Local

Document kind: Task-oriented guidance

Document version: 1.0.0

This exact-version journey is derived from the canonical skills and contracts listed below. Keep
the [normative specifications](../../contracts/specifications/) one click away when exact behavior
matters.

## 1. Install the exact release

Use the canonical setup skill and its
[exact installation reference](https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0/local/skills/setup-breakdown/references/installation.md).
It pins Breakdown Local 1.0.0, Node 24, the five canonical skills, and the selected
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
- Immutable version links use [breakdown-local-v1.0.0](https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0/); mutable branches and
  discovery services cannot redefine this release.

## Source digests

- `local/contracts/specifications/conformance.md` — SHA-256 `d9a4a34a949fef022ff17561990ed8327bd3d3836c7d853bec2141921dc83e35`
- `local/contracts/specifications/security-and-publication.md` — SHA-256 `93382b425a7aef0c187ca7418e059f1a88674a4118bed98cfdcd9466ef93b7f2`
- `local/contracts/specifications/skills-and-hosts.md` — SHA-256 `63f5e21716ade0f62eb2bdf59409d4c529c07ac3ebc6e14ac5152a0b66f6380c`
- `local/docs/navigation.json` — SHA-256 `ee1ed5285b728a0e26339a19221de10f4a61aff45c633dcb4602099c56d82716`
- `local/docs/release-metadata.json` — SHA-256 `ae6d4a39b7a94ddccf22505a6b85a1fb7ccc5d2be588e21519e9987094a75f70`
- `local/skills/author-breakdown/SKILL.md` — SHA-256 `0f0808f6f3ae4d4b35c105c3d530bc7c3ee981f65c4cc7aa0a069dd4484a236c`
- `local/skills/run-breakdown/SKILL.md` — SHA-256 `63b65a045e8115b32a58710cdf80bca93443eb19a2f8427fea19dc85bcf26418`
- `local/skills/setup-breakdown/references/installation.md` — SHA-256 `2b1636cff19452d87de06bf5c732563c682078f82ce83a02547f53c52f865dde`
- `local/skills/summarize-breakdown-run/SKILL.md` — SHA-256 `c4d747f54f890077a6e856c00281031b1788f788eab4d13845bf50d838ad4ca3`

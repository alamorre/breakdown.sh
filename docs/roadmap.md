# Breakdown Local roadmap

Breakdown Local is the canonical product: a directory containing `breakdown.yaml`, immutable Runs
and StepArtifacts, deterministic resume, core, CLI, optional local stdio MCP, and five portable skills.
See [architecture](architecture.md) and the [contracts](../local/contracts/README.md).

The Local MVP (#124, #142) is implemented and released. Repository cleanup #240 is complete through
#273–#275; skill-discovery guidance is resolved by #277, and contributor ownership guidance by
#280. The priority is useful, reliable personal use: fixes for installing, running, resuming,
debugging, or shipping Local, and capabilities the owner actually wants.

## Next work

The [source-checkout example](getting-started.md#try-a-source-checkout) and
[same-Run handoff](runs-and-authority.md#source-checkout-handoff) address
[#279](https://github.com/alamorre/breakdown.sh/issues/279), the setup/resume gap observed in #276.
The contributor guidance addresses [#280](https://github.com/alamorre/breakdown.sh/issues/280).
No task remains from this follow-up batch. Add further work only when an observed problem or an
owner-requested capability gives it a concrete user-visible outcome.

## Backlog decisions (#278)

The open-issue review found #94, #276, and this cleanup (#278). The proposed follow-up batch is
resolved below; it does not become a standing program of trials or maintenance reports.

| Item | Disposition and reason |
| --- | --- |
| [Hosted release loop #94](https://github.com/alamorre/breakdown.sh/issues/94) | Superseded by the hosted archive. Children #105–#109 are completed; remaining hosted promotion/reporting scope is obsolete. No Local replacement. |
| [Usage trial #276](https://github.com/alamorre/breakdown.sh/issues/276) | Closed with its completed **assisted** interruption/resume report preserved. It is not an unassisted pass or certification. The source-checkout handoff gap becomes #279; discovery was resolved by #277. |
| Setup/resume documentation | Keep only #279's observed usability gap in the existing guides. |
| Standalone coordinator guidance | Drop. The reported three-word draft assertion failure, premature stop, and intervention do not establish a core failure. Carry existing authority and stop constraints in #279's handoff, without a new coordinator protocol or retry behavior. |
| Test-timeout investigation | Drop speculative hardening: #277 reports one boundary-test timeout, followed by an isolated pass and a successful full run without code or timeout changes. Revisit only if a recurring failure obstructs development. |
| Backlog cleanup | Completed by #278, not a recurring reporting task. #240's repository cleanup is already delivered. |
| Repeat trial | Drop as a roadmap requirement. Validate actual changes proportionately; no standing trial or report obligation. |
| Supported Host qualification #188 | Already closed; removed from future scope, rather than deferred as a milestone. Existing historical support claims remain unchanged. |
| Provenance, attestations, qualification/evidence pipelines, promotion bureaucracy, release gates, and reporting for its own sake | Removed from roadmap scope. No replacement process framework or mandatory artifacts. |

The [#276 report](https://github.com/alamorre/breakdown.sh/issues/276) records same-Run completion
and reuse, a coordinator intervention before the no-workarounds clarification, and a later
whitespace check that prevented committing the trial files. Those limitations remain part of the
result; they neither imply an unassisted pass nor require another trial. The
[#277 fix](https://github.com/alamorre/breakdown.sh/pull/277) explains explicit skill invocation
without synchronization machinery.

## Product boundaries

npm publication uses the [simple manual Actions path](npm-publishing.md) established by #269.
Historical release ADRs and evidence explain past requirements; they do not add publication gates.

The hosted application and remote plugin live in [the Git archive](adr/0005-archive-hosted-product.md).
Hosted revival, accounts, databases, remote coordination, multi-user execution, and UI work are out
of scope. Any revival requires a new decision about maintenance and coexistence.

Local has no hosted environment inventory and does not source `.env` files. Keep secrets out of
workflow definitions, prompts, Work Packets, Results, and diagnostics. The user or Agent Host grants
execution authority; the core adds no network, telemetry, credential discovery, or publication.

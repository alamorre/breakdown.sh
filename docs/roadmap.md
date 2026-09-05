# Breakdown Local roadmap

Breakdown Local is the canonical product: a directory containing `breakdown.yaml`, immutable Runs
and StepArtifacts, deterministic resume, core, CLI, optional local stdio MCP, and five portable skills.
See [architecture](architecture.md) and the [contracts](../local/contracts/README.md).

The Local MVP (#124, #142) is implemented. Supported Host certification remains deferred to #188;
a capable but unqualified Agent Host is Compatible, not Supported. Repository cleanup #240 removes
the competing hosted contributor path and consolidates demonstrated duplication incrementally.

npm publication uses the [simple manual Actions path](npm-publishing.md) established by #269.
Historical release ADRs and evidence explain past requirements; they do not add publication gates.

The hosted application and remote plugin live in [the Git archive](adr/0005-archive-hosted-product.md).
Hosted revival, accounts, databases, remote coordination, multi-user execution, and UI work are out
of scope. Any revival requires a new decision about maintenance and coexistence.

Local has no hosted environment inventory and does not source `.env` files. Keep secrets out of
workflow definitions, prompts, Work Packets, Results, and diagnostics. The user or Agent Host grants
execution authority; the core adds no network, telemetry, credential discovery, or publication.

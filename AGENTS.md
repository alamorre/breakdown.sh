# Breakdown Local

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [the architecture map](docs/architecture.md).
Use Node 24 and the pinned pnpm version. `pnpm install && pnpm check` runs the Local PR checks.
Keep `operate` and its six operations as the external interface. Preserve public contracts,
independent conformance fixtures, filesystem integrity, privacy, and user-granted authority.

Make implementation explain itself through domain names, explicit types, cohesive interfaces,
and meaningful behavior tests. Use comments for non-obvious rationale, constraints, and invariants;
keep authored docs focused on intent, decisions, usage, and necessary contracts. Follow
[contribution guidance](CONTRIBUTING.md#implementation-and-documentation) for ownership and updates,
and [reference owners](docs/reference-generation.md) for generated facts.

Hosted source and its Next.js-specific instructions are recoverable through
[the archive decision](docs/adr/0005-archive-hosted-product.md).
The manual npm publication path is documented in [docs/npm-publishing.md](docs/npm-publishing.md).
Do not publish or dispatch workflows without explicit authorization.

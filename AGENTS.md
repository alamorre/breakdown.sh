# Breakdown Local

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [the architecture map](docs/architecture.md).
Use Node 24 and the pinned pnpm version. `pnpm install && pnpm check` runs the Local PR checks.
Keep `operate` and its six operations as the external interface. Preserve public contracts,
independent conformance fixtures, filesystem integrity, privacy, and user-granted authority.

Hosted source and its Next.js-specific instructions are recoverable through
[the archive decision](docs/adr/0005-archive-hosted-product.md).
The manual npm publication path is documented in [docs/npm-publishing.md](docs/npm-publishing.md).
Do not publish or dispatch workflows without explicit authorization.

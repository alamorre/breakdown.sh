# Reference owners and regeneration

Use [the documentation index](README.md) for current guidance. Generated reference summarizes facts;
it does not replace public semantic contracts or independently reviewed compatibility expectations.
Follow [contribution guidance](../CONTRIBUTING.md#implementation-and-documentation) when deciding
whether a change belongs in code, authored docs, or generated output.

| Fact | Authored owner | Existing consumers and generators |
| --- | --- | --- |
| Operation meanings and invariants | `local/contracts/specifications/operations.md` | Core's `operate` dispatcher; both adapters call it |
| Request/output shapes | `local/contracts/schemas/*.schema.json` | CLI `generate-protocol-validator.mjs` and MCP `generate-protocol-assets.mjs` use AJV; MCP projects tool schemas from operation variants |
| Operation names and structured failure codes | `local/contracts/catalogs/operations.v1.json` | Documentation generator; schemas, TypeScript discriminated unions, and adapter dispatch still repeat some facts |
| Fixed resource limits | `local/contracts/catalogs/limits.v1.json` | Core `fixed-limits.ts` and schema limits still repeat values; independent boundary fixtures check behavior |
| CLI help commands and exit codes | `local/contracts/catalogs/cli.v1.json` | CLI build emits `dist/cli-reference.js` for runtime help, exit codes, and stderr limit; the documentation generator uses the same catalog |
| Package versions | `packages/*/package.json` | npm packing, package reference, and generated CLI version; the core version string remains a separate candidate for consolidation |
| Current contract/document version | `local/contracts/VERSION` | Documentation/contract archive generator; current release metadata, catalogs, and independent fixtures intentionally assert an exact version |
| Host support claims and historical evidence | Exact release artifacts and `local/docs/release-metadata.json` | Existing versioned support reference; do not turn historical certification requirements into npm gates |
| Vendored skill provenance | `local/vendor/skills/VENDORED_SKILLS.json` and pinned upstream source | Manifest generator and independent skill/archive tests |

`pnpm local:docs:generate` runs `scripts/generate-local-documentation.mjs --write`. Its owner is
`scripts/local-release/documentation.mjs`, with the existing contract-archive and skill-manifest
helpers. Each generated reference names its input paths and SHA-256 digests. The generator writes
the current version's guidance/reference, repository `llms.txt`, current contract manifest/legal
output, and the embedded skill manifest. `pnpm local:docs:check` compares the same bytes without
writing; the documentation-artifact test already runs that check during `pnpm test`.

CLI and MCP protocol assets are generated into each package's `dist/` during `pnpm build`; they
are rebuilt from source on every build rather than checked in as another authored copy. For vendored
skill updates, follow [the pinned provenance workflow](vendored-skills.md).

Keep older `local/docs/<version>/` trees and reviewed conformance fixtures intact. Do not generate
hash vectors, process-byte oracles, attack fixtures, or historical version assertions from runtime
code or the generator they are intended to check. A version update must distinguish current output
from historical evidence; blindly replacing version strings across the repository is incorrect.

## Internal links

`node scripts/check-doc-links.mjs` checks local files, directories, reference-link destinations,
and Markdown heading fragments in maintained guidance, contracts, skills, and versioned docs.
It skips fenced examples and external URLs and does not fetch the network. Vendored upstream
Markdown is preserved as imported. The same check runs in the test suite, so `pnpm check` covers
both navigation and generated drift without a second documentation job.

## Consolidate in small steps

Generate shared reference facts from their authored owners while keeping compatibility fixtures
independent. The completed CLI consolidation is recorded in
[#275](https://github.com/alamorre/breakdown.sh/pull/275), part of
[#240](https://github.com/alamorre/breakdown.sh/issues/240).

Scope further consolidation only when its concrete maintenance benefit and independent
compatibility checks are clear. Do not reorganize core as a prerequisite.

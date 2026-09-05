# Architecture map

Breakdown Local has one public operation boundary: `operate(request, trustedContext)`. CLI and MCP
are adapters into core. Core does not invoke models, execute project code, or depend on either
adapter. An Agent Host uses the skills to execute work under user-granted authority.

| Location | Responsibility |
| --- | --- |
| `packages/breakdown-core/src/index.ts` | Dispatch the six operations |
| `packages/breakdown-core/src/index.ts` | Workflow validation and Run creation |
| `packages/breakdown-core/src/run-inspection.ts` | Validate durable history and derive state |
| `packages/breakdown-core/src/prepare-work.ts` | Prepare exact-context work without committing an attempt |
| `packages/breakdown-core/src/index.ts` | Read and verify declared Input bytes |
| `packages/breakdown-core/src/submit-candidate.ts` | Validate and atomically commit outcomes |
| `packages/breakdown-core/src/secure-store.ts` | Filesystem containment, identity, permissions, and safe I/O |
| `packages/breakdown-cli/` | Human commands and JSON automation over stdin/stdout |
| `packages/breakdown-mcp/` | Optional local stdio MCP transport |
| `local/contracts/` | Normative meanings, schemas, catalogs, and independent conformance fixtures |
| `local/skills/` | Five focused portable Agent Skills |
| `local/vendor/skills/` | Nine MIT engineering skills with pinned provenance |
| `local/tests/` | Canonical and vendored skill compatibility tests |
| `scripts/local-release/` | Local packaging, documentation generation, optional qualification |

Start with the [contracts index](../local/contracts/README.md) for exact meanings and public shapes.
The [security contract](../local/contracts/specifications/security-and-publication.md) explains why
storage rejects links, changed identities, unsupported filesystems, and untrusted authority claims.
Read the [ADRs](adr/) for product and support decisions. The hosted product is recoverable from
[its archive reference](adr/0005-archive-hosted-product.md).

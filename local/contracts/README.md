# Breakdown Local Contracts

Document kind: Contract index (non-normative)

Contract version: 1.0.1

This directory is the self-contained source corpus for Breakdown Local
1.0.1. `VERSION` identifies the lockstep release.

- `specifications/` contains the authored normative meanings and invariants.
- `schemas/` owns public machine shapes.
- `catalogs/` owns fixed limits and enumerated operation, CLI, and MCP facts.
- `examples/` contains valid human-readable Workflow Definitions.
- `conformance/matrix.json` indexes every normative requirement and its
  observable row.
- `conformance/` contains reviewed literals, executable scenario descriptions,
  applicability, gates, and retained-evidence locations.
- `MANIFEST.json` records the path, media type, role, byte length, and SHA-256
  digest of every contracts archive payload entry.
- `LICENSE`, `NOTICE`, and `THIRD_PARTY_NOTICES.md` contain the complete legal
  material for the independently distributed archive.

Implementation source, tests, task guidance, and generated reference are not
normative. All schema references resolve within this directory without network
access. The manifest itself is authenticated by the outer archive digest in the
release manifest and `SHA256SUMS`; a file cannot contain its own exact byte
digest. Mutable branches and discovery services cannot redefine this version.

# CLI reference

Document kind: Generated reference

Document version: 1.0.0

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/catalogs/cli.v1.json` — SHA-256 `016b77716dbbf49423264531bdc7a464438feb1e28cb91aaf2a8cb5ccd9ea7e8`
- `local/contracts/schemas/breakdown.cli-output.v1.schema.json` — SHA-256 `51503d15c9f3131ce84a63f099f3f55b241551d747b2fee389686dbe59ac37e9`
- `local/contracts/specifications/cli.md` — SHA-256 `158bd2612633f8e046b62c13aa8ed010e8e215b59f99a8c714e0e98986719f17`
- `local/docs/release-metadata.json` — SHA-256 `ae6d4a39b7a94ddccf22505a6b85a1fb7ccc5d2be588e21519e9987094a75f70`


## Commands

| Command | Surface |
| --- | --- |
| `breakdown workflow validate --project PATH [--json]` | Human |
| `breakdown run create --project PATH [--input ID=PATH]... [--json]` | Human |
| `breakdown run inspect --project PATH --run RUN_ID [--json]` | Human |
| `breakdown operate --project PATH` | Strict automation |

Every command requires an explicit project path. Exact Run inspection also requires an exact Run
ID. Machine clients use the automation command and parse one versioned stdout envelope.

## Exit codes

| Outcome | Exit code |
| --- | --- |
| `success` | `0` |
| `usage` | `2` |
| `invalid` | `3` |
| `conflict` | `4` |
| `unsupported` | `5` |
| `cancelled` | `6` |
| `resource_limit` | `7` |
| `io` | `8` |
| `internal` | `70` |

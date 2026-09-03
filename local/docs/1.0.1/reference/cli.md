# CLI reference

Document kind: Generated reference

Document version: 1.0.1

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/catalogs/cli.v1.json` — SHA-256 `cb1fd448b342f8ba3e071b53ab3344972549b352bef1720105469358890cff36`
- `local/contracts/schemas/breakdown.cli-output.v1.schema.json` — SHA-256 `4c32dd5d1fd733e514d8992b817e818694d007a3882f5fb4eca7be1cb0cae809`
- `local/contracts/specifications/cli.md` — SHA-256 `08df47e895fb4dc3255429bd12668e25a52eefb49add7deed72fe8a9d96ddeed`
- `local/docs/release-metadata.json` — SHA-256 `f425ce5a60cdfb6418c950f2ecc007838af04b3383bc41229d84befd62dced99`


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

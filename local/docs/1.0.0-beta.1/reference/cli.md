# CLI reference

Document kind: Generated reference

Document version: 1.0.0-beta.1

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/catalogs/cli.v1.json` — SHA-256 `d576acf0d0a8170b8f10bd1da6512f75f54d2509302ccc0a8981a5a9c822432a`
- `local/contracts/schemas/breakdown.cli-output.v1.schema.json` — SHA-256 `b6335bdb5a6b7262930c14820e98eb1de771918d421c5a16fa2d890e84bb0540`
- `local/contracts/specifications/cli.md` — SHA-256 `2ffc12ccfe95f9807182c61dc445d2969a78476525714adce7419603a7e94100`
- `local/docs/release-metadata.json` — SHA-256 `d7b0c39659bb90919227fc93d30bb4359fe5ae164533ed71ae336f58c5ae6500`


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

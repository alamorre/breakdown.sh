# Automation reference

Document kind: Generated reference

Document version: 1.0.0

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/catalogs/operations.v1.json` — SHA-256 `1367d8ddc86e9960b4dc8cd92a1398b706566412618b84784ce1e7e793d1b29c`
- `local/contracts/schemas/breakdown.operation-request.v1.schema.json` — SHA-256 `d1e0fd4fdbb711d3d1452802ba42ea5e059f6726bdf45447bd5c8bddd2152e3e`
- `local/contracts/schemas/breakdown.operation-value.v1.schema.json` — SHA-256 `4484e729885785b745db13851484c4a1238f095ec377e43d338e98080dcdc83c`
- `local/contracts/specifications/operations.md` — SHA-256 `335f9f4c6334b951a6fb92b00ca7598727511e19f9c3ca407fdb0e09c7ce6856`
- `local/docs/release-metadata.json` — SHA-256 `ae6d4a39b7a94ddccf22505a6b85a1fb7ccc5d2be588e21519e9987094a75f70`


## Operations

1. `validate_workflow`
2. `create_run`
3. `inspect_run`
4. `prepare_work`
5. `read_work_input`
6. `submit_candidate`

## Schemas

| Role | Schema identifier |
| --- | --- |
| request | `breakdown.operation-request.v1` |
| value | `breakdown.operation-value.v1` |
| work_packet | `breakdown.work-packet.v1` |
| work_packet_batch | `breakdown.work-packet-batch.v1` |
| candidate | `breakdown.candidate.v1` |

## Structured failures

| Kind | Codes |
| --- | --- |
| `invalid` | `invalid_candidate`, `invalid_operation_request`, `invalid_prepare_work`, `invalid_run`, `invalid_work_input`, `invalid_workflow`, `invalid_workflow_input`, `project_root_required`, `run_complete`, `run_not_found` |
| `conflict` | `attempt_advanced`, `lock_recovery_mismatch`, `no_longer_runnable`, `refresh_target_not_complete`, `run_id_collision`, `run_locked`, `stale_context` |
| `unsupported` | `unsupported_filesystem`, `unsupported_operation`, `unsupported_version` |
| `cancelled` | `cancelled` |
| `resource_limit` | `limit_exceeded` |
| `io` | `io_error` |
| `internal` | `internal_error` |

Automation sends one strict `breakdown.operation-request.v1` JSON document plus LF to
`breakdown operate --project <absolute-project-root>` and receives one versioned stdout envelope.
It never scrapes human presentation.

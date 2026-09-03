# Automation reference

Document kind: Generated reference

Document version: 1.0.1

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/catalogs/operations.v1.json` — SHA-256 `64b023403f799b5d221081dc7ec29d3b3a32073335c595f8bab0d26b5f4c8f5d`
- `local/contracts/schemas/breakdown.operation-request.v1.schema.json` — SHA-256 `34d0dadac8c27fb8e2fa78b4e34bddc1440104bc855ce107c12bc55e86c52ff4`
- `local/contracts/schemas/breakdown.operation-value.v1.schema.json` — SHA-256 `5d0409986a6859abee9600e512bd3852b4a8ae98fa81355659d692bd31ab626d`
- `local/contracts/specifications/operations.md` — SHA-256 `137317c1442f9e85f02a564e309ac477c739a513085f6da9b336c10c08e40f80`
- `local/docs/release-metadata.json` — SHA-256 `f425ce5a60cdfb6418c950f2ecc007838af04b3383bc41229d84befd62dced99`


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

# Automation reference

Document kind: Generated reference

Document version: 1.0.0-beta.1

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/catalogs/operations.v1.json` — SHA-256 `451defe178513fc268649ed8037d4af42cb9e9ca0ceb0c566b9ed37b506fc5ac`
- `local/contracts/schemas/breakdown.operation-request.v1.schema.json` — SHA-256 `76df8421ec8cf59d3338cfe3e4fff17375a0a30b45194a01c463cfddaee815e9`
- `local/contracts/schemas/breakdown.operation-value.v1.schema.json` — SHA-256 `d4f7b58dd1c74ab0b52d118b4a2e382053d155a71a70d9e08cdbcbf01b5bb34f`
- `local/contracts/specifications/operations.md` — SHA-256 `a150e44954b9667d1b384f8af11f289a901f718b23a0a4274b78b1f5820ac301`
- `local/docs/release-metadata.json` — SHA-256 `d7b0c39659bb90919227fc93d30bb4359fe5ae164533ed71ae336f58c5ae6500`


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

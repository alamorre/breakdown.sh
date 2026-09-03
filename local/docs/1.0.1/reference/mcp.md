# Optional local stdio MCP reference

Document kind: Generated reference

Document version: 1.0.1

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/catalogs/mcp.v1.json` — SHA-256 `e4d7c8e2ddf7b9003601abad7377c5f36b5ead30f08b89b0ecc260163329eb16`
- `local/contracts/schemas/breakdown.mcp-output.v1.schema.json` — SHA-256 `3206b16bcaaedd9f8d69038e372f614231553ae49643e3dbe85feacd5c7bf4ab`
- `local/contracts/specifications/mcp.md` — SHA-256 `8d18f73c2d9485776e0cf417e51ec93a1a3afe2fcfb9698478cb94d0844d6c79`
- `local/docs/release-metadata.json` — SHA-256 `f425ce5a60cdfb6418c950f2ecc007838af04b3383bc41229d84befd62dced99`


MCP is optional. The canonical CLI remains the baseline and both transports dispatch the same
operation semantics.

## Server

- Package: `@breakdown-sh/mcp@1.0.1`
- Executable: `breakdown-mcp`
- Transport: `stdio`
- Protocol window: `2025-06-18`, `2025-11-25`

## Tools

| Tool | Description | Read only | Idempotent |
| --- | --- | --- | --- |
| `validate_workflow` | Validate the project Workflow Definition. | yes | yes |
| `create_run` | Create a new immutable Run. | no | no |
| `inspect_run` | Inspect one exact Run and its derived state. | yes | yes |
| `prepare_work` | Prepare deterministic Work Packets without creating a claim. | yes | yes |
| `read_work_input` | Read one exact Input named by a Work Packet. | yes | yes |
| `submit_candidate` | Validate and publish one Candidate Outcome. | no | no |

The adapter provides no `resources`, `prompts`, `tasks`, `progress`, `logging`, `sampling`, `elicitation`, `completion`, `roots`, `dynamic_tools`, `http`, `daemon`, `auth`, `hosted_fallback`.
Host-specific installation and registration instructions come only from the canonical setup
references under `local/skills/setup-breakdown/references/`.

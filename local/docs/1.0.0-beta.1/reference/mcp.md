# Optional local stdio MCP reference

Document kind: Generated reference

Document version: 1.0.0-beta.1

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/catalogs/mcp.v1.json` — SHA-256 `7522850a19272bbee30d4aad7b4b9602330676ff581a4cbd078c6bff71332180`
- `local/contracts/schemas/breakdown.mcp-output.v1.schema.json` — SHA-256 `251c53bab881c53f3147c17a8e6ae3e664539526fa63bb4db1a05c9ec2c51716`
- `local/contracts/specifications/mcp.md` — SHA-256 `57a62eda32bb38b0d432da152d42f04af334229bf8e03fc8805b13ffa755b0f7`
- `local/docs/release-metadata.json` — SHA-256 `d7b0c39659bb90919227fc93d30bb4359fe5ae164533ed71ae336f58c5ae6500`


MCP is optional. The canonical CLI remains the baseline and both transports dispatch the same
operation semantics.

## Server

- Package: `@breakdown-sh/mcp@1.0.0-beta.1`
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

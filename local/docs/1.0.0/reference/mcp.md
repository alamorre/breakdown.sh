# Optional local stdio MCP reference

Document kind: Generated reference

Document version: 1.0.0

This reference is non-normative. The named authored contracts, schemas, and catalogs remain
authoritative. Regenerate this file instead of editing it by hand.

## Generated from

- `local/contracts/catalogs/mcp.v1.json` — SHA-256 `a872a0f39e7775e951087e322f7182a6780186bd30e8ef93b43d1d94fc3524e3`
- `local/contracts/schemas/breakdown.mcp-output.v1.schema.json` — SHA-256 `57139ffc12da9c0fd4f940d9c824a4eb2c23fea4948aafa5c2a55a0147052569`
- `local/contracts/specifications/mcp.md` — SHA-256 `ec837c9b0c7c968e0ae0930b99fff82ceac027cdab0303a7b7cef48f5dffb2f7`
- `local/docs/release-metadata.json` — SHA-256 `41dadb3b249de0b06de694ae42293f417c0be04ded75903c05c4e9f7fc1a3b81`


MCP is optional. The canonical CLI remains the baseline and both transports dispatch the same
operation semantics.

## Server

- Package: `@breakdown-sh/mcp@1.0.0`
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

# OpenCode project setup

Install the unchanged canonical directories under `<project>/.agents/skills/`.

For optional MCP, propose an exact diff to the applicable `opencode.json` or `opencode.jsonc` and
ask before writing it:

```json
{
  "mcp": {
    "breakdown-local": {
      "type": "local",
      "command": [
        "npm",
        "exec",
        "--yes",
        "--package=@breakdown-sh/mcp@1.0.0-beta.1",
        "--",
        "breakdown-mcp"
      ],
      "enabled": true
    }
  }
}
```

Preserve unrelated configuration. The command's cwd does not select a Breakdown project; every
operation supplies an explicit absolute root.

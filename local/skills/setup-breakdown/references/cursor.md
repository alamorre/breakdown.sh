# Cursor project setup

Document kind: Task-oriented guidance

Document version: 1.0.1

Install the unchanged canonical directories under `<project>/.agents/skills/`.

For optional MCP, propose an exact diff to `<project>/.cursor/mcp.json` and ask before writing it:

```json
{
  "mcpServers": {
    "breakdown-local": {
      "type": "stdio",
      "command": "npm",
      "args": ["exec", "--yes", "--package=@breakdown-sh/mcp@1.0.1", "--", "breakdown-mcp"]
    }
  }
}
```

Preserve unrelated configuration. Every operation still requires an explicit absolute project root.

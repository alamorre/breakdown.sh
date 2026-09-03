# Claude Code project setup

Document kind: Task-oriented guidance

Document version: 1.0.1

Install the unchanged canonical directories under `<project>/.claude/skills/`.

Present this optional stdio registration command and ask before running it:

```text
claude mcp add --transport stdio breakdown-local -- npm exec --yes --package=@breakdown-sh/mcp@1.0.1 -- breakdown-mcp
```

Project MCP entries require the host's own approval. Operations must still supply an explicit
absolute project root; the config location and process cwd grant no project authority.

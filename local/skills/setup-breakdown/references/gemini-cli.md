# Gemini CLI project setup

Install the unchanged canonical directories under `<project>/.agents/skills/` and ensure the
workspace is trusted before expecting skill discovery.

Present this optional project-scope stdio registration command and ask before running it:

```text
gemini mcp add breakdown-local npm exec --yes --package=@breakdown-sh/mcp@1.0.0-beta.1 -- breakdown-mcp
```

Inspect the resulting argument vector before accepting it. Operations must provide an explicit
absolute project root and never derive it from MCP cwd or workspace settings.

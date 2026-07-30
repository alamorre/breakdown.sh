# GitHub Copilot CLI project setup

Document kind: Task-oriented guidance

Document version: 1.0.0

Install the unchanged canonical directories under `<project>/.agents/skills/`.

Present this optional stdio registration command and ask before running it:

```text
copilot mcp add breakdown-local -- npm exec --yes --package=@breakdown-sh/mcp@1.0.0 -- breakdown-mcp
```

Inspect the saved command and arguments. Operations must still pass one explicit absolute project
root; user configuration and process cwd are not project authority.

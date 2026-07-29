# GitHub Copilot CLI project setup

Install the unchanged canonical directories under `<project>/.agents/skills/`.

Present this optional stdio registration command and ask before running it:

```text
copilot mcp add breakdown-local -- npm exec --yes --package=@breakdown-sh/mcp@1.0.0-beta.1 -- breakdown-mcp
```

Inspect the saved command and arguments. Operations must still pass one explicit absolute project
root; user configuration and process cwd are not project authority.

# Codex project setup

Document kind: Task-oriented guidance

Document version: 1.0.0-beta.1

Install the unchanged canonical directories under `<project>/.agents/skills/`.

The optional local stdio adapter is user or trusted-project configuration, not project authority.
Present this command with the exact version and ask before running it:

```text
codex mcp add breakdown-local -- npm exec --yes --package=@breakdown-sh/mcp@1.0.0-beta.1 -- breakdown-mcp
```

After configuration, start a fresh host session if required for skill or MCP discovery. Operations
must still supply an explicit absolute project root; server cwd and host workspace state do not
select it.

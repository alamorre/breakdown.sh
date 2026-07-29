# Exact installation and upgrade

Breakdown Local uses one full-SemVer release train. This skill pack expects `1.0.0-beta.1`.

## Inspect first

1. Resolve the selected project root explicitly.
2. Locate the project skill directory:
   - `.agents/skills/` for Codex, Gemini CLI, GitHub Copilot CLI, Cursor, and OpenCode.
   - `.claude/skills/` for Claude Code.
3. Read the `breakdown-sh.version` metadata from every installed canonical skill.
4. Run `node --version` and require Node `24.x`.
5. Run `breakdown --version` and require the exact value `1.0.0-beta.1`.
6. When MCP is selected, initialize the local stdio server and require
   `serverInfo.version` to equal `1.0.0-beta.1`.

Never use an unqualified npm tag, mutable branch, or "latest" URL as a version pin.

## CLI repair

Show this command and ask before running it:

```text
npm install --global @breakdown-sh/cli@1.0.0-beta.1
```

For an ephemeral, side-by-side invocation, use:

```text
npm exec --yes --package=@breakdown-sh/cli@1.0.0-beta.1 -- breakdown
```

Do not create or edit a project package manifest for Breakdown.

## Skill repair

The installer pinned for this release is `skills@1.5.20`. After approval, invoke exactly one command
from this list with its process working directory set to the selected absolute project root. Pass
the command as an argument vector; do not use a shell `cd`, current ambient directory, or repository
discovery to select the destination.

```text
# Codex
npx --yes skills@1.5.20 add https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0-beta.1/local/skills --skill setup-breakdown --skill author-breakdown --skill critique-breakdown --agent codex --copy --yes

# Claude Code
npx --yes skills@1.5.20 add https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0-beta.1/local/skills --skill setup-breakdown --skill author-breakdown --skill critique-breakdown --agent claude-code --copy --yes

# Gemini CLI
npx --yes skills@1.5.20 add https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0-beta.1/local/skills --skill setup-breakdown --skill author-breakdown --skill critique-breakdown --agent gemini-cli --copy --yes

# GitHub Copilot CLI
npx --yes skills@1.5.20 add https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0-beta.1/local/skills --skill setup-breakdown --skill author-breakdown --skill critique-breakdown --agent github-copilot --copy --yes

# Cursor
npx --yes skills@1.5.20 add https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0-beta.1/local/skills --skill setup-breakdown --skill author-breakdown --skill critique-breakdown --agent cursor --copy --yes

# OpenCode
npx --yes skills@1.5.20 add https://github.com/alamorre/breakdown.sh/tree/breakdown-local-v1.0.0-beta.1/local/skills --skill setup-breakdown --skill author-breakdown --skill critique-breakdown --agent opencode --copy --yes
```

These commands select an immutable Breakdown release tag, three named skill directories, the exact
host adapter, and copy semantics. Do not omit `--copy` or replace either version with a tag such as
`latest`.

The installer-independent fallback is the immutable
`breakdown-skills-1.0.0-beta.1.tar.gz` or `.zip` asset from the
`breakdown-local-v1.0.0-beta.1` GitHub Release. Verify its exact entry in that Release's signed
`SHA256SUMS`, then copy each directory unchanged into the host's project skill location. Do not
merge old and new directory contents.

The setup skill cannot bootstrap itself. Initial placement must come from the immutable release
archive or the pinned installer above.

## Upgrade and rollback

An upgrade replaces the CLI, optional MCP registration, and all skills with one exact matching
release, then runs full preflight. It never rewrites `breakdown.yaml`, `outputs/`, Results, Runs, or
StepArtifacts. Rollback selects another complete exact release set and follows the same rule.

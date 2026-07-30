---
name: summarize-breakdown-run
description: Conversationally summarize one exact Breakdown Run from its validated Selected Terminal Results and inspected history without creating a durable summary. Use when the user asks for the outcome, status, gaps, stale work, or non-success history of a specific Run.
license: Apache-2.0. See LICENSE.
compatibility: Requires Linux or macOS, local project access, Node.js 24, and @breakdown-sh/cli 1.0.0.
metadata:
  breakdown-sh.pack: breakdown-local
  breakdown-sh.version: '1.0.0'
---

# Summarize an Exact Run

Document kind: Task-oriented guidance

Document version: 1.0.0

Return a conversational view of one inspected Run. A summary is not a Result, StepArtifact, Run
state, or other durable Breakdown record.

## Exact-version preflight

1. Obtain one explicit absolute project root and an exact Run ID from the user. Never infer either
   from cwd, a repository, environment, workspace hint, MCP Root, `outputs/`, recency, or a prior
   conversation.
2. Run the setup skill's verifier in read-only fast mode:

   ```text
   node <setup-breakdown>/scripts/preflight.mjs --mode fast --skill summarize-breakdown-run --project <absolute-root> --host <surface> --host-version <version>
   ```

   When MCP is selected, append `--mcp-command <command>` and one `--mcp-arg <argument>` for each
   configured argument.
3. Stop on a release, Node, CLI, automation-schema, or selected MCP mismatch and route the user to
   `setup-breakdown`.

## Validated summary

Load [references/summary-protocol.md](references/summary-protocol.md), then:

1. Call `breakdown operate --project <absolute-root>` with an exact
   `breakdown.operation-request.v1` `inspect_run` request. Stop on structured failure; do not reason
   around an invalid Run.
2. Read content only from the Result files named by successful `data.terminal_results`. These are
   the current Selected Terminal Results. Do not read unselected attempts, stale Results,
   non-success artifacts, intermediate Results, nearby files, the live Workflow Definition, or a
   guessed latest Run.
3. Use `data.nodes` and `data.attempts` metadata to distinguish current Selected Results, stale node
   history, and failed, blocked, or cancelled attempts without reading those histories as evidence.
4. Re-inspect the same exact Run after reading and before presenting. If relevant inspected state or
   Selected Terminal Result identity changed, discard the draft and report that the Run changed.
5. Present the Run identity and status, the Selected Terminal Result outcomes, incomplete or stale
   gaps, and non-success history. Clearly separate Result content from your synthesis.

## Non-mutation guarantee

Create no durable summary, file, cache, Run, Result, StepArtifact, Candidate Outcome, package state,
Git change, or host configuration. Do not refresh, resume, recover a lock, or submit work. Return
the summary only in the active conversation.

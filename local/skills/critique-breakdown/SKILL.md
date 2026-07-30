---
name: critique-breakdown
description: Review an existing Breakdown Workflow Definition for unclear outcomes, poor decomposition, missing or false dependencies, weak evidence or verification, excess context, duplication, and unusable Results. Use when the user asks to critique, review, or improve a Breakdown workflow without changing it.
license: Apache-2.0. See LICENSE.
compatibility: Requires Linux or macOS, local project access, Node.js 24, and @breakdown-sh/cli 1.0.0.
metadata:
  breakdown-sh.pack: breakdown-local
  breakdown-sh.version: '1.0.0'
---

# Critique a Workflow Definition

Document kind: Task-oriented guidance

Document version: 1.0.0

This skill is always read-only. It reports findings; applying them belongs to `author-breakdown`
after separate confirmation.

## Exact-version preflight

1. Obtain one explicit absolute project root. Never infer it from cwd, a repository, environment,
   workspace hint, or MCP Root.
2. Before main work, run the setup skill's verifier in read-only fast mode:

   ```text
   node <setup-breakdown>/scripts/preflight.mjs --mode fast --skill critique-breakdown --project <absolute-root> --host <surface> --host-version <version>
   ```

   When MCP is selected, append `--mcp-command <command>` and one `--mcp-arg <argument>` for each
   configured argument so the verifier initializes that exact server and checks its full version.

3. Stop on any release, Node, CLI, automation-schema, or selected MCP mismatch and route the user to
   `setup-breakdown`.

## Validation gate

Call the deterministic validator before semantic review:

```text
breakdown workflow validate --project <absolute-root> --json
```

If validation fails, present the ordered core diagnostics and stop. Do not repair, reinterpret, or
critique around an invalid Workflow Definition.

## Read-only review

For a valid definition, read `breakdown.yaml` and
[references/critique-rubric.md](references/critique-rubric.md). Assess:

- whether the Terminal Results answer the intended problem and are independently usable;
- node cohesion and meaningful Result handoffs;
- missing, false, duplicate, or unnecessarily serial dependencies;
- independent branches that should remain parallel;
- missing comparison, reconciliation, synthesis, or revision;
- duplicate work, excessive fan-in, and irrelevant context;
- prompts lacking method, evidence, citations, uncertainty, completion, or Result requirements;
- ungrounded self-critique or verification that inherits the producer's assumptions;
- Data Contracts that are missing for a real machine consumer or added without one; and
- prompts or project content that confuse requested effects with Run Authority.

For each finding, give severity, affected Node Definitions or Input Bindings, rationale, and a
specific proposed change. Distinguish correctness risks from judgment calls. Note strengths that
should survive revision.

## Non-mutation guarantee

Do not write or patch `breakdown.yaml`; create a Run, output, Result, StepArtifact, summary file,
cache, package file, Git change, or host configuration; or invoke authoring on the user's behalf.
Return the critique conversationally. If the user wants changes, hand the confirmed findings to
`author-breakdown`.

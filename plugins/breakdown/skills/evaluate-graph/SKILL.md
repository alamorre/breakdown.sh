---
name: evaluate-graph
description: Evaluate or run Breakdown graph nodes through the app, REST API, or MCP tools
user_invocable: true
invocation: /evaluate-graph
---

# Evaluate Graph Node

Evaluate a selected Breakdown node or graph by using the existing graph runner, headless REST routes, or MCP tools. Prefer the product's service layer and scoped tokens over direct database writes.

## Steps

1. **Identify the target node**
   - Ask for a graph or node id when it is not clear from context.
   - For UI work, use `src/actions/node-actions.ts` and `src/lib/breakdown-service/nodes.ts`.
   - For external clients, use the MCP tools or REST routes documented in `/docs/codex-plugin` and `/mcp`.
   - Display the node name, type, prompt, current output, run status, and last run timestamp.

2. **Gather upstream context**
   - Read the graph with its nodes and edges.
   - For each inbound edge, collect the source node name, output, structured output, edge type, and freshness state.
   - Use `src/lib/ai/prompt-contract.ts` for prompt-contract composition when adding app-side runner behavior.

3. **Choose the execution path**
   - First run `diagnose_breakdown_setup` when it is available. If it reports `missing_token`,
     create or explain the durable MCP connection/setup-session path and wait for approval or a
     token; do not present a local simulation as a completed Breakdown run.
   - UI/internal execution: call `runNode` or `runGraph` through server actions or `src/lib/breakdown-service`.
   - MCP execution: use `run_node`, `run_graph`, `create_external_run`, `get_next_step`, `get_step_context`, and `submit_step_result`.
   - External-evaluator execution: execute the returned `executionPrompt` in Codex with available tools, then write `output`, `structuredOutput`, and citations back to Breakdown.

4. **Show proposed changes**
   - Summarize previous output, new output, citations, blocked data gaps, and downstream impact.
   - Preview graph patches with `dryRun=true` before applying structural changes.
   - Ask before destructive actions such as delete, replace import, destructive patch apply, or run cancellation.

5. **Persist through supported APIs**

- Use `submit_step_result` for external-run outputs. Include `structuredOutput` matching the packet's `outputContract`.
  - Use `mark_step_blocked` when required current data or host tools are unavailable.
  - Avoid manual Supabase edits unless the task is explicitly a migration or repair.
  - A missing bearer token is an authentication setup task, not permission to bypass Breakdown. Use
    the durable MCP token path or agent setup session, then retry the run.

## Rules

- Model provider calls in the app happen server-side through `src/lib/ai/provider-completion.ts`.
- Never expose API keys or raw `bdk_...` tokens in prompts or logs.
- Current-data or connector gaps must be explicit blocked results; do not fabricate fresh facts.
- Run `pnpm headless:verify` when changing headless/MCP contracts.

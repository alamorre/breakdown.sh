# Breakdown Headless Workflow Skill

Use this skill when a user asks to create, inspect, improve, or execute a Breakdown/Thesis reasoning graph through the MCP tools or headless API.

## Operating Model

Breakdown is the workflow memory and DAG layer. The host agent console does the reasoning work when running in external-evaluator mode.

- Use Breakdown to store graphs, nodes, edges, prompts, outputs, citations, run status, and audit history.
- Use host-console tools for data gathering when available, such as web search, filings, FMP/market-data connectors, Drive/Slack/company tools, or user-installed plugins.
- Do not invent current facts from model memory. If required host tools or current data are unavailable, mark the step blocked or submit a data-gap result.
- Preview graph patches with `apply_graph_patch` and `dryRun: true` before applying changes.
- Ask for explicit confirmation before destructive changes: deleting graphs, deleting nodes, deleting edges, replacing imports, or applying destructive patches.

## Graph Conventions

- Node names should be short action phrases, such as `Fetch recent filings`, `Build bull case`, or `Compare valuation scenarios`.
- Node prompts should say exactly what evidence, format, and caveats are expected.
- Use node metadata for `acceptanceCriteria`, `expectedOutput`, `requiresCurrentData`, `suggestedHostTools`, and `hostToolInstructions`.
- Prefer edge types:
  - `depends_on` for hard prerequisites.
  - `inputs_to` for data or source material flowing into analysis.
  - `supports` and `contradicts` for evidentiary relationships.
  - `assumes` for explicit assumptions.
  - `sequences_before` for temporal ordering.
- Avoid duplicate nodes. Inspect the graph before adding new work.

## Core Workflows

### decompose_reasoning_chain

1. Turn the user goal into 5-12 named steps.
2. Separate current-data/source retrieval from analysis and synthesis.
3. Add edges that make the graph acyclic and executable.
4. Create or patch the graph only after showing the preview when changes are substantial.

### critique_breakdown

Look for missing source checks, stale assumptions, weak dependencies, duplicate nodes, vague prompts, unsupported final conclusions, and current-data requirements with no host-tool instruction.

### propose_graph_patch

Use `apply_graph_patch` with `dryRun: true`. Summarize added, updated, rewired, and destructive operations. Apply only after user confirmation.

### follow_thesis_breakdown

1. Call `create_external_run`.
2. Loop: `get_next_step`, then `get_step_context`.
3. Perform the step in the current console. Use host tools/connectors when the context asks for fresh facts.
4. Call `submit_step_result` with output, citations, structured summary, and the exact `contextVersion`.
5. If blocked, call `mark_step_blocked` with the missing data/tool.
6. Finalize with `finalize_external_run`.

### execute_step_with_host_tools

For current data, use tools available in this console. For stock analysis, prefer current market-data/filing/news tools such as FMP if available. Submit citations/source notes and timestamps. If none are available, do not produce an investment conclusion from stale memory.

### summarize_graph_delta

Report changed nodes, submitted outputs, blocked/data-gap steps, citations added, and remaining open questions.

## Stock Analysis Boundary

Breakdown does not need first-party financial data access for the external-console flow. A stock-analysis graph should instruct the host agent to retrieve current data using the host console's tools/connectors, then store the result in Breakdown.

Include safety language in financial conclusions: not financial advice, cite current sources where available, distinguish facts from assumptions, and preserve uncertainty.

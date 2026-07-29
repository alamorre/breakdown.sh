# Exact-Run Summary Protocol

This reference defines read-only summary behavior for Breakdown Local `1.0.0-beta.1`.

## Stable inspection

Send this exact versioned operation to `breakdown operate --project <absolute-root>`:

```json
{"schema_version":"breakdown.operation-request.v1","operation":"inspect_run","run_id":"<exact-run-id>"}
```

Accept only one `breakdown.cli-output.v1` document. On `ok: false`, present its structured kind,
code, message, and diagnostics and stop. Do not open Run files to repair, reinterpret, or summarize
an invalid inspection.

Keep these successful `data` fields from the first inspection:

- `run_id`, `path`, and `status`;
- `workflow` and resolved `inputs` identity;
- `nodes`, including state, `stale`, next attempt, and Selected Result metadata;
- `attempts`, including status and `selected`;
- `terminal_results`, the only Result descriptors whose contents may be read; and
- `lock`, as status metadata only.

## Allowed reads

For each descriptor in `terminal_results`, read exactly its project-relative `markdown.path` and,
when present, `json.path`. Verify each file's raw SHA-256 against the matching descriptor before
using its content. The Markdown StepArtifact frontmatter is provenance; summarize the Result body
after the closing frontmatter delimiter. Structured JSON supplements the same complete Result and
does not replace its Markdown.

Read no Result path obtained from `nodes`, `attempts`, directory enumeration, stale history, a
previous response, or user guess. In particular:

- a succeeded attempt with `selected: false` is unselected or stale history, not current evidence;
- `nodes[].stale: true` means prior success exists but no Result matches current Node Context;
- failed, blocked, and cancelled attempts are non-success history and have no Result; and
- an incomplete Run can have zero or only some Selected Terminal Results.

Use only inspection metadata—not unselected artifact bodies—to report stale and non-success history.
Do not imply that a prior Selected Result is current merely because it exists on disk.

## Re-inspection gate

After all allowed Result reads and before presenting, repeat the same exact `inspect_run` operation.
Compare Run ID, status, workflow/Input identity, nodes, attempts, terminal Results, and lock with the
first inspection. Recheck that every read descriptor and raw hash is still a current Selected
Terminal Result. If any relevant value changed, discard the draft, say the exact Run changed during
the read, and stop; a later request may start a fresh summary.

## Conversational output

Identify the exact Run and whether it is complete or incomplete. Then present:

1. each Selected Terminal Result by Terminal Node ID and selected attempt, faithfully separating
   the Result's claims from your own synthesis;
2. important agreements, conflicts, uncertainty, cited evidence, and declared data gaps found in
   those Results;
3. runnable or blocked nodes and stale history that keep the Run incomplete; and
4. failed, blocked, or cancelled attempt history from inspection metadata, without treating its
   diagnostic Markdown as a Result.

If `terminal_results` is empty, say that there is no current Selected Terminal Result to summarize.
Do not manufacture an outcome from intermediate, stale, or non-success history.

Return only conversational prose. There is no durable summary schema, summary operation, summary
node kind, summary file, migration skill, or permission to write inside or outside the Run.

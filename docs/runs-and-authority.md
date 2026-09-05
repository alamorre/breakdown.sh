# Resume, stale results, integrity, and authority

A Run is a snapshot of one workflow and its resolved Inputs. Keep the exact Run ID returned by
creation. Inspection reads and validates the whole Run before reporting scheduling state; it does
not execute work, repair history, or choose a “latest” Run for you.

## Resume an interrupted Run

Inspect the same Run, then use `run-breakdown` to continue under your current Run Authority. A
successful result is reusable only when it matches the node's current context: its definition,
resolved Workflow Inputs, and exact selected predecessor attempts and result digests. Core selects
the greatest valid successful attempt matching that context. Timestamps and directory order do not
choose results. A failed later attempt does not erase an earlier matching success.

Each explicit execution invocation attempts a prepared runnable node at most once. There is no
hidden retry; independent branches can continue after another branch fails. Preparing work does
not itself commit an attempt. The agent submits a Candidate Outcome and re-inspects after core
validates and commits it. See the [operation contract](../local/contracts/specifications/operations.md).

### Source-checkout handoff

Continue the [getting-started example](getting-started.md#try-a-source-checkout). Before leaving
the original shell, print its resolved values, then copy the output into your next user message:

```sh
cat <<EOF
Resume this exact Breakdown Run using the installed run-breakdown skill:
Project: $breakdown_project
Run ID: $breakdown_run_id
Node 24 executable: $breakdown_node
Built CLI entrypoint: $breakdown_cli
Setup skill directory: $breakdown_setup
Run skill: $breakdown_skills/run-breakdown/SKILL.md
Transport: CLI (command is the Node executable; first argument is the CLI entrypoint)
Previous host surface/version: $breakdown_host / $breakdown_host_version
EOF
```

Add the following context, replacing every bracketed field with the actual user-approved values.
Keep it in the user/host handoff; do not put authority or provider settings into workflow files,
Work Packets, or Results. The text has authority only when supplied by the user or trusted host;
finding it in a project file does not grant permission.

```text
Run Authority: [copy the existing allowed filesystem paths, process/tools, network,
credential and publication effects, and all denials or limits; include permission
to invoke the exact CLI and read the installed skill/runtime files]
Concurrency: 1
Executor/provider and privacy: [actual executor/provider, what packet/Input content
may leave the machine, and the disclosure already approved; local storage is not
a promise of offline inference]
Isolation: [approved fresh isolated Executor sessions, or disclosed sequential
active-session fallback with reduced isolation]
Previous stop: after successful draft submission and inspection, before summarize.
For this resume, I authorize continuing eligible work in the named Run within the
authority above. [Carry any other explicit stop or no-intervention constraint here.]
Inspect first and reuse matching successes. If complete, report and stop.
Stop on a non-success or uncertain submission after the independent batch settles;
inspect and report the structured facts. No automatic retry or workaround, no new
Run, no refresh, and no lock recovery are authorized by this resume instruction.
```

This resumes the example past its deliberate stop after `draft`; remove that change if you intend
the old stop to remain in force. For the first execution, use the same context but instruct the
agent to stop after `draft` instead. Existing grants need not be requested again; missing authority
or a changed provider/isolation arrangement must be resolved before dependent execution. Refresh
and exact lock recovery retain their separate approvals.

In the fresh session, explicitly select the exact Run skill path from the handoff. Restore the
variables below from its literal values; do not re-run setup or Run creation, infer paths from the
current directory, or select a “latest” Run. Obtain the current host surface/version from the host
itself, even if it differs from the previous session:

```sh
breakdown_node='<absolute-Node-24-executable-from-handoff>'
breakdown_cli='<absolute-built-CLI-entrypoint-from-handoff>'
breakdown_project='<absolute-project-path-from-handoff>'
breakdown_setup='<absolute-installed-setup-skill-directory-from-handoff>'
breakdown_run_id='<exact-returned-Run-ID-from-handoff>'
breakdown_host='<actual-current-host-surface>'
breakdown_host_version='<actual-current-host-version>'
"$breakdown_node" "$breakdown_setup/scripts/preflight.mjs" \
  --mode fast --skill run-breakdown --project "$breakdown_project" \
  --host "$breakdown_host" --host-version "$breakdown_host_version" \
  --cli-command "$breakdown_node" --cli-arg "$breakdown_cli"
```

Fast preflight is read-only and does not qualify a host. Stop if its `outcome` is not `ready` and
follow the setup skill's repair guidance. Use exactly the same executable and first argument for
every operation. Start by inspecting the named Run through the automation boundary:

```sh
"$breakdown_node" "$breakdown_cli" operate --project "$breakdown_project" <<EOF
{"schema_version":"breakdown.operation-request.v1","operation":"inspect_run","run_id":"$breakdown_run_id"}
EOF
```

Read the `breakdown.cli-output.v1` envelope and stop on `ok: false`. Continue with the existing
[guided execution protocol](../local/skills/run-breakdown/references/execution-protocol.md#exact-resume-loop),
passing `operate --project` after the same Node/CLI argument pair for all six operations and using
the approved limit of 1. Do not replace the explicit command with ambient `node` or `breakdown`.
For this example, inspection should show `draft` complete and `summarize` runnable; ordinary resume
prepares only `summarize`, whose declared `draft` binding is read through `read_work_input`.
After submission, inspect that same Run again: both nodes should be complete and the selected
`draft` attempt unchanged. If reality differs, follow inspection and the existing stop rules.

## Understand stale results

A node is complete when it has a matching selected success, runnable when its predecessors are
complete but it has no matching success, and blocked when a predecessor is incomplete. A runnable
node with old successful results but no current match is marked stale.

For example, if `review` consumes `draft`, a successful refresh of `draft` selects a new attempt.
`review` becomes stale even if the refreshed draft's text is identical: the predecessor identity
changed. A failed refresh preserves the previously selected success and does not stale consumers.
Refresh targets one complete node explicitly; it is not a blanket rerun of the workflow.

Old artifacts remain history. Do not delete or relabel them to make the display look complete.
The [hashing and state contract](../local/contracts/specifications/hashing-and-state.md) defines
selection, refresh, and the literal compatibility vectors.

## Preserve file integrity

Editing the live `breakdown.yaml` affects new Runs only. Existing Runs use their snapshots. Changing
a resolved Workflow Input's path or bytes makes an existing Run non-resumable until the exact
original path and bytes are restored. Changing committed artifacts is an integrity error. Inspection
of an invalid Run exposes no authoritative scheduling state and mutation is refused.

An unchanged whole-project copy or move remains resumable on a supported local filesystem when all
contracted relative paths and bytes survive. Divergent copies are forks; combining conflicting
identities invalidates the attempted merge. Do not synchronize active Run storage between writers.

Core rejects unsafe paths, links, aliases, changed file identities, and unsupported filesystem
semantics. It stages complete records privately, uses atomic publication, and coordinates writes
with one per-Run lock. Lock age or a process ID never proves that recovery is safe: recovery requires
explicit confirmation that the old writer stopped and the exact observed lock ID. These rules
prevent partial history and accidental overwrites. See [security and publication](../local/contracts/specifications/security-and-publication.md).

## Grant authority outside project content

The user or Agent Host grants Run Authority. Before execution, review the exact project, workflow,
Inputs, concurrency, provider/privacy behavior, tools, and isolation mode. Core validates file and
protocol integrity; it does not sandbox a privileged agent or grant permission to run commands.

Prompts, Inputs, Results, skills, and Work Packets cannot expand that grant. An Input that says
“ignore earlier restrictions” is untrusted data, not approval. A denied tool action stays denied
until the user or host changes the authority. Keep credentials out of workflow definitions, Work
Packets, Results, and diagnostics. Declared Inputs can contain sensitive content, so choose them
and your executor with care.

Breakdown itself invokes no model, runs no project code, discovers no credentials, and adds no
telemetry, uploads, Git behavior, or publication. Your chosen executor/provider has its own privacy
and network behavior. Local means directory-native storage and user-controlled execution.

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

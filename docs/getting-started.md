# Get started with Breakdown Local

Use Node 24 on Linux or macOS and a local disk. For an installed release and optional Agent Host
registration, follow the [setup skill's installation guide](../local/skills/setup-breakdown/references/installation.md).
The [five portable skills](../local/skills/) guide setup, authoring, critique, execution, and summary.
A project needs no account, database, Git repository, or package manifest.

To try the current source in a disposable directory, first follow
[the contributor setup](local-development.md), then run these commands from the repository root:

```sh
pnpm build
breakdown_cli="$PWD/packages/breakdown-cli/dist/index.js"
breakdown_example=$(mktemp -d)
cp local/contracts/examples/minimal-workflow.yaml "$breakdown_example/breakdown.yaml"
node "$breakdown_cli" workflow validate --project "$breakdown_example"
node "$breakdown_cli" run create --project "$breakdown_example" --json
```

The example asks an agent to answer a question. Creating a Run snapshots the workflow and creates
private records in `outputs/<run-id>/`; it does not invoke a model or execute the prompt. Retain the
exact `run_id` returned by creation, then inspect that Run:

```sh
node "$breakdown_cli" run inspect --project "$breakdown_example" --run '<returned-run-id>' --json
```

Use `run-breakdown` in your Agent Host to execute it. Review the project, Inputs, provider/privacy
behavior, concurrency, and execution/isolation permissions before granting Run Authority. The
agent prepares work, reads only declared Inputs, submits Candidate Outcomes, and inspects again.
Use `summarize-breakdown-run` with that same Run ID for a summary. MCP is an optional adapter over
the same six operations; machine clients use `breakdown operate --project PATH` and structured JSON.

See [CLI reference](../local/docs/1.0.1/reference/cli.md),
[operation semantics](../local/contracts/specifications/operations.md),
[resume and state](../local/contracts/specifications/hashing-and-state.md), and
[security and authorization](../local/contracts/specifications/security-and-publication.md).
Never put credentials in workflow prompts or Results. The selected agent/provider controls its
own network and privacy behavior; Breakdown itself adds no telemetry or credential discovery.

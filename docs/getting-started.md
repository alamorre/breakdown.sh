# Get started with Breakdown Local

Use Node 24 on Linux or macOS and a local disk. For an installed release and optional Agent Host
registration, follow the [setup skill's installation guide](../local/skills/setup-breakdown/references/installation.md).
The [five portable skills](../local/skills/) guide setup, authoring, critique, execution, and summary.
A project needs no account, database, Git repository, or package manifest.

## Try a source checkout

First follow [the contributor setup](local-development.md). Select Node 24 with your runtime
manager; for example, run `nvm use 24` if Node 24 is already installed through nvm. Then run the
following from the repository root in the same shell. Stop if any command fails. Retain the resolved
executable so a later session need not reconstruct your `PATH`:

```sh
breakdown_node=$(node -e 'if (process.versions.node.split(".")[0] !== "24") throw new Error("Select Node 24 first"); console.log(process.execPath)')
breakdown_checkout=$(pwd -P)
pnpm build
breakdown_cli="$breakdown_checkout/packages/breakdown-cli/dist/index.js"
"$breakdown_node" "$breakdown_cli" --version
```

Create a disposable project on a local disk and copy the five canonical skills from this checkout.
This example uses `.agents/skills`; use `.claude/skills` for Claude Code. These commands create a
new project and install skills there. An agent running them needs your approval for those changes.
Keep the whole project until you finish resuming it; temporary directories may be cleaned by the OS.

```sh
breakdown_project=$(mktemp -d)
breakdown_project=$("$breakdown_node" -e 'console.log(require("node:fs").realpathSync(process.argv[1]))' "$breakdown_project")
breakdown_skills="$breakdown_project/.agents/skills"
mkdir -p "$breakdown_skills"
cp -R "$breakdown_checkout/local/skills/." "$breakdown_skills/"
breakdown_setup="$breakdown_skills/setup-breakdown"
```

Open that exact project in your Agent Host and explicitly select the copied `setup-breakdown/SKILL.md`.
Check its resolved path using the [discovery guidance](vendored-skills.md#discovery-and-invocation).
Replace the host placeholders below with the actual surface and exact version supplied by the host.
After approval for the disposable filesystem probe, run full preflight with the same Node and CLI:

```sh
breakdown_host='<actual-host-surface>'
breakdown_host_version='<actual-host-version>'
"$breakdown_node" "$breakdown_setup/scripts/preflight.mjs" \
  --mode full --project "$breakdown_project" \
  --host "$breakdown_host" --host-version "$breakdown_host_version" \
  --cli-command "$breakdown_node" --cli-arg "$breakdown_cli"
```

Proceed only on `outcome: "ready"`; preserve the reported classification. A successful source
checkout probe without authenticated host evidence establishes Compatible Host, not Supported Host.
On failure, follow the setup skill; do not silently switch executables or install another release.

With approval to write the example workflow, create two small steps so you can stop after the first
and later reuse its Result:

```sh
cat > "$breakdown_project/breakdown.yaml" <<'YAML'
schema_version: breakdown.workflow.v1
id: resume-example
name: Resume example
nodes:
  - id: draft
    name: Draft
    prompt: Write one sentence explaining why saving work helps when interrupted.
  - id: summarize
    name: Summarize
    prompt: Summarize the supplied draft in one short sentence.
    inputs:
      draft:
        node: draft
YAML
"$breakdown_node" "$breakdown_cli" workflow validate --project "$breakdown_project" --json
```

Before an agent creates or executes a Run, approve the complete proposal described by
[run-breakdown](../local/skills/run-breakdown/SKILL.md#approval-and-execution): this exact root,
validated workflow, no Workflow Inputs, allowed tools/effects, concurrency, provider/privacy context,
and isolation mode. For this walkthrough choose concurrency **1** and stop after the successful
`draft` submission and inspection, before preparing `summarize`. If fresh isolated Executor sessions
are unavailable, disclose and approve sequential active-session execution with reduced isolation.
Then create exactly one Run and capture its ID from the successful JSON response:

```sh
breakdown_created=$("$breakdown_node" "$breakdown_cli" run create --project "$breakdown_project" --json)
breakdown_run_id=$("$breakdown_node" -e 'const r = JSON.parse(process.argv[1]); if (!r.ok || r.operation !== "create_run") throw new Error("Run creation failed"); console.log(r.data.run_id)' "$breakdown_created")
"$breakdown_node" "$breakdown_cli" run inspect --project "$breakdown_project" --run "$breakdown_run_id" --json
```

Creation snapshots the workflow in `outputs/<run-id>/`; it does not invoke a model or execute work.
Explicitly select the copied `run-breakdown/SKILL.md`, give it this exact Run ID and the approved
context, and use the [preflight and execution commands in the resume guide](runs-and-authority.md#source-checkout-handoff)
for this first execution too. Preserve the stop-after-`draft` instruction. After stopping, use that
guide's handoff to resume in a fresh session. Use `summarize-breakdown-run` with the same Run ID for a
summary. MCP remains an optional adapter over the same six operations; this example uses CLI only.

See [CLI reference](../local/docs/1.0.1/reference/cli.md),
[operation semantics](../local/contracts/specifications/operations.md),
[resume and state](../local/contracts/specifications/hashing-and-state.md), and
[security and authorization](../local/contracts/specifications/security-and-publication.md).
Never put credentials in workflow prompts or Results. The selected agent/provider controls its
own network and privacy behavior; Breakdown itself adds no telemetry or credential discovery.

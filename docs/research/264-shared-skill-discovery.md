# Shared skill discovery investigation (#264)

Observed 2026-09-04 (America/Vancouver), against main
`255d5d7234ed1421e110883e6c49d58aa657fe24`: Breakdown Local 1.0.1,
Codex CLI 0.153.4, Muse Code 1.0.2 (`1.0.2-R2040.1`), macOS arm64.
This is a discovery/invocation investigation, not Supported Host qualification.

## Finding

The missing `implement` entry in [the #276 trial](https://github.com/alamorre/breakdown.sh/issues/276#issuecomment-5548203921)
was **initial-catalog filtering**, not a missing installation. The project copy deliberately has
`policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Checking only `SKILL.md`
missed that policy. The vendored manifest already records explicit-only invocation as intentional.

Codex's registry contained all eight trial skills, including enabled, repo-scoped `implement`.
Its initial model prompt listed the other seven and omitted `implement`. Muse resolved the same
unchanged project directory, listed all eight, and marked `implement` `user-invocable-only`.
Its model catalog included that project entry with `model-invocable="false"`.

Both files in the installed trial `implement` directory matched the canonical source:

| File | SHA-256 |
| --- | --- |
| `SKILL.md` | `4eaeffd8e3f86bd110937a1bac9e91aa6c03cee03a30616f23ffbb8d412ce15c` |
| `agents/openai.yaml` | `8970a8596ade0c28ab427f41a4ea242d6bdf6186c59ebf55e1238dbecaab79dc` |

The canonical engineering source is `local/vendor/skills/`; the historical
`plugins/breakdown/skills/` premise in [#264](https://github.com/alamorre/breakdown.sh/issues/264)
predates the Local cleanup. A second host directory and synchronization generator are unnecessary
for these two tested versions. Keep complete directories, including sidecars, copied together.

## Controlled probes

Registry calls used the original trial directory without changing it. Prompt probes used fresh
processes and a loopback HTTP receiver to inspect the host-built request before model execution.
Codex used a temporary provider override without loading user config; Muse used a dummy key with
the local receiver and explicitly trusted the workspace for the run. No credentials were sent to
the receiver. Raw requests stayed outside the repository and are not publication artifacts.

Policy changes and the unique-name control happened only in disposable copies. The real user
skill and original trial installation remained unchanged. The observations below are host
registry/request evidence, not a model's recollection of available skills.

| Probe | Codex CLI 0.153.4 | Muse Code 1.0.2 |
| --- | --- | --- |
| Same unchanged trial `.agents/skills/` | All eight repo entries present and enabled in `skills/list` | All eight project entries present; no project parse diagnostics |
| Project and user both named `implement` | Registry retains both paths; does not merge them | Project wins; user copy has `skill-shadowed` diagnostic |
| Project policy `false` | Project `implement` absent from initial model catalog | Project entry present, `model-invocable="false"`; activation `user-invocable-only` |
| Change only project policy to `true` | Project entry appears in initial catalog | Activation `on`; restrictive catalog attribute removed |
| Restore project policy to `false` | Entry omitted again | Explicit-only state restored |
| Unique name, policy still `false` | Omitted implicitly; explicit `$issue264-implement` attaches the body | Not exercised |
| Bare `$implement` with duplicate names in `codex exec` | No skill body attached automatically | Not a cross-host invocation syntax claim |
| Native explicit invocation | Exact resolved project path attaches project body despite policy `false` | Interactive `/skill implement` loads project body with matching SHA-256 |
| Explicit selection with the exact resolved user path | User body attached, including its `disable-model-invocation: true` frontmatter | Shadowed user copy is not the resolved `implement` |

Codex's path-qualified Markdown mention and structured `type: "skill"` input both attached the
project body. The path must match the registry: on this machine `/tmp` resolved to `/private/tmp`;
passing the unresolved alias did not attach the skill. A unique-name control attached its body
with a bare `$` mention, so the duplicate-name result is distinct from explicit-only filtering.
Do not infer a universal project-wins rule from a registry's ordering.

The policy toggle produced the expected result in both directions while the same-name user copy
remained installed. A unique-name explicit-only copy was still omitted by Codex. Together these
controls identify the sidecar policy as the omission's cause, independently of duplicates or
catalog size. They do not claim identical host UI or invocation mechanisms.

Muse's interactive `/skill implement` was separately exercised with its built-in echo provider.
It displayed `Loaded skill implement · project` and injected a `skill-body` with the project path,
402 bytes, and the matching `SKILL.md` hash above. The same-name user copy remained present.
This confirms user invocation without running the engineering workflow or depending on model prose.

Invocation surfaces matter: a headless model call to Muse's `read_skill("implement")` returned
`disabled-skill`, even with an explicit request in ordinary prompt text. Passing `/skill implement`
as ordinary `muse exec` text did not attach a body at the request boundary either; use the interactive
command for this tested user-only path. A local mock-stream tool-execution attempt was inconclusive
because Muse retried the synthetic stream; it is not used as evidence. The read-tool error came
from one separate configured-provider diagnostic with shell and writes disabled. No workflow ran.

## Recheck on another host version

Use the actual target project root and record resolved paths, scopes, enabled/activation state,
and diagnostics. These commands inspect metadata without invoking the engineering workflow:

```sh
codex --version
muse --version
muse skills list --source project --workspace "$project" --trust-workspace --json
muse skills list --workspace "$project" --trust-workspace --json
muse skills inspect implement --workspace "$project" --trust-workspace --json
```

To test Muse's user invocation without executing the workflow, start its interactive echo host:

```sh
muse --provider echo --workspace "$project" --trust-workspace \
  --disable-shell --disable-write --no-session-log
```

Type `/skill implement` and submit it. Verify `Loaded skill implement · project`, the injected
`.agents/skills/implement/SKILL.md` path, and the body hash. Exit the diagnostic session afterward.

The Muse trust flag loads project instructions for this invocation; use it only for the intended
trusted project. The unfiltered list is needed for shadowing diagnostics.

For Codex, `codex app-server --stdio` accepts newline-delimited JSON-RPC. Initialize, send the
`initialized` notification, then request the registry for the absolute project root:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"skill-discovery-probe","version":"1"},"capabilities":null}}
{"method":"initialized"}
{"id":2,"method":"skills/list","params":{"cwds":["<absolute-project-root>"],"forceReload":true}}
```

Inspect every matching `implement` entry in `result.data[].skills` and any errors. `enabled: true`
is not evidence of implicit eligibility: this version's registry does not expose that policy.
Inspect the adjacent `agents/openai.yaml` too. Select the desired resolved path explicitly in the
host; for Codex headless text, substitute the real absolute path in this mention:

```text
[$implement](<exact-registry-path>)
```

The app-server equivalent is a `turn/start` input item:

```json
{"type":"skill","name":"implement","path":"<exact-registry-path>"}
```

The [official Codex skill documentation](https://learn.chatgpt.com/docs/build-skills)
documents `.agents/skills/`, separate same-name skills, and explicit invocation when implicit
invocation is disabled. Version-specific behavior above was checked at the runtime boundary;
it should be rechecked after host upgrades.

## Resolution scope

Correct the vendored installation guide to distinguish discovery, implicit eligibility, and
explicit path selection. Preserve the pinned upstream revision, license, manifest, `ask-matt`
routing, and deliberate invocation policy. No generated duplicate tree, host configuration edit,
policy relaxation, new runtime code, or release gate is warranted by these findings. Existing
skill/archive and documentation checks validate the documentation-only change; a test that merely
searches this prose would not reproduce host filtering.

The trial's disclosed coordinator intervention and later failures remain as recorded in #276.
This investigation neither reclassifies that trial as unassisted nor claims execution qualification.

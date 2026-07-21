# Agent host portability audit for local Breakdown skills

**Research date:** 2026-07-21

**Question:** What portable baseline can a local Breakdown skill pack rely on across current agent hosts for Agent Skills loading, project-local files, subprocess/CLI invocation, and local stdio MCP?

## Verdict

The practical portable target is a **skills-compatible local agent harness**, not a bare model API.

Breakdown can ship one host-neutral set of Agent Skills if it treats discovery paths, permissions, and MCP registration as host adapters:

1. Author ordinary skill directories with SKILL.md and optional scripts, references, and assets. Require only the standard name and description frontmatter. The standard also defines optional license, compatibility, and metadata fields; allowed-tools is experimental and support varies. ([Agent Skills specification](https://agentskills.io/specification))
2. Make the filesystem-first Breakdown CLI the normative execution surface. Every evaluated local host can read project files and invoke a subprocess, subject to its trust, sandbox, and approval policy.
3. Offer local stdio MCP as an optional adapter over the same core. All required hosts, plus OpenCode, document local MCP process support, but configuration and trust behavior differ.
4. Use .agents/skills as the preferred project install path for Codex, Gemini CLI, GitHub Copilot, Cursor, and OpenCode. Claude Code documents .claude/skills, so it needs a copy, symlink, or installer mapping, not a second implementation.
5. Do not claim support for “any LLM.” A bare model endpoint does not scan disk, disclose skills, read files, launch processes, or act as an MCP client. Those are harness responsibilities. ([Agent Skills client implementation guide](https://agentskills.io/client-implementation/adding-skills-support))

## Standard boundary

The Agent Skills standard defines the **contents of a skill directory**, not where hosts discover it or which tools a model receives. A conforming SKILL.md has YAML frontmatter followed by Markdown; name and description are required. Progressive disclosure loads metadata first, then instructions, then referenced resources. ([Specification](https://agentskills.io/specification), [overview](https://agentskills.io/home))

The client implementation guide calls .agents/skills a cross-client convention but says the specification does not mandate discovery paths. It also makes file reading, activation, trust checks, and permissions client responsibilities. ([Client implementation guide](https://agentskills.io/client-implementation/adding-skills-support))

The portable contract must therefore not depend on:

- a particular discovery directory;
- a particular shell tool name, such as Bash, shell, run_shell_command, Terminal, or bash;
- vendor frontmatter for invocation controls, subagents, models, hooks, or arguments;
- allowed-tools, which the standard marks experimental and OpenCode ignores as an unknown field; or
- one MCP configuration format.

The compatibility field should instead state the actual requirement: a local harness with project file access and either permission to invoke the Breakdown CLI or a configured Breakdown MCP server.

## Decision-usable host matrix

“Native” means the host discovers and activates Agent Skills itself. It does not mean host extensions are portable.

| Host and local surface | Agent Skills | Project files and CLI | Local stdio MCP | Breakdown qualification |
| --- | --- | --- | --- | --- |
| **OpenAI Codex** (CLI, IDE, desktop local project) | **Native open-standard support.** Codex discovers repository skills from .agents/skills between the working directory and repo root; skills may contain scripts and references. ([Codex skills](https://learn.chatgpt.com/docs/build-skills)) | Native repository reads, edits, and shell execution, bounded by trust, sandbox, and approvals. | Native mcp_servers configuration supports command, args, environment, and optional cwd. ([Codex MCP](https://learn.chatgpt.com/docs/extend/mcp), [configuration](https://learn.chatgpt.com/docs/config-file/config-reference)) | **Tier A.** Install to .agents/skills. Keep OpenAI-only agents/openai.yaml optional and outside the portable contract. |
| **Claude Code** local CLI | **Native open-standard support with extensions.** Project skills live under .claude/skills; supporting files and scripts work. Claude adds invocation, subagent, dynamic-context, hook, path, and shell fields. ([Claude skills](https://code.claude.com/docs/en/skills)) | Native Read and Bash or PowerShell tools, governed by permissions and optional OS sandboxing. ([Permissions](https://code.claude.com/docs/en/permissions), [tools](https://code.claude.com/docs/en/tools-reference)) | Native. claude mcp add --transport stdio launches a process; shared project config is .mcp.json. Claude also exposes CLAUDE_PROJECT_DIR. ([Claude MCP](https://code.claude.com/docs/en/mcp)) | **Tier A with install adapter.** Copy or link unchanged skills into .claude/skills; require no Claude-only fields. |
| **Gemini CLI** | **Native open-standard support.** Workspace skills load from .gemini/skills or the .agents/skills alias. Activation asks for consent and grants access to the skill directory. ([Gemini skills](https://geminicli.com/docs/cli/skills/)) | File tools are rooted at the workspace; run_shell_command executes in a selected workspace path. ([Files](https://geminicli.com/docs/tools/file-system/), [shell](https://geminicli.com/docs/tools/shell/)) | Native stdio support. Command-based servers connect only in trusted folders. ([Gemini MCP](https://geminicli.com/docs/tools/mcp-server/)) | **Tier A.** Install to .agents/skills; trust and activation consent remain host concerns. |
| **GitHub Copilot CLI** | **Native open-standard support.** Project skills load from .github/skills, .claude/skills, or .agents/skills. Copilot adds argument-hint, user-invocable, and disable-model-invocation fields. ([GitHub Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills), [CLI skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills)) | Native view, create, edit, search, patch, bash, and PowerShell tools with path and command permissions. ([CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference)) | Native local/stdio servers with command, args, environment, optional cwd, and tool allowlists. ([Copilot MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)) | **Tier A for Copilot CLI.** Install to .agents/skills. Cloud and code-review surfaces load repo skills but cannot access an arbitrary user-local Breakdown folder. |
| **Cursor** editor and CLI | **Native support** in editor and CLI, with project discovery from .agents/skills and .cursor/skills. Skills may contain scripts and instructions. ([Cursor skills](https://cursor.com/docs/skills), [2.4 announcement](https://cursor.com/changelog/2-4)) | Native codebase file tools and terminal execution. ([Tools](https://cursor.com/docs/agent/tools), [terminal](https://cursor.com/docs/agent/terminal)) | Native local stdio; project config is .cursor/mcp.json with command, args, and environment. ([Cursor MCP](https://cursor.com/docs/mcp)) | **Tier A.** Install to .agents/skills; keep auto-run policy out of the portable skill. |
| **OpenCode** | **Native on-demand support.** It discovers .agents/skills, .opencode/skills, and .claude/skills while walking to the Git worktree root. ([OpenCode skills](https://opencode.ai/docs/skills)) | Native read, edit, search, list, and bash tools with project/external-directory permissions. ([OpenCode tools](https://opencode.ai/docs/tools/)) | Native local MCP through type local and a command array; optional cwd resolves from the workspace. ([OpenCode MCP](https://opencode.ai/docs/mcp-servers/)) | **Tier A, additional host.** It materially validates the shared format and .agents/skills convention outside the required vendors. |
| **Bare model API** without an agent harness | **Unsupported by itself.** No discovery or activation exists. | No filesystem or process access unless an application supplies it. | No MCP client unless an application implements one. | **Not a supported host.** A custom harness can qualify after implementing the Agent Skills lifecycle and file/process or MCP tools. |

## Local versus cloud

The MVP is directory-native, so support must name a process that can access that directory. The Agent Skills implementation guide notes that cloud and sandboxed agents cannot see a user's local filesystem. Repository skills can travel with a clone, but local uncommitted artifacts require explicit provisioning or upload. ([Client implementation guide](https://agentskills.io/client-implementation/adding-skills-support))

Accordingly, “GitHub Copilot support” should mean Copilot CLI or a local IDE surface for this MVP. Equivalent cloud surfaces from Cursor, Claude, or Codex are not portable local-run targets unless both the project and CLI are provisioned into their sandbox. Compatibility follows the host's capabilities and policy, not the underlying model provider.

## Portable Skill Profile v1

### Authoring

- One directory per skill, with a strict-standard SKILL.md and directory name identical to name.
- Required frontmatter: name and description.
- Recommended frontmatter: license and compatibility.
- Optional metadata only for inert strings such as pack version; correctness must not depend on interpretation.
- No dependency on allowed-tools or vendor invocation, subagent, hook, model, path-filter, or permission fields.
- Relative resource links resolve from the skill directory and do not escape it.
- Instructions use capability language such as “run with the host shell tool,” not vendor tool names.

### Execution

- Skills may read breakdown.yaml and Markdown artifacts under the selected project root.
- Validation, scheduling, hashing, resume selection, and artifact publication remain deterministic CLI/core responsibilities.
- Skills call a stable non-interactive CLI and check exit status and machine-readable output.
- Bundled scripts, if any, are thin discovery or compatibility helpers, not a duplicate engine.
- A skill reports sandbox denial, missing CLI, missing network, or absent MCP rather than fabricating success.

### Installation

Keep one canonical source tree such as skills/<name>. Copy or link the unchanged directory to:

| Host | Preferred project target |
| --- | --- |
| Codex | .agents/skills |
| Claude Code | .claude/skills |
| Gemini CLI | .agents/skills |
| GitHub Copilot CLI | .agents/skills |
| Cursor | .agents/skills |
| OpenCode | .agents/skills |

Checking the source directly into .agents/skills is also viable. Do not maintain divergent host-specific SKILL.md bodies. Put optional integration metadata in separate host-owned files or generated wrappers.

## Optional local stdio MCP profile

MCP stdio has the client launch the server as a subprocess and exchange newline-delimited JSON-RPC over stdin/stdout. Stdout is reserved for protocol messages; logs go to stderr. ([MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports))

The server implementation can be shared, but registration is host-specific:

| Host | Configuration mechanism | Qualification |
| --- | --- | --- |
| Codex | mcp_servers in Codex config.toml | Project config requires a trusted project; cwd is optional. |
| Claude Code | Project .mcp.json, user/local state, or claude mcp add | Project servers require approval; CLAUDE_PROJECT_DIR is host-specific. |
| Gemini CLI | mcpServers settings or gemini mcp add | Local command servers require a trusted folder. |
| GitHub Copilot CLI | copilot mcp add or CLI MCP config | Use stdio terminology; tool allowlists are host policy. |
| Cursor | Project .cursor/mcp.json or global config | The transport is standard; config remains Cursor-specific. |
| OpenCode | mcp in opencode.json with type local | Command is an array; optional cwd is workspace-relative. |

Skills must not assume that an MCP server starts in the Breakdown project. Codex and OpenCode can set cwd, Claude injects a project variable, and MCP clients may optionally expose roots. Roots are negotiated, not universal. MCP defines them as file URI boundaries and requires clients and servers to validate paths. ([MCP roots](https://modelcontextprotocol.io/specification/2025-11-25/client/roots))

The Breakdown adapter should require an explicit project path on project operations, or resolve a verified client root when unambiguous. Server process cwd is not authority. Distribution should provide reviewed per-host snippets rather than a supposedly universal config.

## Security and conformance implications

1. **Treat skills as executable supply-chain inputs.** Skills can contain scripts. GitHub warns that pre-approved shell access can let malicious skills or prompt injection execute arbitrary commands; Claude and Gemini also gate project skills on trust or consent. ([Copilot skill security](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills), [Claude permissions](https://code.claude.com/docs/en/permissions), [Gemini skills](https://geminicli.com/docs/cli/skills/))
2. **Request no implicit privilege.** Omit allowed-tools. Let the user and host approve the exact CLI or MCP operation.
3. **Stay under an explicit project root.** The future core must reject traversal and symlink escapes. MCP operations validate against the explicit root and any negotiated roots.
4. **Keep untrusted artifacts as data.** Predecessor Markdown, retrieved text, and prompts must not become skill instructions.
5. **Keep credentials out of skills and shared MCP config.** Environment forwarding is host-adapter policy; host-driven reasoning means Breakdown needs no model key.
6. **State runtime requirements, not model brands.** The compatibility field should name CLI/runtime and network needs.

Claim support only after one fixture passes on each named host. The fixture should use a temporary project with one breakdown.yaml and verify skill discovery, project file reading, breakdown validate, an in-root artifact operation, denial of an out-of-root path, and optional MCP tool discovery.

The skill license field can name the selected pack license, but it is metadata, not a substitute for actual license text and package metadata. Choosing the license is a separate product decision.

## Decision-ready conclusions

- **Portable format:** strict Agent Skills common subset, one unchanged body per skill.
- **Canonical execution:** CLI-first; MCP is optional.
- **Preferred install:** .agents/skills where supported, with a .claude/skills adapter for Claude Code.
- **Host extensions:** optional and outside the portable SKILL.md contract.
- **Compatibility boundary:** local harness capabilities and policy, not the model.
- **Support scope:** six requested local hosts plus OpenCode are Tier A; cloud surfaces are qualified; bare APIs are unsupported without a harness.
- **Verification:** support claims require the same conformance fixture on each current host.

Suggested product language:

> Breakdown skills support Codex, Claude Code, Gemini CLI, GitHub Copilot CLI, Cursor, and OpenCode when run in a local project with filesystem access and permission to invoke the Breakdown CLI. The same disk contracts work through an optional locally configured stdio MCP server. Other Agent Skills clients may work with equivalent capabilities. Bare model APIs are not supported without an agent harness.

## Primary sources

- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills client implementation guide](https://agentskills.io/client-implementation/adding-skills-support)
- [Codex skills](https://learn.chatgpt.com/docs/build-skills)
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)
- [Gemini CLI skills](https://geminicli.com/docs/cli/skills/)
- [Gemini CLI MCP](https://geminicli.com/docs/tools/mcp-server/)
- [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- [GitHub Copilot CLI MCP](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)
- [Cursor Agent Skills](https://cursor.com/docs/skills)
- [Cursor MCP](https://cursor.com/docs/mcp)
- [OpenCode skills](https://opencode.ai/docs/skills)
- [OpenCode MCP](https://opencode.ai/docs/mcp-servers/)
- [MCP stdio transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP roots](https://modelcontextprotocol.io/specification/2025-11-25/client/roots)

All compatibility claims use current specifications or first-party product documentation. No product code was changed or executed.

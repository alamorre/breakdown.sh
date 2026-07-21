# Local MVP licensing and redistribution inventory

**Research date:** 2026-07-21

**Repository baseline:** [`a743b10`](https://github.com/alamorre/breakdown.sh/tree/a743b1035bfaaa9b7da948626c3daa8df90f3319)

**Question:** What repository-owned and third-party material would the local core, CLI, portable Agent Skills, optional stdio MCP adapter, examples, and documentation redistribute, and what must be settled before a public release?

> This is a planning inventory, not legal advice. It deliberately does not choose a license or conclude who owns a disputed work. The maintainer should obtain legal advice if the ownership or license facts are uncertain.

## Decision-useful result

The MVP has a low-complexity licensing path if it ships as original, thin packages:

- extract the repository's dependency-light graph and prompt semantics after the maintainer confirms the rights to license them;
- write original local CLI, filesystem, schema, migration, and skill content;
- keep the MCP adapter optional and unbundled;
- link to Agent Skills, MCP, GitMCP, and other projects rather than copying their documentation or examples; and
- leave the hosted UI, generated UI components, template images, and current marketing screenshots out of the local distribution.

Public release is nevertheless **not ready**. The baseline tree has no `LICENSE`, `LICENCE`, `COPYING`, or `NOTICE`; GitHub reports no detected license; the root and MCP package manifests have no `license` field and are both marked `private`. GitHub explains that a public repository without a license remains under default copyright and does not grant others general permission to reproduce, distribute, or create derivative works. ([repository tree](https://github.com/alamorre/breakdown.sh/tree/a743b1035bfaaa9b7da948626c3daa8df90f3319), [root package manifest](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/package.json), [MCP package manifest](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/packages/breakdown-mcp/package.json), [GitHub licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository))

This does not require licensing the hosted product and local MVP identically. It does require a deliberate grant covering every artifact actually released: source and compiled code, skill text and bundled scripts/references/assets, schema and format documentation, examples/templates copied into user projects, and any branded media. The license-selection ticket should decide whether those surfaces share one license or use clearly separated code, documentation, and asset terms.

## Repository-owned material likely to enter the MVP

The table distinguishes **reuse candidates** from material that should remain outside the MVP. Git history is evidence of provenance, not proof of ownership.

| Release surface | Likely repository material | Current provenance evidence | Planning disposition |
| --- | --- | --- | --- |
| Local core | Edge relation names and semantics; topological sorting; prospective cycle detection; dependency-aware scheduling; prompt/context contracts; selected validation/import concepts | [`edge.ts`](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/src/types/edge.ts), [`topological-sort.ts`](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/src/lib/graph/topological-sort.ts), [`detect-cycle.ts`](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/src/lib/graph/detect-cycle.ts), [`run-all.ts`](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/src/lib/graph/run-all.ts), [`prompt-contract.ts`](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/src/lib/ai/prompt-contract.ts) | Extract or adapt only the local, database-free parts. Record source-file lineage in the extraction commit. The core can remain free of UI and hosted-service dependencies. |
| NodeDefinition/StepArtifact migration | Hosted graph export/import field names, external-step packet ideas, and migration examples | [`workflows.ts`](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/src/lib/breakdown-service/workflows.ts), [`schemas.ts`](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/src/lib/breakdown-service/schemas.ts), [`external-runs.ts`](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/src/lib/breakdown-service/external-runs.ts) | Reuse concepts and selected code, but create new definition/artifact contracts rather than republishing the hosted database/service layer. License the migration code and generated example artifacts with the local release. |
| CLI | No current filesystem-first CLI exists; command names and sample workflows in the feasibility note are proposals | The baseline package manifest exposes no local CLI package or `bin` | Treat implementation as new repository-owned code. If `init` copies templates or helper files, those copied files need an explicit downstream-use grant and a license that travels with the project template. |
| Portable Agent Skills | The broad hosted [`skills/breakdown/SKILL.md`](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/skills/breakdown/SKILL.md) supplies Breakdown vocabulary and operating lessons | The current skill has no portable Agent Skills frontmatter and is hosted-service-specific | Rewrite into original, focused local skills. License every shipped `SKILL.md`, script, reference, example, and asset. Do not ship the contributor-only Supabase/node-development skills as user workflow skills. |
| Optional stdio MCP | Transport/bootstrap patterns in the current hosted proxy | [`packages/breakdown-mcp/src/index.ts`](https://github.com/alamorre/breakdown.sh/blob/a743b1035bfaaa9b7da948626c3daa8df90f3319/packages/breakdown-mcp/src/index.ts) | Reuse only the transport/schema patterns needed to wrap the local core. Do not carry bearer-token, hosted REST, or SaaS tool text into the local package by default. |
| Examples and documentation | Headless graph examples, Breakdown terminology, feasibility examples, schema prose, and future conformance fixtures | [`examples/headless/`](https://github.com/alamorre/breakdown.sh/tree/a743b1035bfaaa9b7da948626c3daa8df90f3319/examples/headless), [`docs/`](https://github.com/alamorre/breakdown.sh/tree/a743b1035bfaaa9b7da948626c3daa8df90f3319/docs) | License examples/templates and normative docs explicitly. Preserve source citations for facts and short quotations; do not paste third-party guides into the distribution. Mark synthetic/example data so it is not mistaken for licensed customer content. |
| Branding and images | Breakdown logo/icon and plugin screenshots might be reused in a README, release page, or skill marketplace | [`plugins/breakdown/assets/`](https://github.com/alamorre/breakdown.sh/tree/a743b1035bfaaa9b7da948626c3daa8df90f3319/plugins/breakdown/assets) | Not required for the CLI/skills/MCP MVP. Exclude until the maintainer confirms origin, rights, and permitted trademark use. If included, state whether the software license covers them or a separate asset policy applies. |

The baseline has 138 commits and one Git author identity, Adam La Morre. Nine commit messages contain `Co-Authored-By` trailers naming Claude; the initial edge types and cycle detector are among the files introduced in those commits. This is a useful provenance warning, not a conclusion that the trailer created or transferred copyright. The maintainer must identify the tool/account terms that applied, confirm permission to redistribute the resulting material, and confirm that no unrecorded copied code or text entered those commits. ([edge introduction](https://github.com/alamorre/breakdown.sh/commit/135f8e4045b7972976f0bc4af565dc0b2e66f461), [cycle-detector introduction](https://github.com/alamorre/breakdown.sh/commit/fb15f96dce3021f5f54fce46297682d07df19341))

### Material to exclude by default

The local MVP does not need the React canvas, shadcn-generated components, Lucide icons, ELK layout, Next/Vercel starter SVGs, favicon, SaaS pages, Supabase migrations, or hosted product screenshots. Excluding them avoids pulling UI dependencies, generated-template provenance, logos, and unrelated third-party notices into the local release. If later work copies any of them, run a separate source-and-license review; do not infer that the eventual Breakdown license relicenses third-party material.

## Third-party inventory and obligations

### Direct dependencies that are plausible for the scoped MVP

| Material | Baseline evidence | License evidence | Redistribution consequence to plan for |
| --- | --- | --- | --- |
| `@modelcontextprotocol/sdk@1.29.0` | Direct dependency of the current MCP package | The installed package declares MIT and ships the Anthropic, PBC MIT text; the maintained v1 branch carries the same [`LICENSE`](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/LICENSE) | If the optional adapter imports it as an ordinary npm dependency, keep it external in a thin tarball and verify the installed package contains its license. If it is bundled, vendored, or embedded in an executable, include its copyright and MIT permission text with the distribution. Re-audit the exact selected SDK version: the SDK's newer main branch is transitioning licensing, so `1.29.0` is not evidence for a future version. |
| `zod@4.3.6` | Direct dependency of the current MCP package and current hosted schemas | The exact tag ships the [MIT license and copyright notice](https://github.com/colinhacks/zod/blob/v4.3.6/LICENSE) | Same thin-versus-bundled rule: a bundle or copied source must retain the MIT text. The spec may instead select another validator, which requires a fresh audit. |
| YAML/frontmatter parser | No direct YAML parser is declared in the baseline manifests | Not selected | This is an unresolved dependency, not an implied permission. The implementation spec must name the parser/version only after checking its package metadata, license file, transitive graph, maintenance, and packing behavior. |
| Node.js runtime APIs (`fs`, `crypto`, process/stdio) | Proposed core can use built-ins | User-supplied Node is not inside a thin npm tarball | Declare the supported Node range. If distribution later embeds Node in a standalone executable, inventory Node's license and bundled third-party notices as a new distribution surface. |
| TypeScript and test/build tools | `typescript`, `vitest`, type packages, and related tools are development dependencies | The installed TypeScript package is Apache-2.0; Vitest and the Node type package declare permissive licenses | Merely naming dev dependencies does not copy them into the package tarball. If tools, generated helpers, or source are bundled/vendorized, preserve the applicable license and notices. Apache-2.0 redistribution requires the license, preservation of relevant notices, changed-file notices for modified Apache files, and any applicable upstream `NOTICE`; it does not grant trademark rights. ([Apache-2.0 text](https://spdx.org/licenses/Apache-2.0.html)) |

The current lock resolution for the MCP workspace, measured with `pnpm --filter @breakdown/mcp licenses list --prod --json`, contains 91 packages: 81 declared MIT, 7 ISC, 2 BSD-3-Clause, and 1 BSD-2-Clause. The non-MIT entries are:

- BSD-3-Clause: `fast-uri@3.1.2`, `qs@6.15.0`;
- BSD-2-Clause: `json-schema-typed@8.0.2`; and
- ISC: `inherits@2.0.4`, `isexe@2.0.0`, `once@1.4.0`, `setprototypeof@1.2.0`, `which@2.0.2`, `wrappy@1.0.2`, and `zod-to-json-schema@3.25.1`.

That is a snapshot, not the future MVP bill of materials. MIT requires its copyright and permission text in copies or substantial portions; BSD-2-Clause requires retention of its copyright, conditions, and disclaimer; BSD-3-Clause adds its non-endorsement condition; ISC requires its copyright, permission, and disclaimer text. ([MIT](https://spdx.org/licenses/MIT.html), [BSD-2-Clause](https://spdx.org/licenses/BSD-2-Clause.html), [BSD-3-Clause](https://spdx.org/licenses/BSD-3-Clause.html), [ISC](https://spdx.org/licenses/ISC.html))

For a normal **thin npm package**, `npm pack` excludes `node_modules`; dependencies are fetched as their own licensed packages. For a bundle, native executable, vendored tree, copied source, or release archive containing dependency code, Breakdown becomes the redistributor of those copies and must ship the applicable texts/notices. The release process therefore needs a license report from the final lockfile **and** inspection of the final tarball/binary contents; a manifest-only scan is insufficient.

### Specifications, skills, GitMCP, and borrowed text

- Agent Skills is an open format. Its repository says code is Apache-2.0 and documentation is CC-BY-4.0. Merely implementing the folder/frontmatter contract does not require copying the specification, but copied reference implementations, examples, or prose must retain the applicable license and, for CC-BY material, attribution and change information. Prefer original instructions plus links to the [specification repository and its stated licenses](https://github.com/agentskills/agentskills).
- Matt Pocock's skills repository is MIT. The feasibility note uses its install/distribution shape as precedent; no content needs to be copied. If a template, script, or substantial prose is copied later, retain the repository's [MIT notice](https://github.com/mattpocock/skills/blob/main/LICENSE).
- GitMCP is documentation/discovery only in this MVP. Linking to or using the public service does not put its server code in Breakdown's release. Do not copy its implementation. If that scope changes, its repository is [Apache-2.0](https://github.com/idosal/git-mcp/blob/main/LICENSE) and needs a separate dependency/service review.
- Names such as Codex, Claude, GitHub, npm, MCP, and Agent Skills may be trademarks even when related code or prose is openly licensed. Use them only to describe compatibility, do not imply sponsorship, and review the applicable current brand rules before marketing or marketplace publication. Software licenses do not automatically grant trademark rights.

## Package and release inventory

### Current package state

The root package is a private hosted application, not a local release package. The only existing package candidate is `@breakdown/mcp@0.1.0`, also private. npm documents that `"private": true` causes npm to refuse publication, and recommends a valid SPDX `license` expression or `SEE LICENSE IN <filename>` for non-SPDX/custom terms. npm always includes a package's top-level `LICENSE` and declared `bin` files when they exist. ([npm package manifest documentation](https://docs.npmjs.com/files/package.json/))

An `npm pack --dry-run --json` at the baseline produced only:

```text
package.json
src/index.ts
tsconfig.json
```

The manifest's `bin` points to `dist/index.js`, but that file was absent from the dry-run tarball; no README or license was included. Thus the existing package is not a publishable local-MCP artifact even apart from its hosted behavior and `private` flag.

Registry reads for `@breakdown/core`, `@breakdown/cli`, and `@breakdown/mcp` returned no public package on 2026-07-21. An npm `E404` does **not** prove the names are available or that this maintainer controls the `@breakdown` scope; access can also hide packages. npm documents that scoped public packages belong to a user or organization and that write access depends on scope/package permissions. The maintainer must confirm scope ownership and publisher access before these names enter the specification. ([npm scope/access matrix](https://docs.npmjs.com/package-scope-access-level-and-visibility/))

### Required release contract before publication

For each independently installed artifact—likely core/CLI package, optional MCP package, and skill pack or release archive—the specification should require:

1. a confirmed publisher/copyright-holder identity and a chosen license covering that artifact's code, text, examples/templates, and any assets;
2. a top-level license file that actually lands in every npm tarball, skill archive, GitHub release archive, and standalone binary distribution, plus `THIRD_PARTY_NOTICES` when the final contents require it;
3. manifest metadata: unique `name` and `version`, valid `license`, `description`, `repository`, `homepage`, `bugs`, supported `engines`, explicit `files`, entrypoints/`exports`, and an existing executable `bin` for the CLI/MCP;
4. removal of `private` only on packages intended for publication and an explicit registry/access setting for public scoped packages;
5. final `npm pack --dry-run`/tarball inspection, install-and-run smoke test from that tarball, secret/personal-data scan, exact dependency-license report, and verification that the bin uses the intended runtime and contains no accidental source, credentials, caches, or hosted-only material;
6. a versioned tag/release tied to the packaged commit, recorded checksums/provenance as the release process chooses, and a retained bill of materials for that exact artifact; and
7. compatibility claims backed by conformance tests, with third-party product names used descriptively rather than as a license or endorsement claim.

npm's documentation recommends dry-run inspection of what will be shared, and its public registry terms require the publisher to grant npm permission to share the package. ([npm privacy/publishing guidance](https://docs.npmjs.com/policies/privacy/), [npm publish documentation](https://docs.npmjs.com/cli/publish/))

## Facts only the maintainer can resolve

These are release gates, not questions this repository inspection can answer:

1. **Rights holder:** Is Adam La Morre acting personally, for a company, or under employment/client/contract obligations? Who must be named as copyright holder and who can grant the public license?
2. **Complete provenance:** Is all candidate code, skill text, documentation, schema prose, and example content original to the rights holder except for the dependencies identified here? Were any snippets copied from tutorials, Stack Overflow, generated templates, private repositories, employers, clients, or model outputs without recorded terms?
3. **AI-assisted commits:** Which product/account terms governed the nine Claude-attributed commits, and do those terms and any supplied prompts/context permit public redistribution? Did a human review and materially direct the relevant output?
4. **Brand and assets:** Who created the Breakdown name, logo, icon, favicon, and screenshots? Are font, template, stock, generated-image, screenshot, and marketplace rights documented? Is the `Breakdown` name clear for the intended software/package categories and npm scope?
5. **Example/data permission:** Do examples, fixtures, screenshots, and future migration fixtures contain customer/user data, copyrighted prompts, model outputs, private source text, or third-party API data with redistribution limits? Synthetic fixtures should be documented as such.
6. **License policy:** Which license or license combination will cover code, skill/docs text, schemas/examples, and branded assets? Will hosted code remain under the same grant, be carved out, or be separately licensed? This inventory does not recommend an answer.
7. **Contribution policy:** Before accepting outside contributions, will the project use inbound-equals-outbound, a DCO, a CLA, or another documented contribution grant? Existing Git author data does not settle future contributor rights.
8. **Registry authority:** Does the release identity control the `@breakdown` npm user/organization and have permission to publish public packages, or must package names change?

## Inputs to the implementation-ready specification

The specification can proceed once the following decisions are explicit:

- the release boundary is **original local core + CLI + portable skills + optional stdio MCP + examples/docs**, with hosted UI/SaaS and unrelated assets excluded;
- the maintainer answers the ownership/provenance questions above and chooses the license policy in a human decision ticket;
- the spec names each distributable and defines where its own license and third-party notices live, including copied project templates;
- the dependency policy requires exact-version license review and final-artifact inspection, with a separate review triggered by bundling, vendoring, native executables, embedded Node, copied upstream prose/examples, or newly included assets;
- Agent Skills, MCP, and GitMCP remain interoperability/documentation references, not sources of copied content; and
- registry scope/name ownership is confirmed before package identifiers become normative.

## Method

Research used the exact baseline tree, package manifests, candidate source/skill/example/assets, Git author and commit-trailer history, installed package metadata/license files, `pnpm licenses list`, `npm pack --dry-run`, public npm registry reads, and the primary project/license/registry documents linked above. No product code was changed and no license was selected.

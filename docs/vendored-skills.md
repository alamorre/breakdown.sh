# Vendored Engineering Skills

Breakdown ships these nine engineering skills from
[`mattpocock/skills`](https://github.com/mattpocock/skills) so a clean checkout does not depend on
skills installed in a developer's home directory:

| Skill             | Invoke             | Use                                                                 |
| ----------------- | ------------------ | ------------------------------------------------------------------- |
| `ask-matt`        | `$ask-matt`        | Choose among the skills Breakdown actually bundles.                 |
| `tdd`             | `$tdd`             | Build a feature or fix in red-green slices.                         |
| `code-review`     | `$code-review`     | Review a diff against repository standards and its issue or spec.   |
| `diagnosing-bugs` | `$diagnosing-bugs` | Establish a tight reproduction loop before diagnosing a hard bug.   |
| `prototype`       | `$prototype`       | Build a throwaway logic or UI artifact to answer a design question. |
| `wayfinder`       | `$wayfinder`       | Map and resolve decisions for work too large for one session.       |
| `grill-with-docs` | `$grill-with-docs` | Sharpen a plan while maintaining its glossary and ADRs.             |
| `domain-modeling` | `$domain-modeling` | Refine domain language, `CONTEXT.md`, and architectural decisions.  |
| `implement`       | `$implement`       | Build a piece of work from a spec or set of tickets.                |

`ask-matt` is adapted to route only among this list. It marks other upstream flows unavailable
instead of implying that Breakdown installed them.

## Install from a clean clone

### Project-local skills without the plugin

From a clean Breakdown checkout and the target project root, use the pinned installer and the
checked-in source directory:

```bash
npx --yes skills@1.5.20 add /absolute/path/to/breakdown.sh/local/vendor/skills \
  --skill ask-matt \
  --skill tdd \
  --skill code-review \
  --skill diagnosing-bugs \
  --skill prototype \
  --skill wayfinder \
  --skill grill-with-docs \
  --skill domain-modeling \
  --skill implement \
  --agent codex \
  --copy \
  --yes
```

Replace `--agent codex` with another installer-supported host when needed. Keep `--copy` so the
target project remains independent from the Breakdown checkout.

The same directories are included in `breakdown-skills-<version>.tar.gz` and `.zip`. Verify the
archive against the release's signed `SHA256SUMS`, extract it, and copy the named skill directories
into the target host's project skill directory. The archive includes `VENDORED_SKILLS.json` and
`LICENSE_MATTPOCOCK_SKILLS.txt` beside the skills.

## Provenance and updates

The canonical vendored bytes live in `local/vendor/skills/`. `VENDORED_SKILLS.json` records,
for every file:

- upstream repository and source path;
- pinned Git revision;
- upstream and local SHA-256 digests;
- whether the file is verbatim or adapted; and
- a summary of each Breakdown adaptation.

The current source revision is `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`. All nine skills are
licensed under the MIT License, whose complete upstream text is retained in
`LICENSE_MATTPOCOCK_SKILLS.txt`.

To audit or update the import, clone the upstream repository outside the Breakdown checkout, check
out the recorded revision, compare each recorded `upstream_path`, and regenerate the manifest:

```bash
node scripts/generate-vendored-skills-manifest.mjs --upstream /absolute/path/to/mattpocock-skills
node scripts/generate-vendored-skills-manifest.mjs --upstream /absolute/path/to/mattpocock-skills --check
```

When moving to a newer upstream revision, update the pinned revision in the generator, preserve or
reapply the recorded Breakdown adaptations, retain the upstream license, regenerate the manifest,
and run the skill conformance tests (`pnpm test`).

# Plugin Release Loop

The Breakdown Codex plugin release loop treats every bumped plugin version on a PR as a release
candidate. The candidate is tested before merge, then promoted only after the release-test report
recommends promotion or a maintainer intentionally accepts known issues.

This workflow is designed to work from GitHub mobile comments:

```text
/bump patch
/bump minor
/bump major
/release-test
/release-test ref=<branch-or-sha>
/promote
/promote accept-known-issues
/file-regressions
```

## Roles

| Area | Owner |
| --- | --- |
| Candidate version bump | `pnpm plugin:version -- patch|minor|major` |
| Command parsing and promotion gate | `pnpm plugin:release:command` |
| Mobile bump/promote/regression commands | `.github/workflows/plugin-release-command.yml` |
| Candidate smoke test | `scripts/plugin-release-smoke.mjs` |
| Baseline comparison | release-test JSON comparison output |
| GitHub Actions trigger/commenting | release-test workflow |

The command helper deliberately stays small so GitHub Actions, local agents, and future mobile
automation can share the same parsing and promotion rules.

## Candidate Versus Release

A PR branch version bump is a candidate, not a release. The candidate version lives in
`plugins/breakdown/.codex-plugin/plugin.json`, and PR CI blocks plugin package changes unless that
version is higher than the base branch version.

Use one of these commands on the PR branch:

```bash
pnpm plugin:version -- patch
pnpm plugin:version -- minor
pnpm plugin:version -- major
```

Promotion happens after a successful release test. Merging or tagging before that point skips the
feedback loop and should be treated as an exception.

## Phone Commands

`/bump patch`, `/bump minor`, and `/bump major` ask automation to bump the plugin manifest version
on the PR branch and push the resulting commit.

`/release-test` asks the release-test workflow to install and test the PR candidate ref rather than
`main`. Use `/release-test ref=<branch-or-sha>` when the tested ref needs to be explicit.

`/promote` reads the latest candidate release-test JSON, verifies that it includes a candidate
version, tested ref, and promotion recommendation, then writes the promoted baseline metadata.

`/promote accept-known-issues` is required when the report recommendation is
`promote-with-known-issues`. The explicit phrase records that a maintainer accepted the listed
regressions or limitations.

`/file-regressions` converts each regression from the latest report into a GitHub issue payload so
automation can create focused follow-up issues.

Parse a comment locally with:

```bash
pnpm plugin:release:command -- parse --comment "/release-test ref=feature/plugin-fix"
```

## Release-Test Token

Release tests must use `BREAKDOWN_RELEASE_TEST_TOKEN`, not one-time setup approval URLs. Create or
rotate the token from Settings under MCP Access -> Release Testing, then store the copied raw value
as a GitHub Actions secret or agent runtime secret.

Minimum scopes:

- `graphs:read`
- `graphs:write`
- `runs:external_execute`
- `runs:write_results`

Add `runs:cancel` only if the smoke runner needs cleanup cancellation. Reports, logs, comments, and
baseline files must never include raw token values.

## Report Review

The release-test report should produce Markdown for people and JSON for automation. The JSON should
include these stable fields, or equivalent nested fields that the command helper can normalize:

```json
{
  "candidateVersion": "1.0.1",
  "testedRef": "refs/pull/123/head",
  "testedSha": "abc123",
  "baselineVersion": "1.0.0",
  "baselineRef": "breakdown-plugin-v1.0.0",
  "recommendation": "promote",
  "regressions": [],
  "newFeedback": []
}
```

Allowed recommendations:

- `promote`: promotion may proceed.
- `promote-with-known-issues`: promotion may proceed only with `/promote accept-known-issues`.
- `block`: promotion must stop until a new report clears the candidate.

## Promotion Gate

The promotion helper refuses to promote when:

- the report has no recommendation
- the report has no candidate version
- the report has no tested ref
- the recommendation is `block`
- the recommendation is `promote-with-known-issues` without explicit acceptance

When promotion is allowed, write the promoted baseline:

```bash
pnpm plugin:release:command -- promote \
  --report docs/plugin-release-tests/latest-candidate.json \
  --baseline docs/plugin-release-tests/latest.json
```

The baseline records the exact candidate version, tested ref, tested SHA when available, prior
baseline metadata, recommendation, accepted-known-issues flag, regressions, and new feedback. If a
tag is created, use the exact promoted version:

```bash
git tag breakdown-plugin-v1.0.1 <tested-sha>
git push origin breakdown-plugin-v1.0.1
```

## Regression Triage

Regressions are not the same as new feedback. A regression is worse behavior versus the last
promoted baseline; new feedback is a newly observed improvement opportunity that does not block the
candidate unless the report recommends `block`.

Create regression issue payloads from a report with:

```bash
pnpm plugin:release:command -- regressions \
  --report docs/plugin-release-tests/latest-candidate.json \
  --out /tmp/plugin-release-regressions.json
```

Automation can turn each payload into a GitHub issue labeled `regression` and
`plugin-release-loop`. Keep issues specific enough that a later PR can fix or intentionally close
one regression at a time.

---
name: ask-matt
description: Ask which of the engineering skills bundled with Breakdown fits the current situation.
---

# Ask Matt

Route the request to the smallest useful flow among the eight skills bundled with Breakdown. Do
not claim that any other skill from the upstream `mattpocock/skills` repository is installed.

## Routes

- A plan or design needs a rigorous interview and a durable glossary or ADR trail: start with
  `/grill-with-docs`, which uses `/domain-modeling` as it records decisions.
- The effort is too large or uncertain for one session: use `/wayfinder` to create and resolve a
  map of decision tickets. Use `/prototype` for questions that need runnable evidence.
- A state, logic, or UI design question needs something concrete to react to: use `/prototype`.
- A bug or performance regression needs a reproducible diagnosis: use `/diagnosing-bugs`.
- A feature or fix should be built test-first: use `/tdd`, one red-green slice at a time.
- Existing work needs review against both repository standards and its issue/spec: use
  `/code-review` with an explicit fixed point.
- The team needs sharper domain terms, a glossary, or an architectural decision record: use
  `/domain-modeling`.

These routes compose. A common Breakdown flow is `/grill-with-docs` → `/tdd` → `/code-review`.
For a large effort, `/wayfinder` comes first and hands each buildable result to the host's normal
implementation workflow.

## Phase boundaries

Continue in the current session while its primary context is still useful. At a true phase
boundary, use a host-native clear, compact, handoff, or delegation feature only when that feature
is available. See [PHASE-BOUNDARIES.md](PHASE-BOUNDARIES.md) for the upstream decision framework
and the Breakdown availability note.

## Not bundled

The Breakdown edition does not bundle these upstream skills or flows: `implement`, `grilling`,
`research`, `setup-matt-pocock-skills`, `codebase-design`, `grill-me`, `handoff`, `to-spec`,
`to-tickets`, `triage`, `improve-codebase-architecture`, `resolving-merge-conflicts`, `wizard`,
`to-questionnaire`, `wait-what`, `teach`, and `writing-for-agents`.

Do not route to an item in this list or imply that it is available. Use the host's native
capability when it has an equivalent, install the missing upstream skill separately, or keep the
work within the bundled route that most closely matches the request.

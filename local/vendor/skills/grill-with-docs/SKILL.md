---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.
---

Conduct a relentless, breadth-first interview that sharpens the user's plan or design. Invoke the
bundled `domain-modeling` skill while interviewing so resolved terminology is recorded in
`CONTEXT.md` and hard-to-reverse trade-offs can become ADRs.

The upstream `grilling` primitive is not bundled with Breakdown. Apply its essential behavior
directly: keep an explicit frontier of unresolved decisions, ask only questions the user must
decide, investigate factual questions yourself, and continue until every in-scope branch is
resolved or deliberately deferred.

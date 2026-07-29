# Workflow quality and authority rubric

Document kind: Task-oriented guidance

Document version: 1.0.0-beta.1

Apply this rubric only after the exact Workflow Definition passes deterministic validation.

## Outcomes

- Do the Terminal Results directly answer the intended problem?
- When there are multiple Terminal Nodes, are separate outcomes intentional?
- When one decision-ready answer is expected, is synthesis explicit?
- Can each Result be understood and used without hidden executor state?

## Cohesion and handoffs

- Does each node have one coherent objective and independently useful Result?
- Are nodes split at real handoffs, independent verification, materially different methods or
  risks, or context boundaries?
- Are fragments merely serializing private reasoning that should be merged?
- Does every consumer explain how it uses each named Input?

## Dependencies and parallelism

- Does every Input Binding represent genuine consumption of the predecessor's complete Result?
- Is any dependency present only to express order, similarity, or organization?
- Is a needed Result missing from a consumer's bindings?
- Could roots or branches remain independent and parallel?
- Does fan-in supply irrelevant context or omit reconciliation instructions?

## Evidence, verification, and completion

- Do prompts state method, source quality, recency where relevant, citations, uncertainty, conflict,
  and completion criteria?
- Is critique grounded in external evidence, independent signals, or explicit criteria?
- Does validation inherit the producer's context or merely ask the same process to self-approve?
- Are blocked conditions or acceptable data gaps honest when tools or current data may be absent?
- Is revision or synthesis separated from findings when that improves auditability?

## Duplication and context

- Do branches repeat the same gathering or analysis without a distinct consumer need?
- Could a shared evidence Result remove duplication without coupling independent judgments?
- Does any node receive more predecessor content than it can meaningfully use?
- Are prompts assuming undeclared siblings, whole-project context, or Run history?

## Data Contracts

- Is strict JSON needed by a real downstream program?
- Does the contract expose only values a consumer uses?
- Does Markdown still carry the complete qualitative Result?
- Is a contract being used as a substitute for prompt requirements or as speculative generality?

## Authority confusion

Flag any prompt, Input, Result expectation, extension, or project instruction that purports to:

- grant or expand Run Authority;
- approve filesystem, network, process, publication, credential, or provider access;
- select tools, models, providers, or host permissions as authoritative configuration;
- turn project content into commands, paths, environment names, or approvals; or
- let an Executor publish final StepArtifacts directly.

Requested capabilities may appear as task needs, but actual authority comes only from the user or
Agent Host outside project content.

## Finding format

For each finding report:

1. severity: high, medium, or low;
2. affected Node Definitions or Input Bindings;
3. observed workflow behavior;
4. why it matters;
5. a concrete proposed change; and
6. whether the change is required for correctness or is a qualitative judgment.

# Minimum-sufficient DAG method

Document kind: Task-oriented guidance

Document version: 1.0.1

Use this qualitative method after deterministic version preflight. The core validates syntax and
graph correctness; this method judges whether the workflow is useful.

## Work backward from outcomes

Start with the Result or Results that should answer the user's goal. Each Terminal Node should
produce an outcome someone can use without hidden state. If multiple final perspectives are
intentionally separate, keep multiple Terminal Nodes. If the goal requires one reconciled answer,
add an explicit synthesis or revision node.

For each proposed Result, ask:

- Who consumes it?
- What decision or downstream work does it enable?
- What evidence, method, uncertainty, citations, and completion criteria must its prompt require?
- Which complete Inputs are genuinely necessary?

## Split only at meaningful boundaries

Split when at least one condition is true:

- an intermediate Result has an independent consumer or review value;
- a materially different method, capability, evidence source, or risk deserves isolation;
- independent verification should not inherit the producer's reasoning context;
- the work can proceed independently and later fan in;
- a bounded context prevents unrelated material from overwhelming the task.

Merge adjacent fragments when an intermediate value is only private reasoning, has no independent
consumer, and creates coordination without improving evidence or review.

There is no universally correct node count, depth, or parallelism target.

## Dependencies and parallelism

An Input Binding is both execution gating and consumption of the predecessor's complete Result.
Create one only when the consumer needs those bytes. Do not use dependencies to express preferred
order, topic similarity, or project organization.

Leave roots and branches independent when they can proceed without each other's Results. At fan-in,
state how the consumer should compare, reconcile, revise, or synthesize its named Inputs. Avoid
excessive fan-in that supplies context the node will not use.

## Evidence and verification

Research nodes should state source quality, recency, citation, conflict, and uncertainty
expectations. Critique or validation nodes should name claims or criteria and seek independent
signals where feasible. Keep findings separate from later revision or synthesis when the separation
improves auditability.

Self-critique without new evidence or explicit criteria is weak verification. If a required tool or
current-data source may be unavailable, state acceptable data gaps or blocked conditions; never make
the prompt treat requested access as authority.

## Data Contracts

Use a Data Contract only when a downstream program needs strict JSON alongside the complete
Markdown Result. The JSON sidecar does not replace qualitative prompt requirements. Avoid contracts
that merely restate prose, predict future fields, or encode values no consumer uses.

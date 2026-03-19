---
name: evaluate-graph
description: Evaluate a node in the reasoning graph using Claude AI
user_invocable: true
invocation: /evaluate-graph
---

# Evaluate Graph Node

Evaluate a selected node by gathering upstream context, building a prompt, calling Claude, and applying the proposed changes.

## Steps

1. **Identify the target node**
   - Ask the user which node to evaluate (by name or ID)
   - Read the node from Supabase via `actions/evaluate-node.ts`
   - Display the node's current state: name, type, conclusion, confidence

2. **Gather upstream context**
   - Query all inbound edges to the target node
   - For each upstream node, collect: name, type, conclusion, confidence, edge type, edge weight
   - Display the upstream context summary to the user

3. **Build the evaluation prompt**
   - Use `lib/ai/build-prompt.ts` to construct the prompt
   - Include: node name, type, current conclusion, all upstream conclusions with edge types, evidence, assumptions
   - Never inline prompt strings — always use the prompt builder

4. **Call Claude API**
   - Use the server action `evaluateNode(nodeId)` from `actions/evaluate-node.ts`
   - This calls Claude via `lib/ai/claude.ts` (server-side only)
   - Wait for the structured response: `{ conclusion, confidence, evidence[], diff_summary }`

5. **Show proposed changes**
   - Display side-by-side: previous conclusion vs. proposed conclusion
   - Show confidence change (delta)
   - Show diff summary from Claude
   - Show any new evidence items

6. **User approval**
   - Ask the user to **Accept** or **Reject** the evaluation
   - If accepted: update the node in Supabase with new conclusion, confidence, evidence, and `last_evaluated_at`
   - If rejected: discard the proposed changes

7. **Log the evaluation**
   - Write to the `evaluations` table: trigger_type='manual', previous/new conclusion, confidence delta, status='approved'|'rejected'
   - Include token usage (prompt_tokens, completion_tokens) for cost tracking

## Rules

- All Claude API calls happen in server actions — never client-side
- All prompts built through `lib/ai/build-prompt.ts` — no inline prompt strings
- Parse and validate Claude's response before displaying
- Handle API errors gracefully (rate limit, timeout, malformed response)
- Show loading state while Claude is processing

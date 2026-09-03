# Breakdown — Product Specification

> **Current direction:** See [`docs/roadmap.md`](docs/roadmap.md) (single source of truth) and [`docs/adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md`](docs/adr/0004-declare-breakdown-local-canonical-and-retire-doppler-hosted-legacy.md). This `specs.md` is the historical hosted SaaS spec; **Breakdown Local** (`#142`, Wayfinder #124) is the canonical 1.0+ product and hosted SaaS is legacy/out-of-scope for the local corpus.

> Reasoning that propagates.

A node-based reasoning canvas where hypotheses, assumptions, and conclusions are structured as a directed acyclic graph (DAG). When the world changes — new data, events, or insights — agents propagate updates through the graph, re-evaluating downstream conclusions and surfacing what's changed.

---

## 1. Problem Statement

Complex personal and professional decisions (investments, career moves, land purchases, portfolio strategy) require maintaining a web of interconnected reasoning across multiple subtopics. Today, this reasoning is:

- **Scattered** across chat conversations, documents, and mental models
- **Static** — conclusions don't update when upstream data changes
- **Unstructured** — relationships between sub-conclusions are implicit, not explicit
- **Ephemeral** — insights from research sessions are lost or buried in conversation history

No existing tool combines structured reasoning primitives, visual flow-based composition, and AI-powered propagation into a single product.

---

## 2. Product Overview

### Core Concept

Breakdown applies the **ElevenLabs Flows model** — a node-based visual canvas where outputs flow between connected nodes — to **reasoning and decision-making** instead of creative media pipelines.

| ElevenLabs Flows                            | Breakdown                                                   |
| ------------------------------------------- | ----------------------------------------------------------- |
| Node = generative model (image, video, TTS) | Node = reasoning unit (claim, assumption, data source)      |
| Edge = media asset (image → video input)    | Edge = typed conclusion (supports, contradicts, depends on) |
| Re-run one node, downstream updates         | Re-evaluate one node, downstream conclusions propagate      |
| Swap inputs for variations                  | New data triggers re-evaluation                             |
| Non-destructive iteration                   | Version-controlled reasoning history                        |

### Key Differentiators

1. **Typed reasoning primitives** — nodes aren't freeform cards; they're structured units with conclusions, confidence scores, evidence, and assumptions
2. **Computational propagation** — edges are typed data channels that agents read/write, not decorative lines
3. **Temporal awareness** — the system tracks when assumptions were last validated, detects staleness, and proactively flags nodes for re-evaluation
4. **Agent-native architecture** — agents operate via skill docs scoped to individual node types, making the system extensible and provider-agnostic

---

## 3. Node Types

### 3.1 Source Nodes (Inputs)

| Node Type           | Description                                     | Example                                                  |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------- |
| **Data Source**     | External data feed — prices, metrics, APIs      | Arrow Lakes MLS listing prices                           |
| **Event Trigger**   | World state change — news, announcements        | "CoreWeave reports Q4 earnings miss"                     |
| **Assumption**      | User-stated belief, manually entered            | "SE roles in regulated enterprise have 7-15 year runway" |
| **Chat Import**     | Reasoning extracted from prior AI conversations | Claude conversation re: BC zoning analysis               |
| **Document Source** | Uploaded files — PDFs, reports, research        | Strata Plan EPS517 bylaws document                       |

### 3.2 Analysis Nodes (Processing)

| Node Type           | Description                                     | Example                                                         |
| ------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| **Claim**           | Scoped conclusion with evidence and confidence  | "AI will compress mid-tier SE roles within 5-8 years"           |
| **Comparison**      | Evaluate alternatives against criteria          | "Galena Bay lot vs. boat-access parcels"                        |
| **Risk Assessment** | Quantified exposure with probability and impact | "D1 zoning reclassification risk: low probability, high impact" |
| **Timeline**        | Sequenced events with dependencies              | "HELOC → inheritance deployment → land acquisition"             |

### 3.3 Composition Nodes (Outputs)

| Node Type                | Description                                | Example                                                                             |
| ------------------------ | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Composite Conclusion** | Aggregated conclusion from multiple claims | "BC rural land is a viable hard-asset hedge given 3-5 year peak income window"      |
| **Decision Point**       | Actionable choice with trigger conditions  | "Make offer on Lot 55 when: price ≤ $X AND HELOC approved AND strata fee confirmed" |
| **Watchlist**            | Monitoring set with alert thresholds       | "Track CRWV debt/equity ratio, ASML order backlog, Arrow Lakes listing inventory"   |

---

## 4. Edge Types

Edges are **typed, directional, and carry semantic information** about how one node's conclusion affects another.

| Edge Type          | Semantics                                        | Propagation Behavior                           |
| ------------------ | ------------------------------------------------ | ---------------------------------------------- |
| `supports`         | Upstream conclusion strengthens downstream       | Positive confidence contribution               |
| `contradicts`      | Upstream conclusion weakens downstream           | Negative confidence contribution               |
| `depends_on`       | Downstream requires upstream to be valid         | Hard dependency — invalidate if upstream fails |
| `assumes`          | Downstream is predicated on upstream assumption  | Flag if assumption changes                     |
| `inputs_to`        | Upstream provides data that downstream processes | Re-evaluate with new data                      |
| `sequences_before` | Temporal ordering — must happen first            | Timeline dependency                            |

### Edge Properties

```typescript
interface Edge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  edge_type: EdgeType;
  weight: number; // 0-1, how much influence
  condition?: string; // "if displacement_timeline < 5_years"
  transform?: string; // how to interpret upstream output for downstream
  created_at: Date;
  updated_at: Date;
}
```

---

## 5. Propagation Engine

### Staleness Detection

Each node tracks:

- `last_evaluated_at` — when the node's conclusion was last computed
- `upstream_changed_at` — most recent change among all upstream nodes
- `staleness_score` — computed from time delta and edge weights
- `confidence` — 0-1 score that decays over time based on node type

A node is **stale** when `upstream_changed_at > last_evaluated_at` OR when `confidence` drops below a configurable threshold.

### Re-evaluation Flow

1. Source node updates (new data, event, user edit)
2. Walk graph downstream via edges
3. For each downstream node:
   1. Check if edge condition is met
   2. Load node's skill doc
   3. Gather upstream conclusions via inbound edges
   4. Call re-evaluation agent with: skill doc + upstream data + current conclusion
   5. Agent returns: new conclusion, confidence, diff from previous
   6. If conclusion changed materially, continue propagation downstream
   7. If conclusion unchanged, stop propagation on this branch
4. Collect all changes into a digest
5. Notify user (or auto-apply based on node's autonomy setting)

### Autonomy Levels (per node)

| Level        | Behavior                                                     |
| ------------ | ------------------------------------------------------------ |
| `manual`     | Never auto-update; user must trigger evaluation              |
| `propose`    | Agent proposes revision; user approves before propagation    |
| `auto_minor` | Auto-apply if confidence delta < threshold; propose if major |
| `auto`       | Fully autonomous — update and propagate without approval     |

---

## 6. Skill Docs

Skill docs define how agents interact with each node type. They are the "source code" of the reasoning system — composable, shareable, and provider-agnostic.

### Structure

```yaml
name: real-estate-market-analysis
version: 1.0.1
node_type: claim
description: Evaluate real estate market conditions for a specific region

inputs:
  - name: listing_data
    type: data_source
    description: Current MLS listings and price history
  - name: macro_conditions
    type: claim
    description: Broader economic conditions affecting real estate

output:
  conclusion: string # Natural language conclusion
  confidence: number # 0-1
  key_metrics:
    median_price: number
    inventory_months: number
    yoy_change: number
  evidence: string[] # Supporting data points

evaluation_prompt: |
  You are analyzing real estate market conditions for {{region}}.

  Current data:
  {{listing_data.conclusion}}

  Macro conditions:
  {{macro_conditions.conclusion}}

  Previous conclusion (evaluated {{previous.last_evaluated_at}}):
  {{previous.conclusion}}

  Provide an updated market assessment. If your conclusion differs
  materially from the previous one, explain what changed and why.

staleness_rules:
  max_age_days: 30
  triggers:
    - listing_data.updated
    - macro_conditions.confidence_changed > 0.2

tools:
  - web_search # Can search for current data
  - calculator # Can compute metrics
```

### Marketplace Potential

Skill docs are portable text files. Users can:

- Write custom skills for their specific reasoning patterns
- Share skills publicly or within teams
- Fork and modify community skills
- Version control skills alongside their graphs

---

## 7. Tech Stack

### Frontend

- **Framework — Next.js 15 (App Router):** Server components, API routes, streaming, dominant ecosystem.
- **Node Canvas — @xyflow/react (React Flow v12):** Industry standard for node-based UIs; used by virtually every flow editor product. MIT license, Zustand integration, custom nodes/edges, minimap, controls.
- **UI Components — shadcn/ui + Tailwind CSS:** Copy-paste components built on Radix UI primitives. Zero runtime overhead. React Flow's own component library is built on shadcn — native integration.
- **State Management — Zustand:** Recommended by React Flow. Lightweight, TypeScript-native, no boilerplate.
- **Auto Layout — ELKjs:** Automatic node arrangement — same as React Flow's workflow template.
- **Rich Text — Tiptap:** For node content editing (conclusions, evidence, notes).
- **Drag & Drop — @dnd-kit:** For sidebar → canvas node creation.

### Backend

- **Database — Supabase (PostgreSQL):** Full Postgres with JSONB for flexible node data, recursive CTEs for graph traversal, Row Level Security for multi-tenancy, pgvector for future semantic search, real-time subscriptions for live collaboration.
- **Auth — Clerk:** Fast integration, social logins, org/team support, webhook events. Faster MVP path than WorkOS.
- **Agent Orchestration — Trigger.dev v3:** Durable TypeScript tasks with automatic retries, checkpointing, queue-based concurrency. Open-source (Apache 2.0), self-hostable. Handles long-running LLM calls, fan-out for graph propagation, and scheduled staleness checks.
- **LLM Providers — Anthropic, OpenAI, and Gemini:** Skill docs are provider-agnostic prompt templates, and users manage their own provider keys.
- **File Storage — Supabase Storage (S3-compatible):** Document sources, exported graphs, skill doc library.
- **Hosting — Vercel (frontend) + Supabase (backend) + Trigger.dev Cloud (jobs):** Standard Next.js deployment. Supabase handles DB + auth + storage. Trigger.dev handles background agent work.
- **Caching — Vercel KV (Upstash Redis):** Cache frequently accessed graph structures, rate limit LLM calls.

### Data Model (Core Tables)

```sql
-- Graphs (one per user project)
CREATE TABLE graphs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,            -- Clerk user ID
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Nodes
CREATE TABLE nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID REFERENCES graphs(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,           -- 'data_source', 'claim', 'decision_point', etc.
  name TEXT NOT NULL,
  position_x FLOAT NOT NULL,        -- Canvas position
  position_y FLOAT NOT NULL,

  -- Reasoning state
  conclusion TEXT,                   -- Current conclusion (natural language)
  confidence FLOAT DEFAULT 0.5,     -- 0-1
  evidence JSONB DEFAULT '[]',      -- Array of evidence items
  assumptions JSONB DEFAULT '[]',   -- Array of stated assumptions
  metadata JSONB DEFAULT '{}',      -- Type-specific structured data

  -- Evaluation state
  skill_doc_id UUID,                -- Reference to skill used for evaluation
  autonomy_level TEXT DEFAULT 'propose',
  last_evaluated_at TIMESTAMPTZ,
  evaluation_history JSONB DEFAULT '[]',  -- Array of past conclusions with timestamps

  -- Canvas display
  collapsed BOOLEAN DEFAULT false,
  color TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Edges
CREATE TABLE edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  graph_id UUID REFERENCES graphs(id) ON DELETE CASCADE,
  source_node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
  target_node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,           -- 'supports', 'contradicts', 'depends_on', etc.
  weight FLOAT DEFAULT 1.0,
  condition TEXT,                    -- Optional conditional expression
  transform TEXT,                   -- How to interpret upstream for downstream

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(source_node_id, target_node_id)  -- No duplicate edges
);

-- Skill Docs
CREATE TABLE skill_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT,                     -- NULL = system/community skill
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  node_type TEXT NOT NULL,
  description TEXT,
  config JSONB NOT NULL,            -- Full skill doc as structured JSONB
  is_public BOOLEAN DEFAULT false,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Evaluation Log (audit trail)
CREATE TABLE evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id UUID REFERENCES nodes(id) ON DELETE CASCADE,
  trigger_type TEXT NOT NULL,        -- 'manual', 'upstream_change', 'scheduled', 'event'
  trigger_source TEXT,               -- Which upstream node or event triggered this

  previous_conclusion TEXT,
  new_conclusion TEXT,
  previous_confidence FLOAT,
  new_confidence FLOAT,
  diff_summary TEXT,                 -- Human-readable summary of what changed

  skill_doc_id UUID,
  llm_provider TEXT,
  llm_model TEXT,
  prompt_tokens INT,
  completion_tokens INT,

  status TEXT NOT NULL,              -- 'pending', 'approved', 'applied', 'rejected'
  approved_by TEXT,                  -- User ID if manually approved

  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for graph traversal
CREATE INDEX idx_edges_source ON edges(source_node_id);
CREATE INDEX idx_edges_target ON edges(target_node_id);
CREATE INDEX idx_nodes_graph ON nodes(graph_id);
CREATE INDEX idx_evaluations_node ON evaluations(node_id);
```

### Graph Traversal (Recursive CTE)

```sql
-- Find all downstream nodes from a given source (for propagation)
WITH RECURSIVE downstream AS (
  SELECT target_node_id AS node_id, 1 AS depth
  FROM edges
  WHERE source_node_id = $1  -- Starting node

  UNION ALL

  SELECT e.target_node_id, d.depth + 1
  FROM edges e
  JOIN downstream d ON e.source_node_id = d.node_id
  WHERE d.depth < 20  -- Safety limit
)
SELECT DISTINCT n.*, d.depth
FROM downstream d
JOIN nodes n ON n.id = d.node_id
ORDER BY d.depth;
```

---

## 8. Agent Architecture

### Trigger.dev Task Definitions

```typescript
// tasks/evaluate-node.ts
import { task } from '@trigger.dev/sdk/v3';

export const evaluateNode = task({
  id: 'evaluate-node',
  retry: { maxAttempts: 3 },
  run: async ({ nodeId, triggeredBy }: { nodeId: string; triggeredBy: string }) => {
    // 1. Load node + upstream conclusions + skill doc
    // 2. Build prompt from skill doc template
    // 3. Call LLM
    // 4. Parse structured output
    // 5. Compare with previous conclusion
    // 6. If material change + autonomy allows: update node, trigger downstream
    // 7. If approval needed: create pending evaluation
    // 8. Log evaluation
  },
});

// tasks/propagate-downstream.ts
export const propagateDownstream = task({
  id: 'propagate-downstream',
  run: async ({ nodeId }: { nodeId: string }) => {
    // 1. Query downstream nodes via recursive CTE
    // 2. Topological sort by depth
    // 3. Fan out evaluateNode tasks for each downstream node
    // 4. Collect results into digest
  },
});

// tasks/check-staleness.ts (runs on cron)
export const checkStaleness = task({
  id: 'check-staleness',
  run: async () => {
    // 1. Query all nodes where staleness_score > threshold
    // 2. Group by graph
    // 3. Trigger evaluations for stale nodes
    // 4. Generate weekly digest per user
  },
});
```

### Scheduled Jobs

| Job               | Schedule                 | Description                              |
| ----------------- | ------------------------ | ---------------------------------------- |
| `check-staleness` | Daily                    | Scan all nodes for time-based staleness  |
| `source-refresh`  | Configurable per source  | Poll data source nodes for new data      |
| `weekly-digest`   | Weekly (user-configured) | Summarize all graph changes for the user |

---

## 9. Phased Roadmap

### Phase 1 — Manual Graph with AI Assist (MVP)

**Goal:** User can build a reasoning graph and evaluate individual nodes with AI.

- Canvas with React Flow: create, connect, and arrange nodes
- Node types: assumption, claim, comparison, decision point
- Manual node evaluation: click "Evaluate" → Claude analyzes based on upstream inputs
- Basic edge types: supports, contradicts, depends_on
- Save/load graphs to Supabase
- Clerk auth (email + Google)
- Export graph as JSON

**Ship in:** 4-6 weeks

### Phase 2 — Triggered Propagation

**Goal:** When a node changes, downstream nodes are automatically flagged and optionally re-evaluated.

- Data source nodes with configurable refresh (RSS, API polling, manual URL watch)
- Staleness detection and visual indicators (node border color = freshness)
- Propagation engine: change flows downstream via Trigger.dev tasks
- Approval workflow: pending evaluations queue with accept/reject/edit
- Evaluation history and diff view per node
- Confidence scoring and decay

**Ship in:** 4-6 weeks after Phase 1

### Phase 3 — Agent-Composed Graphs

**Goal:** Agents don't just update nodes — they propose new ones and identify gaps.

- Skill doc system with YAML schema
- Agent-proposed nodes: "Your graph is missing a node for X"
- Chat import: paste a Claude/ChatGPT conversation URL, agent extracts reasoning into nodes
- Community skill doc library
- Graph templates for common patterns (investment analysis, career decision, product strategy)
- Weekly reasoning digest via email

**Ship in:** 6-8 weeks after Phase 2

### Phase 4 — Collaboration and Scale

- Shared graphs with role-based access
- Real-time collaboration (Supabase Realtime)
- Graph versioning and branching ("what-if" scenarios)
- API for external integrations
- Mobile companion (read-only + approval workflow)
- Skill doc marketplace

---

## 10. Competitive Positioning

| Tool                 | What it does well                               | What Breakdown adds                                                     |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------- |
| **Heptabase**        | Visual canvas, card connections, PDF annotation | Typed reasoning primitives, computational propagation, agent evaluation |
| **Obsidian**         | Local-first, bidirectional links, graph view    | Structured node types, confidence scoring, staleness detection          |
| **Tana**             | Supertags, structured data, AI features         | Flow-based composition, propagation engine, skill docs                  |
| **NotebookLM**       | Source-grounded answers, podcast generation     | Evolving reasoning over time, decision tracking, multi-claim management |
| **ChatGPT Projects** | Persistent context, file upload                 | Explicit reasoning structure, visual graph, automated re-evaluation     |
| **Claude Projects**  | Deep reasoning, long context                    | Persistent reasoning graph, agent-driven updates, temporal awareness    |
| **Argument Mapper**  | Structured argument visualization               | Dynamic updates, AI evaluation, multi-claim composition                 |

### The Gap Breakdown Fills

Nobody combines:

1. Visual node-based flow canvas (like ElevenLabs Flows)
2. Structured reasoning primitives (like argument mapping)
3. AI-powered propagation (when inputs change, conclusions re-evaluate)
4. Persistent evolving state (reasoning graph grows over months/years)
5. Agent-native extensibility (skill docs as composable, shareable reasoning "source code")

---

## 11. Open Questions

- **Graph cycles:** How to handle circular reasoning (A supports B, B supports A)? Options: detect and flag, allow with dampening, require DAG enforcement.
- **Confidence aggregation:** How to combine multiple upstream confidence scores into a downstream score? Weighted average? Bayesian? User-configurable?
- **LLM cost management:** Re-evaluating a large graph could be expensive. Strategies: batch evaluations, cache intermediate results, tiered model selection (fast model for screening, strong model for material changes).
- **Offline / local-first:** Should the graph be usable without internet? Implications for Supabase dependency.
- **Privacy:** Reasoning graphs contain sensitive personal strategy. Encryption at rest, access controls, data residency considerations.
- **Pricing model:** Per-graph? Per-evaluation? Per-agent-run? Freemium with evaluation limits?

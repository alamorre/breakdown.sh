# Thesis — v1 Implementation Plan

v1 scope = **Phase 1 (MVP)** from specs.md: a user can build a reasoning graph on a visual canvas, connect nodes with typed edges, evaluate nodes with AI, and persist everything to a database.

---

## Section 1: Project Scaffolding

Set up the monorepo, tooling, and dev environment.

- [ ] Initialize Next.js 15 (App Router) with TypeScript
- [ ] Install and configure Tailwind CSS v4
- [ ] Install and configure shadcn/ui (init + base components: button, input, dialog, dropdown-menu, sheet, tooltip, separator, badge)
- [ ] Install Zustand for state management
- [ ] Install @xyflow/react (React Flow v12)
- [ ] Set up project directory structure (`app/`, `components/`, `lib/`, `types/`, `store/`)
- [ ] Define shared TypeScript types for the domain model (`types/graph.ts`, `types/node.ts`, `types/edge.ts`)
- [ ] Configure ESLint + Prettier
- [ ] Set up environment variables pattern (`.env.local.example`)
- [ ] Verify dev server runs clean

**Done when:** `npm run dev` serves a blank app with shadcn/ui rendering correctly.

---

## Section 2: Auth

Users can sign up, sign in, and have a protected app shell.

- [ ] Create Clerk project and configure environment variables (`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`)
- [ ] Install `@clerk/nextjs`
- [ ] Add `ClerkProvider` to root layout
- [ ] Add Clerk middleware (`middleware.ts`) to protect `/app/*` routes
- [ ] Build sign-in and sign-up pages (`app/sign-in/[[...sign-in]]/page.tsx`, same for sign-up)
- [ ] Build authenticated app shell layout (`app/(app)/layout.tsx`) with user button and sidebar skeleton
- [ ] Add Google OAuth provider in Clerk dashboard
- [ ] Verify: unauthenticated user is redirected to sign-in; authenticated user reaches the app shell

**Done when:** A user can sign in with email or Google and land on a protected dashboard page.

---

## Section 3: Database & Supabase Setup

The Postgres schema is live and accessible from the app.

- [ ] Create Supabase project and configure environment variables (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- [ ] Install `@supabase/supabase-js`
- [ ] Create Supabase client utilities (`lib/supabase/server.ts` for server components/actions, `lib/supabase/client.ts` for browser)
- [ ] Run SQL migration for core tables: `graphs`, `nodes`, `edges`, `evaluations`
- [ ] Add Row Level Security policies scoped to Clerk `user_id`
- [ ] Add database indexes: `idx_edges_source`, `idx_edges_target`, `idx_nodes_graph`, `idx_evaluations_node`
- [ ] Create TypeScript database types (generate from Supabase CLI or hand-write matching types)
- [ ] Verify: can insert and query a graph row from a server action using the authenticated user's ID

**Done when:** All four core tables exist with RLS, and a server action can CRUD a graph row for the signed-in user.

---

## Section 4: Graph CRUD & Dashboard

Users can create, rename, delete, and open reasoning graphs.

- [ ] Build dashboard page (`app/(app)/dashboard/page.tsx`) — lists the user's graphs
- [ ] Server action: `createGraph(name, description)` → inserts into `graphs` table
- [ ] Server action: `getUserGraphs()` → returns all graphs for current user
- [ ] Server action: `deleteGraph(graphId)` → deletes graph (cascades nodes/edges)
- [ ] Server action: `updateGraph(graphId, { name, description })` → rename/edit
- [ ] UI: "New Graph" dialog with name + optional description
- [ ] UI: Graph card in dashboard with name, description, updated_at, delete action
- [ ] Clicking a graph card navigates to `/app/(app)/graph/[graphId]`

**Done when:** User can create a graph from the dashboard, see it listed, rename it, delete it, and click into it.

---

## Section 5: Canvas Foundation

The graph editor page renders a React Flow canvas with pan, zoom, and minimap.

- [ ] Build graph editor page (`app/(app)/graph/[graphId]/page.tsx`)
- [ ] Create Zustand graph store (`store/graph-store.ts`) with state: `nodes`, `edges`, `selectedNodeId`, `selectedEdgeId`
- [ ] Initialize React Flow with `<ReactFlow>`, `<Background>`, `<Controls>`, `<MiniMap>`
- [ ] Load graph data (nodes + edges) from Supabase on page mount and hydrate the store
- [ ] Implement canvas top bar: graph name (editable), back-to-dashboard button
- [ ] Implement node drag — update position in store on `onNodeDragStop`
- [ ] Wire up `onNodesChange` and `onEdgesChange` to keep store in sync with React Flow internals
- [ ] Style canvas background, controls, and minimap with shadcn/ui theme tokens

**Done when:** Opening a graph shows a working React Flow canvas. Nodes (if any) are loaded from the database. Pan, zoom, drag all work.

---

## Section 6: Node Type System

Users can create nodes of different types from a sidebar, and each type renders distinctly on the canvas.

- [ ] Define node type enum and config map (`types/node.ts`): `assumption`, `sub_thesis`, `comparison`, `risk_assessment`, `timeline`, `decision_point`, `composite_thesis`
- [ ] Build custom React Flow node component (`components/canvas/thesis-node.tsx`) that renders differently per type (icon, color, header)
- [ ] Build node creation sidebar (`components/canvas/node-sidebar.tsx`) — lists available node types, grouped by category (Source / Analysis / Synthesis)
- [ ] Implement drag-from-sidebar-to-canvas using @dnd-kit or React Flow's built-in drop handling
- [ ] Server action: `createNode(graphId, nodeType, name, position)` → inserts into `nodes` table
- [ ] On drop: create node in Supabase, then add to store
- [ ] Each node on canvas shows: type icon, name, truncated conclusion (if any), confidence badge
- [ ] Collapsed vs expanded state toggle on node

**Done when:** User can drag node types from the sidebar onto the canvas. Each type renders with its distinct visual style. Nodes persist to the database.

---

## Section 7: Node Detail Panel

Selecting a node opens a side panel where the user can view and edit all node fields.

- [ ] Build node detail sheet (`components/canvas/node-detail-panel.tsx`) — opens when a node is selected on canvas
- [ ] Editable fields: name, conclusion (textarea), confidence (slider 0-1), evidence (list of strings, add/remove), assumptions (list of strings, add/remove)
- [ ] Display metadata: node type, created_at, last_evaluated_at
- [ ] Install Tiptap and use it for the conclusion field (rich text with basic formatting)
- [ ] Server action: `updateNode(nodeId, updates)` → patches the `nodes` row
- [ ] Auto-save on blur or after debounced typing (500ms)
- [ ] Show upstream and downstream connections in the panel (list of connected node names with edge types)
- [ ] Delete node action (with confirmation dialog) — removes node + connected edges

**Done when:** User can select any node, edit its conclusion/confidence/evidence/assumptions in the side panel, and changes persist.

---

## Section 8: Edge System

Users can connect nodes with typed edges that render distinctly on the canvas.

- [ ] Define edge type enum: `supports`, `contradicts`, `depends_on`, `assumes`, `inputs_to`, `sequences_before`
- [ ] Build custom React Flow edge component (`components/canvas/thesis-edge.tsx`) — color and style per edge type (e.g., green for supports, red for contradicts, dashed for assumes)
- [ ] On connect (React Flow `onConnect`): show edge type picker dialog before creating the edge
- [ ] Server action: `createEdge(graphId, sourceNodeId, targetNodeId, edgeType)` → inserts into `edges` table
- [ ] Server action: `deleteEdge(edgeId)` → removes edge
- [ ] Server action: `updateEdge(edgeId, { edgeType, weight })` → update edge properties
- [ ] Edge click → show popover or panel with: edge type (changeable), weight slider
- [ ] Edge labels on canvas showing the edge type
- [ ] DAG validation: warn (but don't block) if a connection would create a cycle

**Done when:** User can draw connections between nodes, pick the edge type, see it visually on the canvas. Edges persist and can be edited/deleted.

---

## Section 9: Graph Persistence & Sync

All canvas state round-trips cleanly between the client store and Supabase.

- [ ] Debounced position save — batch-update node positions after drag stops (avoid saving on every pixel)
- [ ] Server action: `batchUpdateNodePositions(updates: { nodeId, x, y }[])` → single query
- [ ] Full graph load function: `getGraph(graphId)` → returns graph + all nodes + all edges in one query
- [ ] Optimistic updates in Zustand store — apply changes locally first, sync to DB in background
- [ ] Error handling: toast on save failure, retry logic
- [ ] Loading skeleton for graph editor while data fetches
- [ ] Handle stale graph (another tab edited it) — last-write-wins for v1, show updated_at

**Done when:** User can close the browser, reopen the graph, and see everything exactly as they left it. Position changes, node edits, and edge changes all persist reliably.

---

## Section 10: AI Node Evaluation

User clicks "Evaluate" on a node, and Claude analyzes it using upstream context.

- [ ] Install `@anthropic-ai/sdk`
- [ ] Create server-side Claude client (`lib/ai/claude.ts`) with API key from env
- [ ] Build evaluation prompt builder (`lib/ai/build-prompt.ts`): given a node and its upstream nodes+edges, construct the evaluation prompt
  - Include: node name, type, current conclusion, upstream conclusions with edge types, evidence, assumptions
- [ ] Server action: `evaluateNode(nodeId)` → gathers context, calls Claude, returns structured result
- [ ] Parse Claude response into: `{ conclusion, confidence, evidence[], diff_summary }`
- [ ] UI: "Evaluate" button on node detail panel
- [ ] Show evaluation result in a review dialog: previous vs. proposed conclusion, confidence change, diff summary
- [ ] Accept/reject buttons — accept writes the new conclusion+confidence to the node, reject discards
- [ ] Log evaluation to `evaluations` table (trigger_type: 'manual', status: 'approved'|'rejected')
- [ ] Loading state + streaming indicator while Claude is thinking
- [ ] Handle API errors gracefully (rate limit, timeout, invalid response)

**Done when:** User can click "Evaluate" on any node. Claude reads the upstream graph context and proposes an updated conclusion. User can accept or reject. The evaluation is logged.

---

## Section 11: Auto-Layout

User can auto-arrange the graph with one click.

- [ ] Install ELKjs
- [ ] Build layout function (`lib/layout/elk-layout.ts`): takes nodes + edges, returns new positions using ELK's layered algorithm
- [ ] Configure layout direction (top-to-bottom for DAG readability) with sensible spacing
- [ ] UI: "Auto Layout" button in canvas toolbar
- [ ] Animate nodes to new positions (React Flow `fitView` + position transitions)
- [ ] Persist new positions after layout

**Done when:** Clicking "Auto Layout" rearranges all nodes into a clean DAG layout and saves the positions.

---

## Section 12: Export

User can export their graph as JSON.

- [ ] Build export function (`lib/export/export-graph.ts`): serializes full graph (graph metadata + nodes + edges) to a clean JSON structure
- [ ] UI: "Export" button in canvas toolbar → triggers JSON file download
- [ ] Include all node fields (conclusion, confidence, evidence, assumptions, position) and edge fields (type, weight) in export
- [ ] File naming: `{graph-name}-{date}.json`

**Done when:** User clicks export and gets a downloadable JSON file containing their full graph.

---

## Section 13: Polish & Deploy

Ship it.

- [ ] Responsive canvas layout — sidebar collapses on small screens
- [ ] Empty states: empty dashboard ("Create your first graph"), empty canvas ("Drag a node from the sidebar")
- [ ] Keyboard shortcuts: Delete (remove selected node/edge), Escape (deselect), Cmd+Z (undo in Zustand — optional, skip if complex)
- [ ] Toast notifications for save success/failure, evaluation complete, errors
- [ ] Global error boundary
- [ ] Deploy frontend to Vercel
- [ ] Configure Vercel environment variables (Clerk, Supabase, Anthropic)
- [ ] Verify production build: auth flow, graph CRUD, canvas, evaluation, export all work end-to-end
- [ ] Set up Supabase production project (separate from dev)
- [ ] Basic analytics: Vercel Analytics or PostHog (optional, skip if not needed for launch)

**Done when:** The app is live on a Vercel URL. A new user can sign up, create a graph, add nodes, connect them, evaluate with AI, and export — end to end.

# breakdown.sh

A node-based reasoning canvas where hypotheses, assumptions, and conclusions are structured as a DAG. When upstream data changes, agents propagate updates through the graph, re-evaluating downstream conclusions and surfacing what's changed.

@specs.md — full product specification
@implementation_plan.md — v1 build plan (Phase 1 MVP)

---

## Tech Stack

- **Framework:** Next.js 15 (App Router), TypeScript strict mode
- **Canvas:** @xyflow/react (React Flow v12)
- **UI:** shadcn/ui + Tailwind CSS v4
- **State:** Zustand
- **Database:** Supabase (PostgreSQL + RLS + JSONB)
- **Auth:** Clerk
- **AI:** User-configured Anthropic, OpenAI, and Gemini provider keys
- **Auto Layout:** ELKjs
- **Rich Text:** Tiptap
- **Drag & Drop:** @dnd-kit
- **Hosting:** Vercel (frontend) + Supabase (backend)

---

## Dev Environment

```bash
npm install          # install dependencies
make dev             # start dev server (next dev)
make check           # lint + typecheck + test — run before every commit
```

---

## Key Commands

| Command          | What it does                    |
| ---------------- | ------------------------------- |
| `make dev`       | Start Next.js dev server        |
| `make build`     | Production build                |
| `make lint`      | ESLint                          |
| `make typecheck` | `tsc --noEmit`                  |
| `make test`      | Vitest run                      |
| `make format`    | Prettier write                  |
| `make check`     | lint + typecheck + test (gates) |

---

## Code Style

- **Imports:** absolute from `@/` — never relative `../`
- **Components:** PascalCase filenames, named exports, one component per file
- **Non-component files:** kebab-case (`graph-store.ts`, `build-prompt.ts`)
- **TypeScript:** strict mode, no `any` without `// justified: <reason>`
- **Constants:** `const` over `let`, never `var`
- **Logging:** no `console.log` in committed code

---

## Testing

- **Runner:** Vitest
- **Coverage:** 80% line threshold
- **File location:** co-located — `foo.ts` → `foo.test.ts` (same directory)
- **Naming:** `describe("functionName")` → `it("should do specific thing")`
- **Mocking:** mock only external boundaries (Supabase, Claude API), never the thing under test
- **Assertions:** assert specific values — no `expect(true)` or `expect(x).toBeDefined()`

---

## Git Workflow

- **Commits:** conventional — `feat:`, `fix:`, `refactor:`, `chore:`
- **Branches:** `feature/*`, `fix/*`
- **Main:** never force push

---

## Architecture

```
Canvas (React Flow) → Zustand Store → Server Actions → Supabase
                                     ↘ Claude API (evaluations)
```

- **Canvas layer:** React Flow renders nodes/edges, dispatches store actions on user interaction
- **Store layer:** Zustand holds client state, handles optimistic updates
- **Server layer:** Next.js server actions do all DB writes and AI calls
- **Data layer:** Supabase PostgreSQL with RLS scoped to Clerk user_id

---

## Directory Structure

```
src/
├── app/              # Next.js routes
│   ├── (app)/        # Authenticated routes (dashboard, graph editor)
│   ├── sign-in/      # Clerk sign-in
│   └── sign-up/      # Clerk sign-up
├── components/
│   ├── ui/           # shadcn/ui components
│   ├── canvas/       # React Flow nodes, edges, toolbar, sidebar
│   └── shared/       # App-level reusable components
├── lib/
│   ├── supabase/     # Supabase clients (server.ts, client.ts)
│   ├── ai/           # Claude client, prompt builder
│   ├── layout/       # ELKjs auto-layout
│   └── export/       # Graph export
├── store/            # Zustand stores
├── types/            # Shared TypeScript types (graph.ts, node.ts, edge.ts)
└── actions/          # Server actions
```

---

## Do NOT

- **Never commit `.env.local`** — secrets stay local
- **Never use `any`** without a `// justified: <reason>` comment
- **Never skip `make check`** before committing
- **Never use `service_role` key in client-side code** — server actions only
- **Never put Claude API key in browser-accessible code**
- **Never write raw SQL in application code** — use Supabase client
- **Never modify production data manually** — migrations or server actions only
- **Never use `console.log`** — remove before commit
- **Never use relative imports (`../`)** — use `@/` alias
- **Never use `dangerouslySetInnerHTML`** without explicit sanitization
- **Never create custom UI primitives** that shadcn/ui already provides
- **Never inline prompt strings in server actions** — use the prompt builder (`lib/ai/build-prompt.ts`)
- **Never call the Claude API from client-side code** — server actions only

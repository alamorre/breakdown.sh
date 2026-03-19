# Code Style Rules

## TypeScript

- Strict mode enabled — do not loosen `tsconfig.json` strict settings
- No `any` without a `// justified: <reason>` comment on the same line
- Prefer `const` over `let`, never use `var`
- Use explicit return types on exported functions

## Imports

- Always use absolute imports from `@/` (e.g., `@/lib/supabase/server`)
- Never use relative imports (`../`)
- Group imports: React/Next → external libs → `@/` internal → types

## File Naming

- React components: PascalCase (`NodeDetailPanel.tsx`)
- Non-component files: kebab-case (`graph-store.ts`, `build-prompt.ts`)
- One component per file, named export matching filename

## React Components

- Named exports only — no default exports
- Use `React.memo` for canvas node/edge components to prevent re-renders
- Server components by default — add `"use client"` only when needed

## Server Actions

- Prefix files with `"use server"` directive
- Co-locate in `src/actions/` or inline in the consuming file
- Validate all inputs with Zod schemas before DB operations

## Zustand Stores

- One store per domain (`graph-store.ts`, `ui-store.ts`)
- Define state and actions with TypeScript interfaces
- Use `immer` middleware only if mutation logic is complex

## Logging

- No `console.log` in committed code
- Remove debug logs before committing

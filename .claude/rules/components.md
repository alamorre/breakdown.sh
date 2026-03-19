# Component Rules

## shadcn/ui

- Use shadcn/ui components as the base — don't build custom UI primitives that shadcn already provides
- Install new shadcn components with `npx shadcn@latest add <component>`
- shadcn components live in `components/ui/` — don't modify them in place; wrap if customization needed

## Directory Structure

- `components/ui/` — shadcn/ui components (auto-generated)
- `components/canvas/` — React Flow nodes, edges, toolbar, sidebar
- `components/shared/` — app-level reusable components (not canvas-specific)

## Dialogs & Sheets

- All dialogs use shadcn `Dialog` — no custom modals
- All slide-over panels use shadcn `Sheet`
- Node detail panel uses `Sheet` (opens from right side)

## Forms

- Use React Hook Form + Zod for validation
- Define Zod schemas in the same file or in `types/`
- Show validation errors inline using shadcn form components

## Loading States

- Use shadcn `Skeleton` components for loading placeholders
- Show loading state immediately — don't wait for data before rendering layout

## Notifications

- Toast notifications via shadcn Sonner
- Use for: save success/failure, evaluation complete, errors
- Keep toast messages short and actionable

## Theming

- Dark mode support from day one
- Use Tailwind `dark:` classes and shadcn theme tokens
- Test both light and dark modes when building UI

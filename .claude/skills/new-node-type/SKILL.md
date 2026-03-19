---
name: new-node-type
description: Add a new node type to the canvas system
user_invocable: true
invocation: /new-node-type
args: '<type-name>'
---

# New Node Type

Scaffold a new node type end-to-end: enum, React Flow component, config map entry, sidebar entry, and tests.

## Steps

1. **Parse the type name**
   - Take the `<type-name>` argument (e.g., "watchlist")
   - Validate it doesn't already exist in the `NodeType` enum in `src/types/node.ts`

2. **Add to the NodeType enum**
   - Add the new type to the `NodeType` enum in `src/types/node.ts`
   - Add a corresponding entry in the `NODE_TYPE_CONFIG` map with:
     - `label`: human-readable display name
     - `category`: "source" | "analysis" | "synthesis"
     - `color`: a Tailwind color class
     - `icon`: icon identifier
     - `description`: one-line description of the node type

3. **Create the React Flow node component**
   - Create `src/components/canvas/<TypeName>Node.tsx`
   - Extend the base node component (`components/canvas/BaseNode.tsx`)
   - Use `React.memo` for performance
   - Render the type-specific icon, color, and any unique UI elements
   - Named export only

4. **Register in nodeTypes**
   - Add the new component to the `nodeTypes` map passed to `<ReactFlow>`
   - This is typically in `src/components/canvas/node-types.ts` or equivalent

5. **Update the sidebar**
   - Add the new node type to the node creation sidebar (`src/components/canvas/NodeSidebar.tsx`)
   - Place it in the correct category group (Source / Analysis / Synthesis)

6. **Write tests**
   - Create `src/components/canvas/<TypeName>Node.test.tsx`
   - Test that the component renders with required props
   - Test that it displays the correct type icon and label
   - Test collapsed vs. expanded states if applicable

7. **Verify**
   - Run `make check` to ensure lint, typecheck, and tests pass
   - Verify the new node type appears in the sidebar and can be dragged to canvas

## Rules

- Follow naming conventions: PascalCase for component files, kebab-case for non-component files
- Use absolute imports from `@/`
- One component per file with named export
- Use `React.memo` on all canvas node components
- No `console.log` in committed code

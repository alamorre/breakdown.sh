# Canvas Rules (React Flow)

## Node Components

- All custom nodes extend a single base component (`components/canvas/base-node.tsx`)
- Register node types via `nodeTypes` object passed to `<ReactFlow>` — never conditionally render inside
- Use `React.memo` on all node components to prevent unnecessary re-renders
- Must remain performant with 100+ nodes

## Edge Components

- Register custom edges via `edgeTypes` object passed to `<ReactFlow>`
- Style edges by type: color, dash pattern, animation
- Edge labels show the edge type

## State Management

- Canvas state lives in Zustand store — React Flow is a controlled component reading from the store
- All node interactions (select, drag, delete) dispatch store actions, not direct DB calls
- Node position updates debounced (500ms) before persisting to Supabase

## Node Creation

- Sidebar node creation uses React Flow's drop handling or @dnd-kit
- On drop: create node in Supabase first, then add to store
- Each node shows: type icon, name, truncated conclusion, confidence badge

## Persistence

- Debounce position saves — batch-update after drag stops
- Optimistic updates in store — sync to DB in background
- Error handling: toast on save failure, retry logic

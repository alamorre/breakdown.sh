---
name: new-node-type
description: Add a new Breakdown node type to the canvas, service schemas, and headless contracts
user_invocable: true
invocation: /new-node-type
args: '<type-name>'
---

# New Node Type

Scaffold a new node type end-to-end through the current Breakdown canvas, service layer, headless contracts, and tests.

## Steps

1. **Parse the type name**
   - Take the `<type-name>` argument, normalize it to kebab-case, and check existing `node_type` usage.
   - Review `src/types/data-source.ts` first if the node is a source node.
   - Keep generic analysis nodes as `default` unless a distinct runner or source behavior is needed.

2. **Update shared type and schema helpers**
   - Update `src/types/data-source.ts` for source-node mappings, defaults, freshness rules, and metadata guards.
   - Update `src/lib/breakdown-service/schemas.ts` only when validation must know the new shape.
   - Keep `src/types/node.ts` aligned with the database row shape; this repo does not currently use a `NodeType` enum.

3. **Update canvas creation and rendering**
   - Add a sidebar option in `src/components/canvas/NodeSidebar.tsx`.
   - Reuse `src/components/canvas/BreakdownNode.tsx` unless the node genuinely needs a custom React Flow component.
   - If adding a custom component, register it in the `nodeTypes` object in `src/components/canvas/GraphCanvas.tsx` and keep `React.memo`.

4. **Add runner behavior**
   - For fetch/source nodes, implement behavior in `src/lib/breakdown-service/nodes.ts`.
   - Use focused helpers under `src/lib/fetch/` or `src/lib/integrations/` for external systems.
   - Ensure source freshness behavior in `src/lib/graph/source-freshness.ts` remains accurate.

5. **Expose through headless APIs**
   - Confirm graph import/export, workflow manifests, and MCP tools can carry the new `node_type` and metadata.
   - Add examples under `examples/headless/` when the node is intended for agents.

6. **Write tests**
   - Add or update tests beside the changed helper/service files.
   - Cover validation, runner behavior, import/export round trips, and freshness logic when relevant.
   - Add component tests only if a new component is introduced.

7. **Verify**
   - Run `pnpm lint`, `pnpm typecheck`, and the focused Vitest files.
   - Run `pnpm headless:verify` if headless/MCP behavior changed.
   - Verify the new node appears in the sidebar and can be run or refreshed.

## Rules

- Follow naming conventions: PascalCase for component files, kebab-case for non-component files
- Use absolute imports from `@/`
- Keep the existing single `BreakdownNode` renderer unless a separate component removes real complexity
- Use `React.memo` on custom canvas node components
- No `console.log` in committed code

# Explorer File Operations Performance Design

## Problem

Lattice currently waits for a recursive workspace scan after every create, delete, rename, copy, and move operation. The scan walks as many as 12 directory levels, rebuilds every visible node, and invalidates PDF item metadata. Large research workspaces therefore make basic file management feel blocked. Drag-and-drop code exists, but its completion is hidden behind the same slow refresh path; dropping onto a PDF also performs PDF workspace setup and a second hydration step.

## Approved Direction

Keep the Lattice shell and Explorer as the product surface. Treat the in-memory file tree as an immediately updated projection of successful disk operations. Reserve a full recursive refresh for explicit user refresh, initial workspace open, and recovery after an operation whose final disk state cannot be determined.

## Architecture

1. Add pure immutable tree mutation helpers for insert, remove, rename, and move.
2. Add one functional `updateFileTree` action to the workspace store so concurrent operations always transform the latest tree instead of a stale hook closure.
3. After the core filesystem command succeeds, update the tree synchronously before optional annotation, Markdown-link, plugin-event, or PDF companion work.
4. Preserve directory expansion state and already hydrated PDF virtual children during ordinary mutations.
5. When moving into a hidden PDF item directory, remove the source from the visible tree immediately, then hydrate only the target PDF node. Do not expose `.lattice/items` as a normal directory.
6. Keep `refreshDirectory()` as the correctness recovery path and manual refresh command, not the normal completion path.

## Interaction Contract

- Create: the new file or empty folder appears immediately in its parent and enters rename mode without scanning the workspace.
- Delete: the node disappears immediately after disk deletion succeeds; open tabs and Explorer selection are then cleaned up.
- Rename: the node and every descendant path update atomically while handles and expansion state are preserved.
- Move: the source disappears and the target directory receives the relocated node atomically. Moving a directory rewrites descendant paths.
- PDF drop: the source disappears from its old location, the PDF expands, and its virtual children hydrate from the item workspace.
- Invalid drop: self-drop, descendant-drop, or unresolved targets leave both disk and tree unchanged and produce a visible error.

## Performance Contract

- Successful create, delete, rename, and move operations must not call the root directory iterator.
- The amount of React state work is proportional to the changed path depth, not the total workspace size.
- Manual refresh remains coalesced so repeated refresh requests do not run concurrently.

## Error And Concurrency Policy

- Disk is authoritative: mutate the tree only after the core filesystem operation succeeds.
- Functional store updates prevent stale-tree overwrites when operations complete close together.
- Optional companion cleanup failures are logged and surfaced where actionable, but do not restore an already deleted or moved source file.
- If a mutation cannot find the expected parent/node after a successful disk operation, schedule one silent recovery refresh.

## Verification

- Pure unit tests cover sorted insertion, removal, directory descendant path rewriting, and hidden-target moves.
- Hook tests assert no root rescan for create, delete, and move.
- Explorer tests cover file/folder drag payloads, directory targets, PDF targets, self/descendant rejection, and error feedback.
- Run focused Vitest, typecheck, lint, build, Tauri build, `qa:gate`, then refresh the local desktop release under `releases/`.


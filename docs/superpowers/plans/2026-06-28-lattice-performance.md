# Lattice Interaction Performance Plan

**Goal:** Make common Lattice operations feel immediate: Markdown editing, file/tab switching, side panel toggles, menus, dialogs, and heavy preview transitions.

**Principles:**
- Keep keystrokes urgent; move preview/index/diagnostic work to deferred or transition updates.
- Load heavy UI only when users open it.
- Keep render boundaries small and stable.
- Prefer measured, low-risk changes over broad rewrites.

---

## Task 1: Baseline And Hotspot Review

- [x] Review Markdown editor render/update path.
- [x] Review file viewer and active tab switching path.
- [x] Review heavy dialog/menu/plugin loading path.
- [x] Add or update focused tests for performance-sensitive behavior.

## Task 2: Markdown Editing Responsiveness

- [x] Defer expensive Markdown reading-preview preparation from raw keystrokes.
- [x] Keep command bar and secondary panels from recomputing on every editor character when not needed.
- [x] Keep context-menu/tool actions stable without re-rendering heavy editor panes.

## Task 3: File And Panel Switching

- [x] Lazy-load heavy viewers and optional dialogs behind user intent.
- [x] Avoid mounting inactive heavy panels where possible.
- [x] Keep tab switch state updates minimal and local.

## Task 4: Search, Links, And Plugin Panels

- [x] Use deferred values for large filtered lists.
- [x] Memoize derived maps/sets used repeatedly in render.
- [x] Keep panel search inputs responsive during large result recomputation.

## Task 5: Verification

- [x] Run focused unit tests for changed areas.
- [x] Run `npm run typecheck`.
- [x] Run `npm run lint`.
- [x] Run `npm run build`.
- [x] Summarize remaining performance risks separately from completed work.

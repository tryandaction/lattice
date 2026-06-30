# Lattice Single-Line Resize UX

Date: 2026-06-29

## Goal

Make workspace regions feel lighter and easier to resize by using one visual separator line per split. The visible line is also the user's resize target, with an invisible hit area around it so the interface stays minimal without making resizing hard.

## UX Rules

- Region boundaries use one visible 1px separator line.
- Resize hit targets remain comfortable: 10px around the visible line.
- The old dotted/grip handle is hidden in normal browsing.
- Hover, focus, and drag states subtly thicken or recolor the line.
- Adjacent panels must not add duplicate `border-l` or `border-r` beside a `ResizableHandle`.
- Active panes use internal focus styling, not an outer border that competes with split lines.

## Implemented

- Updated `ResizableHandle` to render a 10px invisible hit target with a single centered separator line.
- Removed the visible grip/dot handle while keeping a screen-reader label.
- Preserved pointer, mouse, keyboard, and window-level drag behavior.
- Removed duplicate borders next to handles in:
  - desktop AI chat panel
  - plugin panel dock
  - PDF annotation sidebar
  - tablet sidebar resize handle override
- Updated main pane focus styling from outer border/ring to an internal top accent.
- Added regression tests for the new single-line separator behavior and pane focus styling.

## Verification

- `npm run test:run -- "src/components/ui/__tests__/resizable.test.tsx" "src/components/main-area/__tests__/pane-wrapper.test.tsx"`
- `npm run typecheck`

## Follow-Up Audit

Static sidebars that are not resize boundaries may still use a single border. If a future panel is placed next to `ResizableHandle`, remove the adjacent panel border and let the handle own the boundary.

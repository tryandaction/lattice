# Markdown Table, Context Menu, And Link Navigation Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create git commits or desktop releases unless the user explicitly asks for them.

**Goal:** Make Markdown table editing, Markdown context menus, and Markdown link navigation feel predictable, uncluttered, professional, and reliable in both light and dark themes.

**Architecture:** Centralize popup positioning in pure helpers, render floating menus through portals when parent overflow can clip them, and extend the existing `WorkbenchContextMenu` rather than creating another menu system. Keep Markdown link navigation on the existing `lib/link-router` path, adding tests and integration only where propagation is missing.

**Tech Stack:** React 19, Next.js 16, CodeMirror live-preview widgets, Zustand workspace/navigation stores, Vitest/JSDOM, existing Lattice `navigateLink` router, React `createPortal`.

---

## Files And Responsibilities

- `src/lib/menu-positioning.ts`: shared viewport-aware positioning for context menus, submenus, and anchored table panels.
- `src/lib/__tests__/menu-positioning.test.ts`: pure tests for flipping, clamping, submenu placement, and available height.
- `src/components/ui/workbench-context-menu.tsx`: grouped menu rendering, submenu hover/focus behavior, keyboard-accessible nested tools, viewport-safe placement.
- `src/components/ui/__tests__/workbench-context-menu.test.tsx`: menu overflow, submenu open-on-hover, action execution, and outside close tests.
- `src/components/editor/codemirror/live-preview/table-editor.tsx`: portal table action panel, persistent row/column/table menu interaction, clearer action groups.
- `src/components/editor/codemirror/live-preview/table-editor.css`: compact professional table controls, dark-mode-safe surfaces, no clipping by table wrapper.
- `src/components/editor/codemirror/live-preview/__tests__/table-editor.test.tsx`: table menu stays mounted when moving to panel, uses portal, supports row/column/table operations.
- `src/components/editor/obsidian-markdown-viewer.tsx`: selection-aware Markdown context menu grouping and More Tools as true submenu; link actions in link context.
- `src/components/editor/__tests__/markdown-links-panel.test.tsx`: current-file link panel noise control, stable outgoing link targets, collapsed suggestion sections.
- `src/lib/link-router/parse-link-target.ts`: only adjust if missing source-PDF or encoded fragment cases are found.
- `src/lib/link-router/__tests__/parse-link-target.test.ts` and existing navigation tests: PDF page/annotation, MD, HTML, web URL, relative path with spaces.
- `src/lib/link-router/navigate-link-with-feedback.ts`: shared navigation wrapper that reports unresolved link targets.
- `src/lib/link-router/__tests__/navigate-link-with-feedback.test.ts`: success, false, and thrown-error feedback coverage.

## Task 1: Shared Popup Positioning

- [x] **Step 1: Write pure positioning tests**

Add tests asserting:

```ts
expect(positionAnchoredMenu({
  anchorRect: { left: 900, top: 700, right: 920, bottom: 720, width: 20, height: 20 },
  menuSize: { width: 260, height: 180 },
  viewport: { width: 1024, height: 768 },
  placement: "right-start",
})).toMatchObject({ side: "left" });
```

Also cover top/bottom clamping and `maxHeight`.

- [x] **Step 2: Implement `src/lib/menu-positioning.ts`**

Expose:

```ts
export type MenuPlacement = "cursor" | "right-start" | "left-start" | "bottom-start" | "top-start";
export interface MenuPositionResult { left: number; top: number; maxHeight: number; side: "right" | "left" | "bottom" | "top" | "cursor"; }
```

Use 8px viewport padding and flip before clamping.

- [x] **Step 3: Verify**

Run:

```bash
npm run test:run -- "src/lib/__tests__/menu-positioning.test.ts"
```

## Task 2: Workbench Context Menu Submenus

- [x] **Step 1: Extend action type tests**

Test that an action with `children` opens a submenu on hover/focus and does not execute the parent action.

- [x] **Step 2: Implement submenu rendering**

Extend `WorkbenchMenuAction`:

```ts
children?: WorkbenchMenuAction[];
```

Render child menus as fixed-position portal/floating siblings using `positionAnchoredMenu`. Open on `pointerenter` and focus. Close when pointer leaves both parent and submenu or when Escape/outside click fires.

- [x] **Step 3: Preserve current behavior**

Existing flat-menu tests must still pass, including long menu viewport max height and disabled item behavior.

## Task 3: Markdown Context Menu Grouping

- [x] **Step 1: Write viewer/menu behavior tests**

Cover:

- selected text menu shows Cut/Copy/format/link first;
- empty-area menu does not show disabled Cut/Copy at top;
- More Tools appears as a submenu beside the parent item;
- table context shows table actions grouped under Table, not as a tall flat list.

- [x] **Step 2: Refactor `buildMarkdownContextActions`**

Split action builders:

```ts
buildSelectionActions(context)
buildInsertActions(context)
buildTableActions(context)
buildLinkActions(context)
buildMoreToolsActions()
```

Use `children` for More Tools and Table action groups where possible. Keep frequently used commands in the first visible menu.

- [x] **Step 3: Verify**

Run:

```bash
npm run test:run -- "src/components/ui/__tests__/workbench-context-menu.test.tsx"
```

## Task 4: Table Editor Portal Action Panel

- [x] **Step 1: Write table interaction tests**

Add tests:

- opening column actions renders panel under `document.body`;
- row/column/table panel remains open after wrapper `mouseLeave`;
- panel position has fixed coordinates and remains inside viewport;
- clicking `Duplicate Row` still updates Markdown.

- [x] **Step 2: Move structure panel to portal**

Store menu state as:

```ts
anchorRect: DOMRectLike;
kind: "table" | "row" | "column";
```

Use `createPortal(..., document.body)` and `positionAnchoredMenu`.

- [x] **Step 3: Make interaction persistent and clear**

Keep perimeter handles visible while menu is open. Close on Escape, outside pointer down, table update, or explicit action. Do not close just because the pointer moves between the handle and panel.

- [x] **Step 4: Polish UI**

Make panel compact:

- table: Add row, Add column, Paste cells, Copy, Source;
- row: Insert above/below, Duplicate, Move up/down, Highlight, Delete;
- column: Insert left/right, Duplicate, Move left/right, Align submenu, Highlight, Delete.

Use icons where already available and keep labels short.

## Task 5: Markdown Link Navigation Integration

- [x] **Step 1: Add link parser/navigation tests**

Cover:

```ts
parseLinkTarget("../paper.pdf#page=2", { currentFilePath: "notes/a/code.md" })
parseLinkTarget("../paper.pdf#annotation=ann-1", { currentFilePath: "notes/a/code.md" })
parseLinkTarget("../source file.md#Heading One", { currentFilePath: "notes/a/code.md" })
parseLinkTarget("./demo.html", { currentFilePath: "notes/a/code.md" })
parseLinkTarget("https://example.com")
```

- [x] **Step 2: Verify Markdown click path**

Ensure rendered Markdown and table-cell links dispatch through `navigateLink(href, { paneId, rootHandle, currentFilePath })`. Ctrl/Cmd-click may keep selection behavior, but normal click in reading/preview surfaces should navigate.

- [x] **Step 3: Add user feedback**

## Task 5A: Markdown Links Panel Noise Control

- [x] **Step 1: Reclassify panel sections**

Keep true current-file links first: `Outgoing` and `Broken`. Treat backlinks, unlinked mentions, attachment cleanup, and local graph as secondary relationship/suggestion surfaces.

- [x] **Step 2: Default-collapse noisy suggestion sections**

Default-collapse `Backlinks`, `Unlinked mentions`, `Attachments`, and `Local graph`, while preserving the user's saved collapsed state after interaction.

- [x] **Step 3: Reduce false unlinked mentions**

Ignore generic note names such as `index`, `note`, `paper`, `code`, `test`, and short non-CJK candidates so ordinary files do not create noisy whole-workspace mention suggestions.

- [x] **Step 4: Stabilize outgoing navigation targets**

Route outgoing links through resolved paths when available, preserving heading, PDF page, PDF annotation, code line, and notebook cell fragments.

- [x] **Step 5: Verify**

Run:

```bash
npm run test:run -- "src/components/editor/__tests__/markdown-links-panel.test.tsx" "src/components/renderers/__tests__/markdown-renderer.test.tsx" "src/lib/link-router/__tests__/navigate-link.test.ts"
```

When navigation returns false, show a concise toast with target path and keep the menu/selection stable.

## Task 6: Verification Without Desktop Release

- [x] **Step 1: Focused tests**

Run:

```bash
npm run test:run -- "src/lib/__tests__/menu-positioning.test.ts" "src/components/ui/__tests__/workbench-context-menu.test.tsx" "src/components/editor/codemirror/live-preview/__tests__/table-editor.test.tsx"
```

- [x] **Step 2: Link tests**

Run:

```bash
npm run test:run -- "src/lib/link-router/__tests__/parse-link-target.test.ts" "src/components/renderers/__tests__/markdown-renderer.test.tsx"
```

- [ ] **Step 3: Quality gates**

Run:

```bash
npm run typecheck
npm run lint -- --quiet
npm run build
```

- [ ] **Step 4: Stop before desktop release**

Do not run `npm run tauri:build` or `release:prepare` in this phase unless the user explicitly asks.

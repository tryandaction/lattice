# Markdown Export, Search, Emoji, And Tools Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development and superpowers:systematic-debugging to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create git commits or desktop releases unless the user explicitly asks for them.

**Goal:** Make Markdown export, in-document search, emoji/symbol insertion, and Markdown tools menus reliable, theme-aware, bilingual, and professionally simple.

**Architecture:** Keep existing editor and export systems; fix root causes at the integration boundaries. Reuse `WorkbenchContextMenu.children` for categorized tools, existing i18n dictionaries for labels, existing theme tokens for search/export UI, and focused Vitest tests for behavior.

**Tech Stack:** React 19, Next.js 16, CodeMirror live-preview, existing Markdown export pipeline, Sonner toasts, Vitest/JSDOM, Lattice i18n.

---

## Files And Responsibilities

- `src/components/editor/markdown-export-dialog.tsx`: export modal layout, portal/layer behavior, simplified controls, failure reporting, export action flow.
- `src/lib/markdown-export.tsx`: export document model and file writing pipeline; only adjust if root cause is found there.
- `src/lib/__tests__/markdown-export.test.tsx`: export model and failure coverage.
- `src/components/editor/obsidian-markdown-viewer.tsx`: More Tools action grouping, emoji/symbol insertion entry, command bar tools menu.
- `src/components/ui/workbench-context-menu.tsx`: already supports submenus; use as-is unless nested positioning bug is found.
- `src/components/editor/codemirror/live-preview/live-preview-theme.ts` and/or `src/app/globals.css`: CodeMirror search panel light/dark styling.
- `src/lib/i18n/en-US.ts` and `src/lib/i18n/zh-CN.ts`: all new export/search/tool/emoji labels and error text.
- Existing tests near changed components: add focused tests for export failure detail, categorized tools, and emoji insertion where practical.

## Task 1: Export Dialog Root Cause And Layering

- [ ] **Step 1: Read export flow and existing tests**

Inspect `MarkdownExportDialog`, `markdown-export.tsx`, and related tests. Identify where "Export failed" is generated and whether the original exception is swallowed.

- [ ] **Step 2: Add failing test for useful failure detail**

Add/extend a test that mocks an export writer failure and asserts the dialog or toast includes the thrown message, not only a generic "Export failed".

- [ ] **Step 3: Fix failure reporting**

Preserve the original error message in state and toast description. Keep the user-facing title short.

- [ ] **Step 4: Fix modal layering**

Ensure the modal/backdrop is rendered above pane splitters, resizable handles, tabs, and sidebars. Prefer an existing portal layer; otherwise use a fixed root with a z-index token above floating panels.

- [ ] **Step 5: Simplify UI**

Reduce explanatory copy, keep export format/options compact, keep preview readable, and ensure dark mode preview borders/backgrounds are coherent.

## Task 2: Markdown Search Panel Polish

- [ ] **Step 1: Locate CodeMirror search DOM styling**

Identify whether search panel styles come from CodeMirror default CSS or local theme overrides.

- [ ] **Step 2: Add scoped theme styles**

Style `.cm-search` only within the live-preview editor: background, border, input, buttons, checkboxes, close button, spacing, and dark/light contrast.

- [ ] **Step 3: Verify search functionality remains intact**

Run existing editor tests and manually inspect that search, next, previous, all, replace, match case, regexp, and by word remain available.

## Task 3: Emoji And Symbol Insertion

- [ ] **Step 1: Remove browser prompt dependency from primary flow**

Stop using `promptText("Emoji or symbol")` as the main menu action.

- [ ] **Step 2: Provide categorized symbol actions**

Expose common categories: Recent, Writing, Math, Arrows, Greek, Science, Mood. Clicking an item inserts it immediately and remembers it.

- [ ] **Step 3: Preserve custom insertion path**

If a custom text entry remains, it must be clearly labeled and should not be the first/only path.

## Task 4: More Tools Categorization

- [ ] **Step 1: Group actions into child menus**

Use child menus for:

- Blocks: callout, task list, footnote, code block, math block.
- Tables/Properties: table, properties, set property, copy YAML, convert line.
- Links: wiki link, heading anchor, block anchor, embed.
- Media: image/attachment, GIF URL.
- Symbols: emoji/symbol categories and quantum keyboard.
- Voice: voice input.

- [ ] **Step 2: Remove duplicate flat actions**

The first More Tools level should be short enough to fit comfortably on common laptop screens.

- [ ] **Step 3: Verify actions are real**

Each category item must call the same existing command callback as before; no placeholder actions.

## Task 5: Verification Without Desktop Release

- [ ] **Step 1: Focused tests**

Run focused tests for export, menus, markdown renderer/router, and editor widgets touched in this plan.

- [ ] **Step 2: Quality gates**

Run:

```bash
npm run typecheck
npm run lint -- --quiet
npm run build
```

- [ ] **Step 3: Stop before desktop release**

Do not run `npm run tauri:build` or `release:prepare` in this phase unless the user explicitly asks.

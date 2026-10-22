# Controlled Performance And Evidence Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound Lattice PDF and workspace memory, keep large annotation workflows responsive, and make detailed AI PDF answers navigate to exact evidence.

**Architecture:** Add small pure cache/index/navigation helpers around the existing PDF adapter, content store, Context Graph, and link router. Keep the active rendering surface unchanged while bounding retained data and moving expensive optional work behind user intent.

**Tech Stack:** React 19, TypeScript, Zustand, PDF.js, Vitest, Testing Library, Playwright/browser diagnostics, Tauri/WebView2.

---

Git commit steps are intentionally omitted because the user explicitly prohibited commit/push.

### Task 1: Bounded PDF page text cache

**Files:**
- Modify: `src/lib/pdf-page-text-cache.ts`
- Test: `src/lib/__tests__/pdf-page-text-cache.test.ts`

- [ ] Add a failing test that resolves more than the configured page limit and verifies the oldest resolved page model is evicted while a recently touched model remains.
- [ ] Run `npm exec vitest -- run src/lib/__tests__/pdf-page-text-cache.test.ts` and verify the new assertion fails.
- [ ] Introduce a per-document resolved-page LRU, expose a test-only snapshot helper, and clear associated model caches on eviction.
- [ ] Re-run the focused test and verify it passes.

### Task 2: PDF layer lifecycle and demand-driven reference preview

**Files:**
- Modify: `src/components/renderers/pdf-highlighter-adapter.tsx`
- Modify: `src/lib/pdf-reference-preview.ts`
- Test: `src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`
- Test: `src/lib/__tests__/pdf-reference-preview.test.ts`

- [ ] Add failing tests proving a hidden/unmounted virtual page clears canvas dimensions and text/annotation DOM, and ordinary PDF open does not schedule a twelve-page reference scan.
- [ ] Run the two focused test files and verify the assertions fail.
- [ ] Add a single page-layer release helper, call it on visibility loss and cleanup, call PDF.js page cleanup where safe, and cap canvas output by a pixel budget.
- [ ] Change reference-preview preparation to visible-page data plus explicit citation demand.
- [ ] Re-run the focused tests.

### Task 3: Bounded clean content cache and precise pane subscriptions

**Files:**
- Modify: `src/stores/content-cache-store.ts`
- Modify: `src/components/main-area/pane-wrapper.tsx`
- Test: `src/lib/__tests__/editor-stability.test.ts`
- Test: `src/components/main-area/__tests__/pane-wrapper.test.tsx`

- [ ] Add failing tests for clean-entry LRU eviction, dirty-entry pinning, and no PaneWrapper rerender on unrelated pane layout changes.
- [ ] Run the focused tests and verify failure.
- [ ] Add clean cache byte/entry accounting and narrow PaneWrapper to the requested pane projection with stable equality.
- [ ] Re-run the focused tests.

### Task 4: Annotation page index, bounded sidebar, and coalesced persistence

**Files:**
- Create: `src/lib/pdf-annotation-index.ts`
- Modify: `src/components/renderers/pdf-annotation-sidebar.tsx`
- Modify: `src/components/renderers/pdf-highlighter-adapter.tsx`
- Modify: `src/hooks/use-annotation-system.ts`
- Test: `src/lib/__tests__/pdf-annotation-index.test.ts`
- Test: `src/components/renderers/__tests__/pdf-annotation-sidebar.test.tsx`
- Test: `src/hooks/__tests__/use-annotation-system.test.tsx`

- [ ] Add failing tests for page lookup, a bounded mounted-row count with 200 annotations, responsive deferred filtering, and one persisted snapshot for a burst of updates.
- [ ] Run the focused tests and verify failure.
- [ ] Build the pure page index, consume only rendered-page buckets, add fixed-height windowed sidebar rows, stabilize handlers, and coalesce persistence snapshots.
- [ ] Re-run the focused tests.

### Task 5: Page-aware AI context and adaptive teaching prompt

**Files:**
- Modify: `src/components/ai/ai-chat-context.ts`
- Modify: `src/lib/ai/context-graph.ts`
- Modify: `src/lib/ai/orchestrator.ts`
- Test: `src/lib/__tests__/ai-context-graph.test.ts`
- Test: `src/lib/__tests__/ai-orchestrator.test.ts`
- Test: `src/components/ai/__tests__/ai-chat-panel.test.tsx`

- [ ] Add failing tests proving an oversized PDF keeps relevant page chunks, emits `pdf_page` evidence with page/snippet anchors, and explanatory prompts request teaching depth without forcing verbose greetings.
- [ ] Run the focused tests and verify failure.
- [ ] Parse extracted page markers into bounded nodes, truncate within nodes instead of dropping them, prioritize query matches, and replace the global concise instruction with adaptive response guidance.
- [ ] Re-run the focused tests.

### Task 6: Strict AI links and exact evidence navigation

**Files:**
- Create: `src/lib/ai/evidence-navigation.ts`
- Modify: `src/components/renderers/markdown-renderer.tsx`
- Modify: `src/components/renderers/app-markdown-link.tsx`
- Modify: `src/components/ai/chat-timeline.tsx`
- Modify: `src/components/ai/ai-chat-panel.tsx`
- Modify: `src/lib/link-router/types.ts`
- Modify: `src/lib/link-router/navigate-link.ts`
- Modify: `src/components/renderers/pdf-highlighter-adapter.tsx`
- Test: `src/components/ai/__tests__/ai-chat-panel.test.tsx`
- Test: `src/components/renderers/__tests__/markdown-renderer.test.tsx`
- Test: `src/lib/link-router/__tests__/navigate-link.test.ts`

- [ ] Add failing tests proving `4,2,2` is plain text in AI mode, a PDF evidence chip sends its concrete ref, cross-root resolution opens the PDF, and page/snippet navigation creates a temporary highlight.
- [ ] Run the focused tests and verify failure.
- [ ] Add strict AI link classification, source-specific chip callbacks, evidence-aware navigation options, and PDF snippet-to-rect resolution using the canonical page text model.
- [ ] Re-run the focused tests.

### Task 7: Stress diagnostics and release verification

**Files:**
- Modify: `src/app/performance-test/page.tsx`
- Modify: `src/components/diagnostics/pdf-regression-diagnostics.tsx`
- Modify: `scripts/browser-regression.mjs`
- Update: `docs/superpowers/specs/2026-08-17-controlled-performance-and-evidence-navigation-design.md`

- [ ] Add deterministic fixtures for long PDF navigation, 200 annotations, rapid filters, repeated tab switching, and evidence jumps.
- [ ] Verify desktop and narrow browser layouts have no overlap, blank PDF, horizontal overflow, or unbounded mounted nodes.
- [ ] Run focused Vitest sets, `npm run qa:agent-smoke -- --unit-only`, `npm run typecheck`, `npm run test:docs`, and `npm run qa:gate`.
- [ ] Build the desktop release artifact, record hashes and paths, and request explicit confirmation before replacing an installed desktop build if the release process performs an overwrite.

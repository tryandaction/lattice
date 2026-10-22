# AI Citation And Navigation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI citation identifiable, source-grouped, strictly linkable, and diagnostically navigable without changing model, Tool Broker, approval, or PDF write permissions.

**Architecture:** Add one pure Citation Contract adapter over the existing `EvidenceRef` shape. Derive source groups, passage chips, reference trees, and strict Markdown link eligibility from that contract. Extend workspace/PDF navigation with a request id and structured outcome while retaining the existing boolean API for non-AI callers.

**Tech Stack:** React 19, TypeScript, Zustand, react-markdown, Vitest, Testing Library, existing PDF.js text cache and renderer.

---

Git commit, push, reset, release upload, installation replacement, dependency installation, shell/network/MCP/direct-write/autonomous coding capabilities are out of scope.

### Task 1: Citation Contract Pure Adapter

**Files:**
- Create: `src/lib/ai/citation-contract.ts`
- Test: `src/lib/__tests__/citation-contract.test.ts`
- Modify: `src/lib/ai/types.ts` only when a shared exported contract type is needed by consumers

- [ ] **Step 1: Write failing tests** for fragment-free canonical paths, deterministic stable ids, source grouping of twelve PDF passages into one group, passage dedupe by normalized quote and target location, and preservation of distinct page/quote passages.
- [ ] **Step 2: Run the focused test** with `./node_modules/.bin/vitest.cmd run "src/lib/__tests__/citation-contract.test.ts" --maxWorkers=1`; confirm failure because the module and contract functions do not exist.
- [ ] **Step 3: Implement the minimal adapter** with `canonicalCitationPath`, `buildCitationContract`, `dedupeCitationContracts`, and `groupCitationContracts`. Use a deterministic string hash for `stableId`, `sourceGroupId` from canonical source identity, bounded quote text, and existing `parseLinkTarget` output for `navigationTarget`; never invent a citation from a string that is not an `EvidenceRef`.
- [ ] **Step 4: Re-run the focused test** and confirm all contract assertions pass.

### Task 2: Source-Grouped Result And Evidence Views

**Files:**
- Modify: `src/lib/ai/result-view-model.ts`
- Modify: `src/lib/ai/evidence-panel.ts`
- Modify: `src/lib/ai/reference-browser.ts`
- Modify: `src/components/ai/chat-timeline.tsx`
- Modify: `src/components/ai/evidence-panel.tsx`
- Test: `src/lib/__tests__/ai-result-view-model.test.ts`
- Test: `src/lib/__tests__/evidence-panel.test.ts`
- Test: `src/lib/__tests__/reference-browser.test.ts`
- Test: `src/components/ai/__tests__/evidence-panel.test.tsx`

- [ ] **Step 1: Add failing tests** asserting one PDF source row with `12 passages`, stable citation keys, at most three passage chips plus `+N passages`, and a collapsed source group whose passages appear only after activation.
- [ ] **Step 2: Run the four focused test files** and confirm the new assertions fail against fragment-based summary rows and default-expanded groups.
- [ ] **Step 3: Refactor the view models** to derive source rows and passage leaves from Citation Contract groups. Keep raw context-node counts separately labeled as context, and use `stableId` for React keys and selection state.
- [ ] **Step 4: Render compact source summaries** with basename and passage count, show page/line/cell plus bounded quote in chips/details, and keep the full path in title/details/copy actions. Keep PdfCompanionReview compact and non-persistent.
- [ ] **Step 5: Re-run the focused tests** and verify no duplicate source rows remain.

### Task 3: Strict AI Markdown Link Contract

**Files:**
- Modify: `src/components/renderers/app-markdown-link.tsx`
- Modify: `src/components/renderers/markdown-renderer.tsx`
- Modify: `src/components/ai/chat-timeline.tsx`
- Create or modify: `src/lib/ai/citation-contract.ts`
- Test: `src/components/renderers/__tests__/markdown-renderer.test.tsx`
- Test: `src/lib/__tests__/citation-contract.test.ts`

- [ ] **Step 1: Add failing tests** for plain `4,2,2`, unknown relative paths, fabricated file-like hrefs, valid external URLs, verified workspace targets, and `[citation:stableId]` tokens.
- [ ] **Step 2: Run the Markdown and contract tests** and confirm unknown targets are currently accepted or cannot resolve to a contract.
- [ ] **Step 3: Add a strict classifier** that accepts external URLs, contract-backed workspace targets, and contract-backed citation tokens only. Render all other AI hrefs as text and never call `navigateLinkWithFeedback` for them.
- [ ] **Step 4: Pass the current message contract map** into strict Markdown rendering while leaving document/workspace Markdown behavior unchanged.
- [ ] **Step 5: Re-run the focused tests** and confirm invalid links do not emit error toasts or navigation calls.

### Task 4: Structured Workspace And PDF Navigation Outcomes

**Files:**
- Modify: `src/lib/link-router/types.ts`
- Modify: `src/lib/link-router/navigate-link.ts`
- Modify: `src/stores/link-navigation-store.ts`
- Modify: `src/stores/workspace-store.ts`
- Modify: `src/components/renderers/pdf-highlighter-adapter.tsx`
- Modify: `src/components/ai/ai-chat-panel.tsx`
- Modify: `src/components/ai/evidence-panel.tsx`
- Test: `src/lib/link-router/__tests__/navigate-link.test.ts`
- Test: `src/lib/link-router/__tests__/parse-link-target.test.ts`
- Test: `src/lib/__tests__/pdf-link-navigation.test.ts`
- Test: `src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`

- [ ] **Step 1: Add failing tests** for fragment-free root matching, root-not-found/file-not-found/unsupported-target classification, pending navigation retention, page-not-ready, quote-not-found, renderer-timeout, and successful rect/snippet completion.
- [ ] **Step 2: Run the focused navigation tests** and confirm the current boolean API and early pending cleanup cannot express those outcomes.
- [ ] **Step 3: Implement `navigateLinkDetailed`** returning `{ ok, requestId, status }`, keep `navigateLink` as a boolean compatibility wrapper, and canonicalize paths before root selection and comparisons.
- [ ] **Step 4: Extend the pending navigation store** with request ids and terminal outcomes. Keep a request pending until PDF success or a bounded structured failure; preserve existing consume behavior for non-PDF viewers.
- [ ] **Step 5: Update the PDF adapter** to claim matching requests without dropping them, prefer rects, otherwise resolve the bounded quote after the page model is ready, complete once, and stop retrying after a fixed timeout. Do not create persistent annotations.
- [ ] **Step 6: Re-run focused navigation and adapter tests** and verify repeated clicks do not create concurrent duplicate requests.

### Task 5: Failure Review Surface

**Files:**
- Modify: `src/components/ai/evidence-panel.tsx`
- Modify: `src/components/ai/ai-chat-panel.tsx`
- Modify: `src/components/ai/chat-timeline.tsx`
- Test: `src/components/ai/__tests__/evidence-panel.test.tsx`
- Test: `src/components/ai/__tests__/ai-chat-panel.test.tsx`

- [ ] **Step 1: Add failing component tests** for readable basename/page/quote failure details, Retry, Open source, Copy reference, and no toast for invalid AI links.
- [ ] **Step 2: Implement the compact failure state** from structured navigation outcomes; retry the same contract request, open the canonical source without its fragment, and copy the stable citation reference.
- [ ] **Step 3: Keep the Inspector mutually exclusive** with the main conversation and Composer, and ensure narrow layouts use the existing full-width surface without horizontal overflow.
- [ ] **Step 4: Re-run the component tests** and verify the Composer and Chat/Agent mode controls remain available after closing review.

### Task 6: Verification And Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-17-controlled-performance-and-evidence-navigation-design.md` only if verification facts need updating
- Test commands only; no release or Git mutation

- [ ] **Step 1: Run the focused Citation, Evidence, Markdown, navigation, PDF adapter, and AI Chat tests.**
- [ ] **Step 2: Run `npm run qa:agent-smoke -- --unit-only`, `npm run typecheck`, and `npm run test:docs`.**
- [ ] **Step 3: Run `npm run qa:gate` and record exact failures if existing dirty-tree work prevents a clean gate.**
- [ ] **Step 4:** Run the available browser diagnostics for desktop and narrow layouts, repeated PDF citations, delayed text, quote-not-found, and cross-root navigation; report horizontal overflow and duplicate source rows from observed output.

## Plan Self-Review

- Contract coverage: source identity, passage location, quote normalization, strict links, route outcomes, pending/deferred PDF state, failure recovery, and compact review UI each have a task.
- Safety coverage: no model/provider/permission changes, no direct writes, no automatic annotations, no shell/network/MCP/autonomous coding, and no Git mutation.
- Identity coverage: Citation `stableId`, `sourceGroupId`, and React keys are deterministic and independent of array indexes.

# Zotero-Grade PDF Reading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lattice's existing desktop-first PDF reader resolve text, selections, annotations, links, and citations from one source-aware page text kernel with stable normalized geometry.

**Architecture:** Extract the existing PDFium normalization and geometry logic into a reusable page-kernel adapter, then make the pointer interaction produce one immutable canonical selection. Persist the existing quote/index/rect target and project every overlay from normalized page coordinates. Keep PDF item child-file and sidecar behavior unchanged.

**Tech Stack:** Next.js, React, TypeScript, Tauri, PDFium native commands, PDF.js, react-pdf-highlighter, Vitest, Testing Library, Playwright/Browser diagnostics.

**Execution boundary:** Work in the current user-modified worktree. Do not create branches, commits, pushes, deployments, or release artifacts.

---

### Task 1: Source-Aware Native Page Kernel

**Files:**
- Create: `src/lib/pdf-native-text-model.ts`
- Create: `src/lib/__tests__/pdf-native-text-model.test.ts`
- Modify: `src/lib/pdf-selection-reconciler.ts`
- Modify: `src/lib/pdf-text-kernel.ts`
- Test: `src/lib/__tests__/pdf-selection-reconciler.test.ts`
- Test: `src/lib/__tests__/pdf-text-kernel.test.ts`

- [ ] **Step 1: Write failing native-model tests**

Add tests that demand one reusable API:

```ts
const model = buildPdfNativeNormalizedModel(layout);
expect(model.normalizedText).toBe("alpha beta");
expect(model.chars.map((char) => [char.normalizedStart, char.normalizedEnd])).toEqual([
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [6, 7], [7, 8], [8, 9], [9, 10],
]);
expect(model.chars[5].sourceChar.charIndex).toBe(6);
```

Cover UTF-16 ligatures, whitespace gaps, zero-area characters, and page-normalized rectangles.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm run test:run -- "src/lib/__tests__/pdf-native-text-model.test.ts"
```

Expected: FAIL because `pdf-native-text-model` does not exist.

- [ ] **Step 3: Implement the native normalized model**

Export these exact contracts:

```ts
export interface PdfNativeNormalizedChar {
  normalizedStart: number;
  normalizedEnd: number;
  sourceChar: PdfNativeTextChar;
}

export interface PdfNativeNormalizedModel {
  normalizedText: string;
  chars: PdfNativeNormalizedChar[];
}

export function buildPdfNativeNormalizedModel(
  layout: PdfNativePageTextLayout,
): PdfNativeNormalizedModel;
```

Move the existing private normalization behavior out of `pdf-selection-reconciler.ts` without changing its output. Add a kernel adapter that returns `PdfTextKernelPage` with source `pdfium` and normalized 0-1 char geometry.

- [ ] **Step 4: Verify GREEN and regression safety**

Run:

```powershell
npm run test:run -- "src/lib/__tests__/pdf-native-text-model.test.ts" "src/lib/__tests__/pdf-text-kernel.test.ts" "src/lib/__tests__/pdf-selection-reconciler.test.ts"
```

Expected: all selected tests pass.

### Task 2: Deterministic Pointer Gesture State

**Files:**
- Create: `src/lib/pdf-selection-gesture.ts`
- Create: `src/lib/__tests__/pdf-selection-gesture.test.ts`
- Modify: `src/components/renderers/pdf-highlighter-adapter.tsx`
- Test: `src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`

- [ ] **Step 1: Write failing gesture tests**

Demand a pure state transition API:

```ts
let gesture = beginPdfSelectionGesture({ token: 4, pageNumber: 2, point: { x: 10, y: 10 } });
gesture = updatePdfSelectionGesture(gesture, { x: 14, y: 10 });
expect(gesture.kind).toBe("text_drag");
expect(shouldSuppressPdfLinkClick(gesture)).toBe(true);
```

Also test a 2-pixel click, pointer cancellation, token mismatch, and dragging across a native annotation link.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm run test:run -- "src/lib/__tests__/pdf-selection-gesture.test.ts"
```

Expected: FAIL because the gesture module does not exist.

- [ ] **Step 3: Implement the minimal gesture state machine**

Use these stable gesture kinds:

```ts
export type PdfSelectionGestureKind = "pointer_candidate" | "text_drag" | "cancelled";
```

Keep the three-pixel threshold in one exported constant. Store no DOM nodes in the pure state. Update the adapter refs from ad hoc start/end plus boolean suppression to this tokenized state.

- [ ] **Step 4: Add adapter event-order regressions**

Add tests that prove:

- one pointerup schedules one finalization for a token;
- a drag across a link does not navigate;
- a click below threshold still navigates;
- a late `selectionchange` cannot replace a frozen geometry-trusted selection;
- cancellation clears snapshot, pending settle, and link suppression together.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
npm run test:run -- "src/lib/__tests__/pdf-selection-gesture.test.ts" "src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx"
```

Expected: all selected tests pass.

### Task 3: Canonical One-Shot Selection Resolution

**Files:**
- Create: `src/lib/pdf-selection-resolution.ts`
- Create: `src/lib/__tests__/pdf-selection-resolution.test.ts`
- Modify: `src/lib/pdf-selection-reconciler.ts`
- Modify: `src/components/renderers/pdf-highlighter-adapter.tsx`
- Test: `src/lib/__tests__/pdf-canonical-text-anchoring.test.ts`
- Test: `src/lib/__tests__/pdf-selection-reconciler.test.ts`

- [ ] **Step 1: Write failing candidate-arbitration tests**

Define input candidates with source, page, text, normalized offsets, rects, pointer agreement, and confidence. Verify that a complete geometry-matching PDFium candidate wins over unrelated DOM text, while a PDFium candidate from another column is rejected rather than spliced with DOM offsets.

```ts
const result = choosePdfSelectionCandidate({ candidates, pointerIntent });
expect(result?.source).toBe("pdfium-native");
expect(result?.textQuote.exact).toBe("selected left-column sentence");
```

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm run test:run -- "src/lib/__tests__/pdf-selection-resolution.test.ts"
```

Expected: FAIL because the one-shot resolution module does not exist.

- [ ] **Step 3: Implement immutable candidate selection**

Create one pure function that scores complete candidates and returns one unchanged candidate. It may trim a candidate only through canonical offsets from the same model. It must never combine text from one candidate with rects from another.

- [ ] **Step 4: Integrate once at pointerup**

Refactor `finalizePdfSelectionFromSnapshot` so source candidates are collected, passed to the pure chooser once, normalized once, then handed to persistence or the transient menu. Preserve the current duplicate-token guard and current annotation creation API.

- [ ] **Step 5: Verify GREEN on layout regressions**

Run:

```powershell
npm run test:run -- "src/lib/__tests__/pdf-selection-resolution.test.ts" "src/lib/__tests__/pdf-selection-reconciler.test.ts" "src/lib/__tests__/pdf-canonical-text-anchoring.test.ts" "src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx"
```

Expected: fragmented spans, Saffman two-column, Rydberg drift, ligature, superscript, repeated phrase, and zero-native-text cases all pass.

### Task 4: Persistent Anchor Recovery And Overlay Projection

**Files:**
- Modify: `src/lib/pdf-canonical-text-anchoring.ts`
- Modify: `src/lib/pdf-text-kernel.ts`
- Modify: `src/components/renderers/pdf-highlighter-adapter.tsx`
- Test: `src/lib/__tests__/pdf-canonical-text-anchoring.test.ts`
- Test: `src/lib/__tests__/pdf-text-kernel.test.ts`
- Test: `src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`

- [ ] **Step 1: Write failing recovery-order tests**

Test duplicate exact quotes disambiguated by prefix/suffix, stale offsets corrected by quote, damaged quote recovered by context, quote failure recovered by geometry, and precise stored geometry left unchanged.

- [ ] **Step 2: Verify RED**

Run the two library test files and confirm each new assertion fails for its missing behavior rather than setup errors.

- [ ] **Step 3: Implement one recovery result contract**

Return the resolved offsets, normalized page rects, source, confidence, and reason from one recovery function. Callers may render the result but may not mutate persistence unless the user explicitly edits the annotation.

- [ ] **Step 4: Make all text overlays project from normalized page rects**

Keep client rectangles only in transient selection state. Stored annotation, repaired annotation, search ring, citation flash, and inferred-link projection must use page-local normalized geometry and current page dimensions.

- [ ] **Step 5: Verify GREEN across reopen and scale scenarios**

Run:

```powershell
npm run test:run -- "src/lib/__tests__/pdf-canonical-text-anchoring.test.ts" "src/lib/__tests__/pdf-text-kernel.test.ts" "src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx"
```

Expected: all selected tests pass.

### Task 5: Link And Citation Precision

**Files:**
- Modify: `src/lib/pdf-link-navigation.ts`
- Modify: `src/lib/pdf-reference-preview.ts`
- Modify: `src/components/renderers/pdf-highlighter-adapter.tsx`
- Modify: `src/components/renderers/pdf-highlighter-adapter.css`
- Test: `src/lib/__tests__/pdf-link-navigation.test.ts`
- Test: `src/lib/__tests__/pdf-reference-preview.test.ts`
- Test: `src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx`

- [ ] **Step 1: Write failing parsing and geometry tests**

Cover split-span DOI and arXiv identifiers, trailing punctuation, named and explicit destinations, `[1]`, `[1,2]`, `[1-3]`, superscript references, `ref. 77`, and `refs. 29,44,45,47`. Assert hotspot rectangles cover only canonical character runs.

- [ ] **Step 2: Verify RED**

Run the two library test files and confirm failures for the new formats or geometry expectations.

- [ ] **Step 3: Implement exact normalized hotspots**

Generate link and citation matches from normalized text offsets, resolve them to kernel character rects, and render separate per-line hotspots. Keep native annotation-layer links first in hit testing.

- [ ] **Step 4: Integrate gesture-safe navigation and preview**

Allow navigation only for pointer candidates below the drag threshold. Preserve popup hover when moving from citation to popup. Warm target pages before navigation and flash exact reference rects after layout.

- [ ] **Step 5: Verify GREEN**

Run:

```powershell
npm run test:run -- "src/lib/__tests__/pdf-link-navigation.test.ts" "src/lib/__tests__/pdf-reference-preview.test.ts" "src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx"
```

Expected: all selected tests pass.

### Task 6: Performance, PDF Item Regression, And Product QA

**Files:**
- Modify only files proven necessary by profiling or failing tests.
- Test: `src/components/renderers/__tests__/pdf-item-workspace-panel.test.tsx`
- Test: `src/lib/__tests__/pdf-item.test.ts`

- [ ] **Step 1: Add performance assertions around page-model work**

Assert that opening search does not call every page extractor, pointermove performs no extraction, repeated requests reuse one page promise, and stale tokens cannot update selection or citation state.

- [ ] **Step 2: Run PDF tests in bounded batches**

Use batches instead of the previously timed-out all-PDF invocation:

```powershell
npm run test:run -- "src/lib/__tests__/pdf-native-text-model.test.ts" "src/lib/__tests__/pdf-page-text-cache.test.ts" "src/lib/__tests__/pdf-text-kernel.test.ts"
npm run test:run -- "src/lib/__tests__/pdf-selection-gesture.test.ts" "src/lib/__tests__/pdf-selection-resolution.test.ts" "src/lib/__tests__/pdf-selection-session.test.ts" "src/lib/__tests__/pdf-selection-reconciler.test.ts"
npm run test:run -- "src/lib/__tests__/pdf-canonical-text-anchoring.test.ts" "src/lib/__tests__/pdf-link-navigation.test.ts" "src/lib/__tests__/pdf-reference-preview.test.ts"
npm run test:run -- "src/components/renderers/__tests__/pdf-highlighter-adapter.test.tsx" "src/components/renderers/__tests__/pdf-item-workspace-panel.test.tsx" "src/lib/__tests__/pdf-item.test.ts"
```

- [ ] **Step 3: Run type and release-quality gates**

```powershell
npm run typecheck
npm run qa:gate
```

Expected: exit code 0 for each command. Deterministic failures are blockers; existing documented warnings are recorded separately.

- [ ] **Step 4: Validate rendered behavior**

Use the available in-app Browser path for the web reader and the existing PDF diagnostics bridge for Tauri-specific native selection. Verify one-drag text selection, persisted highlight after zoom/reopen, native and inferred links, citation preview/jump/flash, no console errors, and no full-document extraction on open.

- [ ] **Step 5: Verify PDF item child-file compatibility**

Open a PDF item workspace, create or update a note/annotation, navigate between the PDF and its child files, and confirm the parent PDF association and existing item files remain intact.


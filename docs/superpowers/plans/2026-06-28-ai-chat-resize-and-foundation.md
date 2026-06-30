# AI Chat Resize And Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for implementation. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create git commits unless the user explicitly asks for them.

**Goal:** Make the AI Chat dock reliably resizable in the real desktop workbench and raise the AI context foundation to a dependable local-file-aware assistant baseline.

**Architecture:** Treat resize as a shell-level interaction, not a component-only visual tweak. The resizable handle must survive PDF canvas overlays, nested panels, pointer-event interception, zero-size measurements, and controlled layout persistence. AI Chat must always know the active workspace file, selected text, extracted PDF text, and annotations before sending requests.

**Tech Stack:** React 19, Next.js 16, Tauri 2, Zustand stores, Vitest/JSDOM, existing Lattice `ResizablePanelGroup`, `AppLayout`, `AiChatPanel`, and settings stores.

---

## Root-Cause Notes

- The real AI dock path is `AppLayout` -> `ResizablePanelGroup` -> `ResizableHandle` -> `resolveDesktopWorkbenchResize()` -> `setDesktopAiPanelSize()` -> `persistAiPanelSize()`.
- Prior isolated tests only proved the handle can resize when the test manually sets `parentElement.offsetWidth = 1000`.
- In the product, drag can fail if:
  - pointer movement is intercepted by PDF/canvas/editor surfaces before the portal drag shield receives events;
  - the handle's parent container reports `offsetWidth` or `offsetHeight` as `0`;
  - the user drags from a nearby visual line but misses the actual hit target;
  - AI dock min/max constraints make movement look clamped;
  - controlled sizes update but persistence does not run.

## Task 1: Resize Drag Must Work From Window-Level Movement

**Files:**
- Modify: `src/components/ui/__tests__/resizable.test.tsx`
- Modify: `src/components/ui/resizable.tsx`

- [x] **Step 1: Write the failing test**

Add a test that starts drag on the AI dock handle, then fires `pointerMove` and `pointerUp` on `window`, not on the portal shield.

Expected behavior:

```ts
fireEvent.pointerDown(aiHandle, { clientX: 720, pointerId: 1 });
fireEvent.pointerMove(window, { clientX: 640, pointerId: 1 });
fireEvent.pointerUp(window, { pointerId: 1 });
expect(onSizesChange).toHaveBeenLastCalledWith([20, 44, 36]);
```

- [x] **Step 2: Run red test**

Run:

```bash
npm run test:run -- "src/components/ui/__tests__/resizable.test.tsx"
```

Expected: the new window-level drag test fails because current movement only relies on the portal shield.

- [x] **Step 3: Implement native window drag fallback**

In `ResizableHandle`, when drag begins:

- attach native `window` listeners for `pointermove`, `pointerup`, `pointercancel`, `mousemove`, and `mouseup`;
- call the same `updateDragPosition()` and `endDrag()` logic as the shield;
- remove listeners on drag end and unmount;
- keep the portal shield for cursor/hit experience, but do not rely on it as the only event source.

- [x] **Step 4: Run green test**

Run:

```bash
npm run test:run -- "src/components/ui/__tests__/resizable.test.tsx"
```

Expected: all resizable tests pass.

## Task 2: Resize Must Not Die On Zero Offset Size

**Files:**
- Modify: `src/components/ui/__tests__/resizable.test.tsx`
- Modify: `src/components/ui/resizable.tsx`

- [x] **Step 1: Write the failing test**

Add a test where `offsetWidth` is `0`, but `getBoundingClientRect().width` is `1000`.

Expected behavior:

```ts
Object.defineProperty(aiHandle.parentElement, "offsetWidth", { configurable: true, value: 0 });
aiHandle.parentElement!.getBoundingClientRect = () => ({
  width: 1000,
  height: 600,
  x: 0,
  y: 0,
  top: 0,
  left: 0,
  bottom: 600,
  right: 1000,
  toJSON: () => {},
});
```

Then the same drag should resize AI from `28` to `36`.

- [x] **Step 2: Run red test**

Run:

```bash
npm run test:run -- "src/components/ui/__tests__/resizable.test.tsx"
```

Expected: test fails if `beginDrag()` aborts on `offsetWidth <= 0`.

- [x] **Step 3: Implement measurement fallback**

Add a small helper in `resizable.tsx`:

```ts
function getElementSize(element: HTMLElement, direction: "horizontal" | "vertical") {
  const offsetSize = direction === "horizontal" ? element.offsetWidth : element.offsetHeight;
  if (offsetSize > 0) return offsetSize;
  const rect = element.getBoundingClientRect();
  const rectSize = direction === "horizontal" ? rect.width : rect.height;
  if (rectSize > 0) return rectSize;
  return direction === "horizontal" ? window.innerWidth : window.innerHeight;
}
```

- [x] **Step 4: Run green test**

Run:

```bash
npm run test:run -- "src/components/ui/__tests__/resizable.test.tsx"
```

Expected: all resizable tests pass.

## Task 3: Real Desktop AI Dock Layout Regression

**Files:**
- Modify: `src/components/layout/__tests__/desktop-workbench-layout.test.ts`
- Optionally create: `src/components/layout/__tests__/app-layout-ai-dock.test.tsx`

- [x] **Step 1: Strengthen layout helper tests**

Cover all four shell states:

- sidebar open, plugin closed, AI open;
- sidebar open, plugin open, AI open;
- sidebar collapsed, plugin closed, AI open;
- sidebar collapsed, plugin open, AI open.

Each state must assert:

- AI handle index matches the panel before AI;
- `resolveDesktopWorkbenchResize()` maps changed sizes back to `aiPanelSize`;
- AI size is clamped but still moves across the practical range.

- [ ] **Step 2: Add AppLayout-level smoke if existing mocks permit**

Render `AppLayout` with desktop viewport, settings initialized with `aiPanelOpen: true`, then drag the AI separator using `window.pointerMove`.

Expected: `updateSetting("aiPanelWidth", next)` is eventually called.

## Task 4: AI Chat Context Foundation

**Files:**
- Modify: `src/components/ai/ai-chat-panel.tsx`
- Modify: `src/components/ai/__tests__/ai-chat-panel.test.tsx`
- Inspect: `src/lib/prompt/executor.ts`
- Inspect: `src/stores/workspace-store.ts`
- Inspect: `src/stores/file-content-store.ts`

- [x] **Step 1: Verify current file context before every Chat request**

Test that regular Chat includes:

- active tab file path;
- active markdown/text file content;
- selected text if present;
- PDF extracted text if active file is PDF;
- PDF annotations if present.

- [x] **Step 2: Preserve context on model/provider errors**

The assistant error message must keep `promptContext` and `evidenceRefs` so users can see what Lattice tried to send.

- [ ] **Step 3: Make missing context explicit**

If active file content is unavailable, AI Chat should state which context was unavailable and why, rather than hallucinating or saying only "upload/paste content".

## Task 5: AI Interaction Baseline

**Files:**
- Inspect: `src/components/ai/ai-chat-panel.tsx`
- Inspect: `src/components/diagnostics/ai-chat-research-agent-diagnostics.tsx`
- Inspect: `src/stores/ai-chat-store.ts`
- Modify tests in nearest relevant files.

- [x] **Step 1: Current-file awareness**

AI response flow must expose current file path and context status in metadata.

- [x] **Step 2: Evidence-driven answers**

Generated answers should prefer evidence references from current file/PDF/annotations when available.

- [ ] **Step 3: Agent mode readiness**

Agent mode must not pretend it can edit/read files if the tool layer is missing. It should show clear capability status and degrade gracefully.

## Task 6: Verification And Desktop Sync

**Files:**
- Release output: `releases/v2.3.1`

- [x] **Step 1: Focused tests**

Run:

```bash
npm run test:run -- "src/components/ui/__tests__/resizable.test.tsx" "src/components/layout/__tests__/desktop-workbench-layout.test.ts" "src/components/ai/__tests__/ai-chat-panel.test.tsx"
```

- [ ] **Step 2: Quality gates**

Run:

```bash
npm run typecheck
npm run test:docs
npm run lint -- --quiet
npm run build
```

- [ ] **Step 3: Desktop build and release refresh**

Run only after tests pass:

```bash
npm run tauri:build
npm run release:prepare -- --version 2.3.1 --artifacts-dir src-tauri/target/release
```

- [ ] **Step 4: Report artifacts**

Report `releases/v2.3.1/checksums.txt` and changed files.

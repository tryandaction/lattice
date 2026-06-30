# Quantum Keyboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not create git commits unless the user explicitly asks for them.

**Goal:** Redesign Quantum Keyboard into a 26-letter physical-key formula input method with Shift/Ctrl layers, stable positioning, and editable key mappings in Settings.

**Architecture:** Introduce an explicit layer-based keymap model while preserving compatibility helpers during migration. Keep input logic in pure functions, HUD rendering in focused components, persistence in a store, and settings editing in a dedicated settings subcomponent. Avoid broad editor rewrites; only touch Markdown/MathLive entry points needed to prevent double-Tab indentation and to insert formulas reliably.

**Tech Stack:** React 19, Next.js 16, Zustand, Vitest/JSDOM, existing Lattice HUD, MathLive integration, CodeMirror/Tiptap Markdown editor hooks.

---

## Task 1: Layered Quantum Keymap Model

**Files:**
- Modify: `src/config/quantum-keymap.ts`
- Modify: `src/config/__tests__/quantum-keymap.test.ts`
- Create: `src/config/quantum-keyboard-official-map.ts` if the file grows too large.

- [x] **Step 1: Write failing tests**

Add tests:

```ts
expect(getQuantumLayerMeanings("KeyI", "base").map((m) => m.label)).toEqual([
  "integral",
  "double integral",
  "triple integral",
  "contour integral",
  "bounded integral",
]);
expect(getQuantumLayerMeanings("KeyI", "ctrl").map((m) => m.label)).toEqual([
  "current I",
  "identity",
  "indicator",
  "inertia I",
]);
expect(getQuantumMeaning("KeyI", "base", 3)?.latex).toBe("\\iiint");
expect(getQuantumMeaning("KeyI", "ctrl", 1)?.latex).toBe("I");
```

Run:

```bash
npm run test:run -- "src/config/__tests__/quantum-keymap.test.ts"
```

Expected: fail because the layer APIs do not exist yet.

- [x] **Step 2: Implement model and official map**

Add:

```ts
export type QuantumLayerId = "base" | "ctrl";

export interface QuantumKeyMeaning {
  id: string;
  label: string;
  latex: string;
  mathlive?: string;
  markdown?: string;
  category: QuantumKeyCategory;
  keywords: string[];
  displayMode?: boolean;
  templateKind?: "symbol" | "structure" | "matrix" | "bracket" | "operator";
}

export interface QuantumKeyDefinition {
  keyCode: string;
  letter: string;
  base: QuantumKeyMeaning[];
  ctrl: QuantumKeyMeaning[];
}
```

Add all 26 key definitions following `docs/superpowers/specs/2026-06-28-quantum-keyboard-official-design.md`.

- [x] **Step 3: Preserve compatibility helpers**

Make existing helpers delegate to the new map:

- `getCandidateSymbols(keyCode)` returns base layer latex list;
- `getCandidateSymbol(keyCode, oneBasedIndex)` returns base layer item;
- `getCandidateLabel(keyCode, oneBasedIndex)` returns base layer label;
- `getDisplaySymbol(keyCode, isShiftHeld)` returns base item 2 when Shift is held, otherwise base item 1.

- [x] **Step 4: Run tests**

Run:

```bash
npm run test:run -- "src/config/__tests__/quantum-keymap.test.ts"
```

Expected: pass.

## Task 2: Pure Input Engine

**Files:**
- Modify: `src/components/hud/hud-logic.ts`
- Modify: `src/components/hud/__tests__/hud-logic.test.ts`

- [x] **Step 1: Write failing tests**

Add tests:

```ts
expect(resolveQuantumKeyboardInput({
  keyCode: "KeyI",
  shiftKey: true,
  ctrlKey: false,
  candidatePrefix: 2,
})).toMatchObject({ action: "insert", latex: "\\iint" });

expect(resolveQuantumKeyboardInput({
  keyCode: "KeyI",
  shiftKey: false,
  ctrlKey: true,
  candidatePrefix: 1,
})).toMatchObject({ action: "insert", latex: "I" });
```

Run:

```bash
npm run test:run -- "src/components/hud/__tests__/hud-logic.test.ts"
```

Expected: fail because `resolveQuantumKeyboardInput` does not exist.

- [x] **Step 2: Implement input resolver**

Add:

```ts
export interface QuantumInputState {
  keyCode: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  candidatePrefix: number | null;
}
```

Rules:

- Ctrl chooses `ctrl` layer.
- Shift chooses `base` layer and enables number prefix selection.
- No modifier chooses base layer item 1.
- Number prefix is one-based and clamped.

- [x] **Step 3: Run tests**

Run:

```bash
npm run test:run -- "src/components/hud/__tests__/hud-logic.test.ts"
```

Expected: pass.

## Task 3: Minimal 26-Key HUD UI

**Files:**
- Modify: `src/components/hud/keyboard-hud.tsx`
- Modify: `src/app/globals.css`
- Modify: nearest HUD component tests or create `src/components/hud/__tests__/keyboard-hud-layout.test.tsx`

- [x] **Step 1: Write failing layout test**

Assert:

- exactly 26 key buttons are rendered;
- no visible `Quantum` brand pill exists;
- the top hint contains `Shift/Ctrl`;
- key I contains the labels `integral`, `double integral`, `triple integral`;
- key labels are in a `.quantum-letter-physical` element.

- [x] **Step 2: Implement visual layout**

In `keyboard-hud.tsx`:

- replace `quantum-brand` with a short hint;
- remove `1:` prefixes from key meanings;
- render meanings from current layer;
- render physical letter top-right.

In `globals.css`:

- make keys wider;
- top-right physical letter;
- left-to-right meaning chips/text;
- restrained layer accents for Ctrl/Shift.

- [x] **Step 3: Run HUD tests**

Run:

```bash
npm run test:run -- "src/components/hud/__tests__/hud-logic.test.ts" "src/config/__tests__/quantum-keymap.test.ts"
```

## Task 4: Stable Positioning

**Files:**
- Modify: `src/components/hud/keyboard-hud.tsx`
- Modify: HUD store if position logic lives there.
- Modify: `src/stores/hud-store.ts`
- Add/modify tests near HUD positioning logic.

- [x] **Step 1: Write failing positioning tests**

Expected rules:

- default opens bottom when focus point is in top half;
- default opens top when focus point is in bottom half;
- user custom offset disables automatic chasing;
- stored position is clamped to viewport.

- [x] **Step 2: Replace smart chasing**

Remove periodic cursor-follow repositioning from HUD open state. Keep only:

- initial top/bottom placement;
- viewport clamp;
- user drag persistence;
- reset position.

## Task 5: Settings Mapping Editor

**Files:**
- Modify: `src/components/settings/settings-dialog.tsx`
- Create: `src/components/settings/quantum-keyboard-editor.tsx`
- Create: `src/components/settings/__tests__/quantum-keyboard-editor.test.tsx`
- Modify: `src/stores/quantum-custom-store.ts` or create `src/stores/quantum-keymap-store.ts`

- [x] **Step 1: Write store tests**

Tests:

- updates KeyI base item 2 label/latex;
- updates KeyI ctrl item 1 label/latex;
- reset key restores official defaults;
- reset all restores every key;
- validation rejects empty latex.

- [x] **Step 2: Implement persistent editable mapping store**

Use Zustand persist with `createSafeJSONStorage`.

- [x] **Step 3: Write editor component tests**

Tests:

- settings shortcuts tab shows `Quantum Keyboard`;
- selecting key I shows base and ctrl layer editors;
- editing a LaTeX input updates the store;
- reset key restores official map.

- [x] **Step 4: Implement editor UI**

Use compact rows, inputs, select/toggles, add/remove/reorder buttons, and preview.

## Task 6: Double-Tab And Toolbar Entry

**Files:**
- Inspect/modify: `src/components/editor/codemirror/live-preview/keyboard-shortcuts.ts`
- Inspect/modify: Markdown toolbar component with overflow menu.
- Modify/add tests near keyboard shortcuts.

- [ ] **Step 1: Write double-Tab regression test**

Assert double-Tab opens Quantum Keyboard and does not insert tab indentation into Markdown.

- [ ] **Step 2: Add toolbar command**

Add a distinct Quantum Keyboard command in the Markdown toolbar overflow menu.

## Task 7: Verification And Desktop Sync

**Files:**
- Release output: `releases/v2.3.1`

- [x] **Step 1: Focused tests**

Run:

```bash
npm run test:run -- "src/config/__tests__/quantum-keymap.test.ts" "src/components/hud/__tests__/hud-logic.test.ts" "src/stores/__tests__/quantum-formula-library-store.test.ts"
```

- [ ] **Step 2: Quality gates**

Run:

```bash
npm run typecheck
npm run test:docs
npm run lint -- --quiet
npm run build
```

- [ ] **Step 3: Desktop build**

Run:

```bash
npm run tauri:build
npm run release:prepare -- --version 2.3.1 --artifacts-dir src-tauri/target/release
```

- [ ] **Step 4: Report release artifacts**

Report changed files and checksums.

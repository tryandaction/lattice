# Explorer File Operations Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. This repository must be updated inline on `main`; do not create a branch, commit, or push.

**Goal:** Make Explorer create, delete, rename, and drag-move operations respond immediately without recursively rescanning the workspace, including moves into PDF item workspaces.

**Architecture:** Add pure immutable file-tree transformations and one functional workspace-store update action. Filesystem operations update the latest tree immediately after the authoritative disk command succeeds; full refresh remains only for initial load, manual refresh, and recovery.

**Tech Stack:** React 19, TypeScript, Zustand 5, File System Access API-compatible desktop handles, Tauri 2, Vitest 4, Testing Library.

---

### Task 1: Lock The Performance Contract With Failing Tests

**Files:**
- Modify: `src/hooks/__tests__/use-file-system.test.ts`
- Create: `src/lib/__tests__/file-tree-operations.test.ts`

- [ ] Add fake handle write/delete support and operation counters.
- [ ] Add create, empty-directory, delete, and move tests that expect immediate tree changes and zero root `values()` calls.
- [ ] Add pure helper tests for sorted insert, remove, descendant path rewrite, and hidden-target move.
- [ ] Run `npm test -- --run src/hooks/__tests__/use-file-system.test.ts src/lib/__tests__/file-tree-operations.test.ts` and verify failure is caused by missing incremental behavior.

### Task 2: Add Pure Immutable Tree Operations

**Files:**
- Create: `src/lib/file-tree-operations.ts`
- Test: `src/lib/__tests__/file-tree-operations.test.ts`

- [ ] Implement path-prefix rewriting that updates directory descendants and PDF `parentPdfPath` metadata without mutating existing nodes.
- [ ] Implement sorted insertion into a directory path.
- [ ] Implement removal that returns both the new root and removed node.
- [ ] Implement relocation with a visible target and source-only removal for hidden PDF item targets.
- [ ] Run the pure helper tests and verify they pass.

### Task 3: Add A Functional Store Update Boundary

**Files:**
- Modify: `src/stores/workspace-store.ts`

- [ ] Extend `WorkspaceState` with `updateFileTree(updater)`.
- [ ] Implement the action with Zustand functional `set` so every mutation receives the latest `FileTree`.
- [ ] Keep `setFileTree` for initial load and full refresh.
- [ ] Run workspace-store and file-tree tests.

### Task 4: Replace Full Refreshes In Core Operations

**Files:**
- Modify: `src/hooks/use-file-system.ts`
- Test: `src/hooks/__tests__/use-file-system.test.ts`

- [ ] Construct new file/directory nodes from successful operation handles.
- [ ] Replace refresh-after-create with a sorted insert.
- [ ] Replace refresh-after-delete with a removal.
- [ ] Replace refresh-after-rename with an atomic relocation in the same parent.
- [ ] Replace refresh-after-copy with an insert while retaining the source.
- [ ] Replace refresh-after-move with an atomic source removal and target insert.
- [ ] Trigger a silent recovery refresh only if the expected node or parent is missing.
- [ ] Run hook tests and verify zero root rescans.

### Task 5: Harden Drag And PDF Target Behavior

**Files:**
- Modify: `src/components/explorer/tree-node.tsx`
- Modify: `src/components/explorer/__tests__/tree-view.test.tsx`
- Modify: `src/hooks/use-file-system.ts`

- [ ] Publish both the custom Explorer MIME payload and a text fallback during drag start.
- [ ] Parse either payload so WebView2 drag sessions remain usable.
- [ ] Show a pending state on the active drop target and a toast on failure.
- [ ] For PDF drops, remove the source from the visible tree and hydrate only the target PDF virtual children.
- [ ] Verify self-drop and descendant-drop never call a filesystem move.

### Task 6: Verification And Local Release

**Files:**
- Update generated artifacts only under `releases/` through repository scripts.

- [ ] Run focused Explorer, hook, file-operation, PDF-item, and Workbench tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run qa:gate`.
- [ ] Run `node scripts/prepare-release.mjs --skip-qa` only after the same-phase QA gate passes.
- [ ] Inspect the resulting desktop release metadata and installer paths; do not commit or push.


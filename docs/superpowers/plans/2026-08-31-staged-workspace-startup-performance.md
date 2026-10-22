# 分阶段工作区启动性能优化实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** 让工作区先显示根目录并立即可用，再按需加载子目录、历史标签和后台索引，避免大工作区与大量 PDF 批注阻塞首屏。

**Architecture:** 保留现有完整递归读取作为显式刷新和兼容路径，新增单层目录读取器与目录加载状态；工作区打开只 await 身份、轻量 UI 状态和根层读取，PDF/AI/Markdown 索引进入可取消后台任务；会话恢复先提交活动标签，再以批次补齐其余标签。

**Tech Stack:** Next.js 16、React、TypeScript、Zustand、File System Access API、Vitest、Testing Library、Tauri 2。

**Spec:** `docs/superpowers/specs/2026-08-31-staged-workspace-startup-performance.md`

## Global Constraints

- 不升级 npm/Rust 依赖。
- 不改变 PDF 批注数据格式和文件路径契约。
- 不部署 Web，不上传 GitHub，不执行 Git commit/push。
- 不移除现有完整刷新能力；手动刷新仍可显式执行递归扫描。
- 根目录可用前不得等待深层目录、PDF Item 迁移或 AI/Markdown 全量索引。

---

### Task 1: 单层目录读取与节点状态

**Files:**
- Modify: `src/types/file-system.ts`
- Modify: `src/hooks/use-file-system.ts`
- Modify: `src/components/explorer/tree-node.tsx`
- Test: `src/hooks/__tests__/use-file-system.test.ts`
- Test: `src/components/explorer/__tests__/tree-view.test.tsx`

**Interfaces:**
- Produces `readDirectoryChildren(handle, directoryPath, rootHandle, expandedPaths): Promise<TreeNode[]>`.
- Produces `DirectoryNode.childrenState?: "idle" | "loading" | "ready" | "error"`.
- Produces `useFileSystem().ensureDirectoryExpanded(path): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Add tests asserting that `readDirectoryChildren` returns only direct entries, marks child directories `childrenState: "idle"`, and `ensureDirectoryExpanded` de-duplicates concurrent loads.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm run test:run -- src/hooks/__tests__/use-file-system.test.ts src/components/explorer/__tests__/tree-view.test.tsx`

Expected: FAIL because the single-level reader and expansion action do not exist.

- [ ] **Step 3: Implement the minimal reader and state transitions**

Extract direct-entry construction from `readDirectoryRecursive`; add `childrenState` to directory nodes; add a path-keyed in-flight map and generation token in `use-file-system`; set loading before reading, ready with children on success, error on failure, and ignore stale results.

- [ ] **Step 4: Wire directory click behavior**

Update `DirectoryNodeComponent` so collapsed idle directories call `ensureDirectoryExpanded(node.path)`, ready directories toggle locally, and loading/error states expose a spinner/retry affordance without blocking sibling nodes.

- [ ] **Step 5: Run tests to verify pass**

Run the same command and expect all targeted tests to pass.

### Task 2: Root-first workspace opening

**Files:**
- Modify: `src/hooks/use-file-system.ts`
- Modify: `src/stores/workspace-store.ts`
- Test: `src/hooks/__tests__/use-file-system.test.ts`
- Test: `src/stores/__tests__/workspace-store-root.test.ts`

**Interfaces:**
- Consumes `readDirectoryChildren` and `ensureDirectoryExpanded` from Task 1.
- Preserves `applyWorkspaceHandleToStores(handle, workspaceRootPath, preferredWorkspaceKey, options)` signature.

- [ ] **Step 1: Write the failing test**

Add a fake directory tree with nested descendants and assert that applying a workspace reads the root entries without reading nested directory values before the root tree is published.

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test:run -- src/hooks/__tests__/use-file-system.test.ts src/stores/__tests__/workspace-store-root.test.ts`

Expected: FAIL because `applyWorkspaceHandleToStores` currently calls the recursive reader and awaits migration work.

- [ ] **Step 3: Implement root-first sequencing**

Replace only the initial tree read with `readDirectoryChildren`; publish root handle, identity, path, and root tree immediately after that read; move `migrateLegacyPdfItemWorkspaces`, PDF manifest registration, desktop preview persistence, and workspace-history persistence into guarded background tasks.

- [ ] **Step 4: Add background cancellation**

Use a workspace generation token shared by `setRootHandle` and the background tasks. A task may mutate indexes or persistence only when its generation still matches the active workspace handle.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run test:run -- src/hooks/__tests__/use-file-system.test.ts src/stores/__tests__/workspace-store-root.test.ts && npm run typecheck`

Expected: PASS with no TypeScript errors.

### Task 3: Staged history restoration

**Files:**
- Modify: `src/lib/layout-persistence.ts`
- Modify: `src/hooks/use-workbench-session.ts`
- Modify: `src/stores/workspace-store.ts`
- Test: `src/lib/__tests__/layout-persistence.test.ts`
- Test: `src/hooks/__tests__/use-workbench-session.test.ts`

**Interfaces:**
- Produces `loadWorkbenchSession(..., options?: { signal?: AbortSignal; onProgress?: (layout: LayoutState) => void }): Promise<...>`.
- Preserves existing no-options behavior for current callers and tests.

- [ ] **Step 1: Write the failing test**

Add a session fixture with four tabs and assert `onProgress` receives a layout containing the active tab before all background tabs finish, then receives the complete valid layout; assert an aborted signal stops later progress.

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test:run -- src/lib/__tests__/layout-persistence.test.ts src/hooks/__tests__/use-workbench-session.test.ts`

Expected: FAIL because session loading currently awaits every tab before returning and has no progress callback.

- [ ] **Step 3: Implement staged deserialization**

Deserialize pane structure first, resolve active tab synchronously within the first batch, call `onProgress` with a structurally valid layout, then resolve remaining tabs in batches of two with a main-thread yield between batches; skip missing files and preserve active index normalization.

- [ ] **Step 4: Guard against workspace switches**

Create an `AbortController` per `useWorkbenchSession` hydration; abort the previous controller on workspace key change/unmount and ignore progress from stale sessions.

- [ ] **Step 5: Run tests and typecheck**

Run: `npm run test:run -- src/lib/__tests__/layout-persistence.test.ts src/hooks/__tests__/use-workbench-session.test.ts && npm run typecheck`

Expected: PASS.

### Task 4: Performance instrumentation and regression coverage

**Files:**
- Create: `src/lib/workspace-startup-performance.ts`
- Modify: `src/hooks/use-file-system.ts`
- Modify: `src/hooks/use-workbench-session.ts`
- Test: `src/lib/__tests__/workspace-startup-performance.test.ts`
- Test: `src/hooks/__tests__/use-file-system.test.ts`

**Interfaces:**
- Produces `markWorkspaceStartup(stage: WorkspaceStartupStage): void` and `getWorkspaceStartupSnapshot(): Readonly<Record<WorkspaceStartupStage, number | null>>`.

- [ ] **Step 1: Write the failing test**

Assert startup stages are monotonic, reset per workspace generation, and do not serialize file content or paths.

- [ ] **Step 2: Run test to verify failure**

Run: `npm run test:run -- src/lib/__tests__/workspace-startup-performance.test.ts`

Expected: FAIL because the instrumentation module does not exist.

- [ ] **Step 3: Implement bounded instrumentation**

Store only `performance.now()` timestamps in module memory; expose a read-only snapshot for diagnostics and emit `performance.mark` when available. Do not log user paths or file contents.

- [ ] **Step 4: Wire stage marks**

Mark `workspace-open-start`, `root-tree-ready`, `first-file-ready`, and `background-index-complete` at the corresponding boundaries.

- [ ] **Step 5: Run targeted tests**

Run: `npm run test:run -- src/lib/__tests__/workspace-startup-performance.test.ts src/hooks/__tests__/use-file-system.test.ts src/lib/__tests__/layout-persistence.test.ts && npm run typecheck`

Expected: PASS.

### Task 5: Browser and release verification

**Files:**
- Modify only if verification exposes a regression: files from Tasks 1-4.

- [ ] **Step 1: Run focused tests and static checks**

Run: `npm run lint -- --quiet`, `npm run test:docs`, and all Task 1-4 test commands.

- [ ] **Step 2: Run browser startup flow**

Start `npm run dev`; verify `/` renders the first meaningful screen, open the performance baseline page, test desktop and `390x844`, and assert no horizontal overflow or console errors.

- [ ] **Step 3: Run full quality gate**

Run: `npm run qa:gate`.

Expected: lint, typecheck, docs, full tests, Web build, and Tauri build pass. If installer packaging is blocked by environment networking, separately run `npm run tauri:build -- --no-bundle` and report the boundary.

- [ ] **Step 4: Refresh local desktop release**

After a passing gate or verified no-bundle build, run `node scripts/prepare-release.mjs --version 2.3.2 --artifacts-dir src-tauri/target/release --output-dir releases/v2.3.2` and verify every artifact hash matches `release-manifest.json`.

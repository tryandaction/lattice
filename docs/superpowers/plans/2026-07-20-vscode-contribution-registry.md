# VS Code Contribution Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render real extension-contributed VS Code View Containers in the Lattice sidebar and expose truthful activation diagnostics without embedding Code OSS.

**Architecture:** Preserve container metadata through the isolated host, add an explicit lazy `activate-view` protocol, merge manifest contributions with host runtime truth in a pure registry, and render only registry-backed extension tools. Existing TreeView/WebviewView resolvers remain the content layer.

**Tech Stack:** React 19, TypeScript, Zustand, Vitest, Testing Library, Tauri 2, Rust, isolated Node extension host.

## Execution Status

- Tasks 1-4: completed on 2026-07-20, including the multi-container built-in view regression.
- Task 5: completed on 2026-07-20; full QA passed and the verified artifacts were copied to `releases/v2.3.1`.

---

### Task 1: Preserve Host View Container Metadata

**Files:**
- Modify: `src/lib/vscode-extension-host/types.ts`
- Modify: `src/stores/vscode-extension-host-store.ts`
- Modify: `src-tauri/src/main.rs`
- Test: `src/stores/__tests__/vscode-extension-host-store.test.ts`
- Test: Rust tests in `src-tauri/src/main.rs`

- [x] Add a failing store assertion that `viewItems` sent to the desktop host retain `container: "publisher.demo"`.
- [x] Add a failing Rust script assertion that `resolveViewMeta()` and `registerHostView()` preserve `container` in the serialized snapshot.
- [x] Extend `VSCodeHostView` with `container?: string` and include the field in the host `resolveViewMeta()`/registry entry.
- [x] Run `npx vitest run "src/stores/__tests__/vscode-extension-host-store.test.ts" --maxWorkers=1` and `cargo test --manifest-path "src-tauri/Cargo.toml" vscode_extension_host -- --nocapture`.

### Task 2: Add Lazy View Activation Protocol

**Files:**
- Modify: `src/lib/vscode-extension-host/desktop.ts`
- Modify: `src/lib/vscode-extension-host/types.ts`
- Modify: `src/stores/vscode-extension-host-store.ts`
- Modify: `src-tauri/src/main.rs`
- Test: `src/lib/vscode-extension-host/__tests__/desktop.test.ts`
- Test: `src/stores/__tests__/vscode-extension-host-store.test.ts`

- [x] Add failing adapter/store tests for `activateVSCodeExtensionHostView(viewId)` and `activateView(viewId)` returning a refreshed snapshot.
- [x] Add host request handling for `{ type: "activate-view", viewId }`; activate the owner with `onView:<id>` and return `buildSnapshot()` without resolving content.
- [x] Add Tauri command `desktop_activate_vscode_extension_view`, its request/response bridge, and generated handler registration.
- [x] Update the Zustand store snapshot after activation and propagate exact activation errors.
- [x] Run the desktop adapter, store, and Rust host tests and verify all pass.

### Task 3: Build The Pure Contribution Registry

**Files:**
- Create: `src/lib/vscode-extension-host/contribution-registry.ts`
- Create: `src/lib/vscode-extension-host/__tests__/contribution-registry.test.ts`
- Reuse: `src/lib/vscode-compat/extensions.ts`

- [x] Write failing tests for: manifest container ordering; host kind merge; built-in container attachment; command-only suppression; failed/missing-API diagnostics; duplicate id diagnostics.
- [x] Implement `buildVSCodeContributionRegistry(extensions, snapshot)` by reusing `getVSCodeActivityEntries()` and indexing host views/extensions by id.
- [x] Return only runnable custom View Containers in `containers`; return all failed/skipped/runtime issues in `diagnostics`.
- [x] Run `npx vitest run "src/lib/vscode-extension-host/__tests__/contribution-registry.test.ts" --maxWorkers=1` and verify the registry contract.

### Task 4: Render Dynamic Extension Tools

**Files:**
- Modify: `src/components/vscode-compat/vscode-activity-panel.tsx`
- Modify: `src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx`
- Modify: `src/lib/i18n/en-US.ts`
- Modify: `src/lib/i18n/zh-CN.ts`

- [x] Add failing component tests that a manifest View Container appears as a tool, command-only extensions do not, and selecting a container activates then resolves a TreeView/WebviewView.
- [x] Add failing component tests that failed and skipped extensions expose `error` and `missingApi` in Extensions diagnostics.
- [x] Replace the fixed six-column grid with a stable horizontally scrollable tool strip containing built-ins plus registry containers.
- [x] Add an `ExtensionContainerPanel` that activates unresolved manifest views, reads the refreshed kind, and delegates to the existing tree/webview renderers.
- [x] Attach manifest views targeting `explorer`, `scm`, and `debug` to the corresponding built-in panels without duplicating activity buttons.
- [x] Keep inventory/reimport/command functionality in Extensions and Commands.
- [x] Run the focused activity panel and registry tests until green.

### Task 5: Verify And Refresh Local Release

**Files:**
- Update: `docs/superpowers/specs/2026-07-20-vscode-contribution-registry-design.md` only if implementation truth differs.
- Refresh: `releases/v2.3.1/`

- [x] Run all VS Code compatibility, extension host, layout, Explorer, and code editor focused tests.
- [x] Run `npm run typecheck` and `cargo check --manifest-path "src-tauri/Cargo.toml"`.
- [x] Run `npm run qa:gate` and require exit code 0.
- [x] Run `node scripts/prepare-release.mjs --skip-qa --artifacts-dir "C:/lb/Lattice/src-tauri/target/release"` using the same-phase gate artifacts.
- [x] Independently compare installer/executable size and SHA-256 with `release-manifest.json`.
- [x] Do not create a branch, commit, stage, or push; the user explicitly requested direct main-worktree iteration without Git publication operations.

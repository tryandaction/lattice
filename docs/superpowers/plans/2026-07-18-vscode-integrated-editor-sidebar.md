# VS Code Integrated Editor Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the full-page VS Code Workbench default path with a persistent Lattice editor plus a VS Code-compatible left tools and extension sidebar.

**Architecture:** The existing activity-view layout owns sidebar visibility. Normal file tabs own all code and notebook content. `useVSCodeExtensionHostStore` supplies commands, TreeViews, and WebviewViews to a new lazy sidebar component; the Code OSS web workbench is no longer part of normal navigation.

**Tech Stack:** React 19, Next.js, TypeScript, Zustand, CodeMirror 6, Tauri 2, Vitest, Testing Library.

---

### Task 1: Correct File Routing

**Files:**
- Modify: `src/lib/vscode-workbench/file-routing.ts`
- Modify: `src/lib/vscode-workbench/__tests__/file-routing.test.ts`
- Modify: `src/stores/workspace-store.ts`
- Modify: `src/stores/__tests__/workspace-store-execution.test.ts`

- [ ] Change routing tests so every supported code, text, configuration, TeX, and notebook file resolves to `"lattice"`.
- [ ] Run `npm test -- src/lib/vscode-workbench/__tests__/file-routing.test.ts src/stores/__tests__/workspace-store-execution.test.ts` and verify the assertions fail because the current implementation returns or creates `"vscode"`.
- [ ] Make `openFileInPane()` always create normal supported file tabs; retain explicit unsupported handling and remove the automatic Workbench branch.
- [ ] Keep `openFileInVSCodePane()` out of normal routing so legacy callers cannot affect default file opening.
- [ ] Re-run the focused tests and verify supported code and notebook files produce ordinary file tabs.

### Task 2: Implement The VS Code Activity Sidebar

**Files:**
- Create: `src/components/vscode-compat/vscode-activity-panel.tsx`
- Create: `src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx`
- Modify: `src/components/layout/app-layout.tsx`
- Modify: `src/types/settings.ts`
- Modify: `src/stores/settings-store.ts`
- Add or modify layout tests under `src/components/layout/__tests__/`

- [ ] Write component tests that assert the panel renders built-in Explorer, Search, Source Control, Run and Debug, Extensions, and Commands navigation without creating a main-area Workbench tab.
- [ ] Write layout/state tests that persist and restore `activityView: "vscode"` and that a second click collapses the existing sidebar.
- [ ] Run the focused tests and verify they fail because no VS Code side panel exists and normalization drops the state.
- [ ] Add a lazily loaded `VSCodeActivityPanel` branch to `renderDesktopSidePanel()`.
- [ ] Change the rail button to select/collapse `activityView="vscode"`; remove `openVSCodeWorkbench` and `vscodeWorkbenchActive` from the button path.
- [ ] Allow settings normalization and initialization to restore `"vscode"`.
- [ ] Remove native-workbench-specific layout hiding so Lattice sidebar, plugin panel, and AI panel remain independently usable.
- [ ] Re-run the focused tests and verify the sidebar interaction is green.

### Task 3: Render Imported Extension Tools

**Files:**
- Modify: `src/components/vscode-compat/vscode-activity-panel.tsx`
- Modify: `src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx`
- Reuse: `src/components/vscode-compat/vscode-webview-frame.tsx`
- Reuse: `src/stores/vscode-extension-host-store.ts`

- [ ] Add failing tests for lazy host synchronization, host-registered view selection, TreeView rendering, WebviewView rendering, command execution, loading state, and visible errors.
- [ ] Verify the tests fail before implementation.
- [ ] On panel visibility, call `syncWithCompat()` with the imported extensions, settings, and current workspace only when compatibility is enabled.
- [ ] Group host views by extension/container label and expose them in compact sidebar navigation.
- [ ] Resolve TreeViews only when selected; render nested items and execute item commands through `runCommand()`.
- [ ] Resolve WebviewViews only when selected; render `VSCodeWebviewFrame` and forward messages through `postViewMessage()`.
- [ ] Preserve resolved WebviewView sessions only when their options request `retainContextWhenHidden`.
- [ ] Merge active host commands with manifest commands, deduplicate by command id, and expose a searchable command list.
- [ ] Re-run component and store tests until all extension contribution behavior passes.

### Task 4: Integrate Tasks, Launch Configurations, Extensions, And Editor Context

**Files:**
- Modify: `src/components/vscode-compat/vscode-activity-panel.tsx`
- Modify: `src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx`
- Modify as needed: `src/components/renderers/code-editor-viewer.tsx`
- Modify as needed: `src/components/renderers/__tests__/code-editor-viewer.test.tsx`

- [ ] Add failing tests that imported tasks and launch configurations appear under Run and Debug, imported extensions appear with truthful host status, and opening a code file notifies a ready extension host.
- [ ] Verify the tests fail only for missing sidebar behavior.
- [ ] Reuse the existing execution/task adapters to run supported tasks and launch configurations without introducing a second runner.
- [ ] Render imported extensions with active, failed, skipped, or pending state plus exact missing API/error information.
- [ ] Preserve the existing `CodeEditorViewer` settings, snippets, keybindings, language service, run dock, problems, references, and extension-host document activation behavior.
- [ ] Re-run focused tests and verify editing remains usable even when the host is unavailable or failed.

### Task 5: Remove The Full Workbench User Path

**Files:**
- Modify: `src/components/main-area/pane-wrapper.tsx`
- Modify: `src/components/main-area/__tests__/pane-wrapper.test.tsx`
- Modify: `src/components/explorer/tree-node.tsx`
- Modify: `src/components/explorer/__tests__/tree-view.test.tsx`
- Modify: `src/stores/workspace-store.ts`
- Modify: `src/types/layout.ts`
- Modify: `src/lib/layout-persistence.ts`
- Modify: `src/lib/__tests__/layout-persistence.test.ts`
- Modify translations in `src/lib/i18n/en-US.ts` and `src/lib/i18n/zh-CN.ts`

- [ ] Add failing tests that PaneWrapper never renders `NativeVSCodeWorkbenchPane`, legacy persisted Workbench tabs are discarded or migrated, and Explorer no longer offers an action that replaces the main pane with Workbench.
- [ ] Verify the tests fail against the current Workbench branch and context action.
- [ ] Remove the native Workbench render branch and user-facing context action.
- [ ] Migrate persisted `vscode-workbench` tabs out of restored layouts so an upgraded installation cannot reopen the broken page.
- [ ] Keep any runtime implementation files isolated and unreferenced by normal UI until a separately approved diagnostic feature requires them.
- [ ] Re-run all layout, Explorer, and workspace-store tests.

### Task 6: Verification And Local Release

**Files:**
- Update release documentation only if behavior or packaging notes changed.
- Refresh: `releases/<current-version>/`

- [ ] Run the complete focused VS Code suite, editor tests, Explorer tests, and layout tests.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run qa:gate` and require a successful exit.
- [ ] Build and verify the Tauri desktop application.
- [ ] Run `node scripts/prepare-release.mjs --skip-qa` only after the same-phase QA gate passes.
- [ ] Verify installer and executable sizes plus SHA-256 hashes in the current versioned release folder.
- [ ] Do not create a branch, commit, or push; the user will install the refreshed local desktop package.


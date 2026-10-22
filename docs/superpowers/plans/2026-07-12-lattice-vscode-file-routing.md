# Lattice and VS Code Intelligent File Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route document/media files to Lattice and code/notebook/LaTeX/tooling files to one persistent real VS Code Workbench controlled from the Lattice Explorer.

**Architecture:** Add a pure routing policy and a transient singleton `vscode-workbench` tab. A bundled workspace extension, loaded through VS Code's startup payload, exposes a token-protected loopback bridge that opens files through stable VS Code APIs without navigating or remounting the Workbench WebView. After the real path passes acceptance, remove the old simulated Workbench surface and constrained extension-host implementation.

**Tech Stack:** TypeScript, React 19, Zustand, Vitest, Tauri 2, Rust/Tokio/Reqwest, Node.js VS Code extension API, Playwright.

**Execution constraint:** Do not create branches, commits, or pushes. Do not install the generated application. Refresh only the local `releases/v2.3.1` artifacts after the full gate passes.

---

## File Structure

### New files

- `src/lib/vscode-workbench/file-routing.ts`: pure file-surface policy.
- `src/lib/vscode-workbench/__tests__/file-routing.test.ts`: routing matrix.
- `src/lib/vscode-workbench/layout.ts`: singleton Workbench tab placement.
- `src/lib/vscode-workbench/__tests__/layout.test.ts`: global singleton behavior.
- `src/stores/vscode-workbench-store.ts`: latest pending resource and bridge dispatch state.
- `src/stores/__tests__/vscode-workbench-store.test.ts`: coalescing and acknowledgement behavior.
- `src/components/vscode-compat/vscode-workbench-pane.tsx`: dedicated startup/ready/error surface around one native WebView.
- `src/components/vscode-compat/__tests__/vscode-workbench-pane.test.tsx`: lifecycle and fallback UI.
- `src-tauri/resources/vscode-lattice-bridge/package.json`: bundled workspace extension manifest.
- `src-tauri/resources/vscode-lattice-bridge/extension.cjs`: activation entry point.
- `src-tauri/resources/vscode-lattice-bridge/server.cjs`: allowlisted loopback HTTP bridge.
- `src/lib/vscode-workbench/__tests__/bridge-resource.test.ts`: executable bridge-resource tests with a mocked stable VS Code API boundary.

### Modified files

- `src/lib/file-utils.ts`: expose text/binary facts used by routing.
- `src/types/layout.ts`: add `VSCodeWorkbenchTabState` and correct type guards.
- `src/lib/layout-utils.ts`: add pure singleton-tab placement/removal helpers.
- `src/lib/layout-persistence.ts`: exclude the transient Workbench tab from persistence.
- `src/stores/workspace-store.ts`: add high-level routed open action and singleton activation.
- `src/components/explorer/tree-node.tsx`: call routed open action for normal and side opens.
- `src/components/explorer/explorer-sidebar.tsx`: route newly-created/opened files through the same action.
- `src/components/main-area/pane-wrapper.tsx`: render the dedicated Workbench tab before file content loading.
- `src/components/main-area/tab.tsx`: render Workbench tab identity without treating it as a web tab.
- `src/components/renderers/desktop-native-webview-pane.tsx`: support `browser` and `workbench` chrome modes without URL-driven remounting.
- `src/components/vscode-compat/vscode-activity-panel.tsx`: focus the singleton tab instead of opening a generic web URL tab.
- `src/lib/vscode-workbench/desktop.ts`: add bridge fields and open-resource command.
- `src-tauri/src/vscode_workbench.rs`: manage bridge environment, health, path validation, and dispatch.
- `src-tauri/src/main.rs`: register the new command, resolve resources, then remove the old constrained extension-host runtime.
- `src-tauri/tauri.conf.json`: package the bridge extension resources.
- `src/components/layout/app-layout.tsx`: stop starting the old constrained host.
- `src/components/settings/settings-dialog.tsx`: report real Workbench compatibility rather than old-host status.
- `src/components/ui/plugin-command-dialog.tsx`: remove old-host command injection; VS Code commands stay inside the real Workbench.
- `src/components/main-area/universal-file-viewer.tsx`, `src/components/renderers/code-editor-viewer.tsx`, `src/components/notebook/notebook-editor.tsx`, `src/components/renderers/jupyter-renderer.tsx`: remove simulated Workbench wrappers after routing takes ownership.
- `CHANGELOG.md`, `docs/RELEASE_NOTES.md`, `docs/DESKTOP_FEATURES.md`: document final behavior and validation.

### Removed after replacement passes

- `src/components/vscode-compat/vscode-workbench-surface.tsx`
- `src/components/vscode-compat/vscode-webview-frame.tsx`
- `src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx`
- `src/lib/vscode-extension-host/command-adapter.ts`
- `src/lib/vscode-extension-host/desktop.ts`
- `src/lib/vscode-extension-host/types.ts`
- `src/lib/vscode-extension-host/webview-document.ts`
- `src/lib/vscode-extension-host/webview-html.ts`
- `src/lib/vscode-extension-host/__tests__/desktop.test.ts`
- `src/lib/vscode-extension-host/__tests__/webview-document.test.ts`
- `src/lib/vscode-extension-host/__tests__/webview-html.test.ts`
- `src/stores/vscode-extension-host-store.ts`
- `src/stores/__tests__/vscode-extension-host-store.test.ts`

---

### Task 1: Pure File-Surface Routing

**Files:**
- Create: `src/lib/vscode-workbench/file-routing.ts`
- Create: `src/lib/vscode-workbench/__tests__/file-routing.test.ts`
- Modify: `src/lib/file-utils.ts`
- Modify: `src/lib/vscode-compat/language.ts`

- [ ] **Step 1: Write the failing routing matrix**

Cover `.pdf`, `.md`, `.docx`, `.pptx`, images, `.py`, `.rs`, `.ts`, `.ipynb`, `.tex`, `.bib`, `.json`, `.yaml`, `.toml`, `Dockerfile`, `Makefile`, imported language associations, unknown text, unknown binary, disabled integration, and browser-only mode.

```ts
expect(resolveWorkspaceFileSurface({ fileName: "paper.pdf", vscodeEnabled: true, desktopAvailable: true })).toBe("lattice");
expect(resolveWorkspaceFileSurface({ fileName: "analysis.ipynb", vscodeEnabled: true, desktopAvailable: true })).toBe("vscode");
expect(resolveWorkspaceFileSurface({ fileName: "main.tex", vscodeEnabled: true, desktopAvailable: true })).toBe("vscode");
expect(resolveWorkspaceFileSurface({ fileName: "script.py", vscodeEnabled: false, desktopAvailable: true })).toBe("lattice");
expect(resolveWorkspaceFileSurface({ fileName: "custom.foo", vscodeEnabled: true, desktopAvailable: true, importedLanguageId: "foo" })).toBe("vscode");
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm exec vitest -- run "src/lib/vscode-workbench/__tests__/file-routing.test.ts"
```

Expected: FAIL because `resolveWorkspaceFileSurface` does not exist.

- [ ] **Step 3: Implement the minimal pure policy**

```ts
export type WorkspaceFileSurface = "lattice" | "vscode" | "unsupported";

export interface WorkspaceFileRoutingInput {
  fileName: string;
  vscodeEnabled: boolean;
  desktopAvailable: boolean;
  importedLanguageId?: string | null;
}

export function resolveWorkspaceFileSurface(input: WorkspaceFileRoutingInput): WorkspaceFileSurface {
  const extension = getFileExtension(input.fileName);
  if (LATTICE_DOCUMENT_EXTENSIONS.has(extension) || isImageFile(extension)) return "lattice";
  if (!input.vscodeEnabled || !input.desktopAvailable) {
    return isTextFile(extension) || getRendererForExtension(extension) !== "unsupported" ? "lattice" : "unsupported";
  }
  if (VSCODE_FILE_NAMES.has(input.fileName.toLowerCase())) return "vscode";
  if (VSCODE_EXTENSIONS.has(extension) || isCodeFile(extension) || input.importedLanguageId) return "vscode";
  if (isTextFile(extension)) return "vscode";
  return getRendererForExtension(extension) === "unsupported" ? "unsupported" : "lattice";
}
```

Export `resolveVSCodeLanguageIdForFile(fileName: string): string | null` from `src/lib/vscode-compat/language.ts`. It reuses the existing `matchesPattern` loop and returns the imported VS Code language ID before CodeMirror mapping. Update `resolveCodeEditorLanguageForFile` to call that helper so association matching remains DRY.

- [ ] **Step 4: Run focused tests and verify GREEN**

Expected: routing matrix passes with no warnings.

---

### Task 2: Global Singleton Workbench Tab

**Files:**
- Create: `src/lib/vscode-workbench/layout.ts`
- Create: `src/lib/vscode-workbench/__tests__/layout.test.ts`
- Modify: `src/types/layout.ts`
- Modify: `src/lib/layout-utils.ts`
- Modify: `src/lib/layout-persistence.ts`

- [ ] **Step 1: Write failing type/layout tests**

```ts
const first = placeVSCodeWorkbenchTab(root, "pane-left", "C:/workspace");
const second = placeVSCodeWorkbenchTab(first.root, "pane-right", "C:/workspace");
expect(findVSCodeWorkbenchTabs(second.root)).toHaveLength(1);
expect(second.paneId).toBe("pane-right");
expect(second.tab.id).toBe(first.tab.id);
```

Also assert `isFileTabState(workbenchTab) === false`, `isWebTabState(workbenchTab) === false`, and session persistence omits the transient Workbench tab.

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because the new tab kind and placement helper do not exist.

- [ ] **Step 3: Add the tab type and strict guards**

```ts
export interface VSCodeWorkbenchTabState extends BaseTabState {
  kind: "vscode-workbench";
  workspacePath: string;
}

export type TabState = FileTabState | WebTabState | VSCodeWorkbenchTabState;

export function isFileTabState(tab: TabState): tab is FileTabState {
  return tab.kind === undefined || tab.kind === "file";
}

export function isVSCodeWorkbenchTabState(tab: TabState): tab is VSCodeWorkbenchTabState {
  return tab.kind === "vscode-workbench";
}
```

- [ ] **Step 4: Implement pure singleton placement**

`placeVSCodeWorkbenchTab` removes any existing Workbench tab from all panes, preserves its ID, inserts it into the requested pane, and makes it active. It returns `{ root, paneId, tab }` and never changes unrelated file/web tabs.

- [ ] **Step 5: Exclude transient Workbench tabs from persistence**

Filter `isVSCodeWorkbenchTabState` before serialization. Restoration never recreates an authenticated/stale runtime tab.

- [ ] **Step 6: Run layout and persistence tests and verify GREEN**

Run:

```powershell
npm exec vitest -- run "src/lib/vscode-workbench/__tests__/layout.test.ts" "src/lib/__tests__/layout-persistence.test.ts"
```

---

### Task 3: Bundled Real VS Code Bridge Extension

**Files:**
- Create: `src-tauri/resources/vscode-lattice-bridge/package.json`
- Create: `src-tauri/resources/vscode-lattice-bridge/extension.cjs`
- Create: `src-tauri/resources/vscode-lattice-bridge/server.cjs`
- Create: `src/lib/vscode-workbench/__tests__/bridge-resource.test.ts`
- Modify: `src-tauri/tauri.conf.json`

- [ ] **Step 1: Write failing bridge-resource tests**

Load `server.cjs` through `createRequire`. Assert health token rejection, oversized body rejection, traversal rejection, text opening with selection, notebook opening, and rejection of every action except `focusWorkbench` and `closePrimarySidebar`.

```ts
expect(await request("GET", "/health", null, "wrong")).toMatchObject({ status: 401 });
expect(vscode.workspace.openTextDocument).toHaveBeenCalledWith(Uri.file("C:/workspace/src/main.ts"));
expect(vscode.window.showNotebookDocument).toHaveBeenCalled();
```

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because the bridge resource does not exist.

- [ ] **Step 3: Add the extension manifest**

```json
{
  "name": "lattice-workbench-bridge",
  "displayName": "Lattice Workbench Bridge",
  "publisher": "lattice",
  "version": "1.0.0",
  "engines": { "vscode": "^1.90.0" },
  "main": "./extension.cjs",
  "extensionKind": ["workspace"],
  "activationEvents": ["onStartupFinished"]
}
```

- [ ] **Step 4: Implement the allowlisted HTTP server**

`createBridgeServer(vscode, { host, port, token, workspacePath, maxBodyBytes })` binds to `127.0.0.1`, compares bearer tokens with `timingSafeEqual`, canonicalizes paths, validates workspace containment case-insensitively on Windows, and implements only `/health`, `/open`, and `/action`.

For text:

```js
const document = await vscode.workspace.openTextDocument(vscode.Uri.file(resourcePath));
const selection = new vscode.Range(line, column, line, column);
await vscode.window.showTextDocument(document, { preview: false, selection });
```

For notebooks:

```js
const document = await vscode.workspace.openNotebookDocument(vscode.Uri.file(resourcePath));
await vscode.window.showNotebookDocument(document, { preview: false });
```

`/action` accepts only `{ action: "focusWorkbench" }` and `{ action: "closePrimarySidebar" }`. The first calls `vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup")`; the second calls `vscode.commands.executeCommand("workbench.action.closeSidebar")`. Any other action returns HTTP 400 without invoking a command.

- [ ] **Step 5: Activate from inherited environment**

`extension.cjs` reads `LATTICE_VSCODE_BRIDGE_PORT`, `LATTICE_VSCODE_BRIDGE_TOKEN`, and `LATTICE_VSCODE_WORKSPACE`; missing values leave the extension inert. `deactivate` closes the server.

- [ ] **Step 6: Package the resource and verify GREEN**

Add `resources/vscode-lattice-bridge/**/*` to Tauri resources. Run the bridge tests and `npm run typecheck`.

---

### Task 4: Tauri Bridge Lifecycle and Secure Dispatch

**Files:**
- Modify: `src-tauri/src/vscode_workbench.rs`
- Modify: `src-tauri/src/main.rs`
- Test: Rust tests in `src-tauri/src/vscode_workbench.rs`

- [ ] **Step 1: Write failing Rust tests**

Add tests for:

- Workbench URL payload includes an encoded `extensionDevelopmentPath` array entry.
- spawned environment contains bridge port/token/workspace.
- canonical resource validation accepts files inside the active workspace and rejects siblings/traversal.
- open request serializes `kind`, `path`, optional `line`, and `column`.
- action request serializes only the `focusWorkbench` and `closePrimarySidebar` enum values.
- ready Workbench with unavailable bridge reports `connectingBridge`, not `ready`.

- [ ] **Step 2: Run Rust tests and verify RED**

```powershell
cargo test vscode_workbench --manifest-path "src-tauri/Cargo.toml"
```

- [ ] **Step 3: Extend managed state and snapshot**

```rust
struct ManagedVSCodeWorkbench {
    child: Child,
    workspace_path: String,
    url: String,
    cli_path: String,
    bridge_port: u16,
    bridge_token: String,
    bridge_url: String,
    // existing timing/cache fields remain
}
```

Add `bridge_status` to the serialized snapshot and the `connectingBridge` startup phase.

- [ ] **Step 4: Resolve packaged extension and build startup payload**

Use `AppHandle.path().resolve("resources/vscode-lattice-bridge", BaseDirectory::Resource)`. Build the URL payload as JSON array pairs:

```json
[["extensionDevelopmentPath","file:///.../vscode-lattice-bridge"],["skipWelcome","true"]]
```

Append it as the encoded `payload` query parameter beside `tkn`.

- [ ] **Step 5: Pass bridge environment to the owned process**

Reserve an independent loopback port and random token, then set the three `LATTICE_VSCODE_*` variables on the `code-tunnel` command before spawn.

- [ ] **Step 6: Add bridge health and dispatch commands**

```rust
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VSCodeWorkbenchOpenRequest {
    path: String,
    kind: String,
    line: Option<u32>,
    column: Option<u32>,
}
```

`desktop_open_vscode_workbench_resource` validates the canonical path against the managed workspace, POSTs to `/open` with bearer token and a 4-second timeout, and returns a typed acknowledgement. `desktop_run_vscode_workbench_action` accepts a Rust enum restricted to `focusWorkbench` and `closePrimarySidebar` and POSTs to `/action`. Status polling checks `/health` after Workbench readiness.

- [ ] **Step 7: Register the command and verify GREEN**

Run Rust tests, `cargo fmt`, and `cargo check`.

---

### Task 5: Frontend Workbench Request Store

**Files:**
- Create: `src/stores/vscode-workbench-store.ts`
- Create: `src/stores/__tests__/vscode-workbench-store.test.ts`
- Modify: `src/lib/vscode-workbench/desktop.ts`

- [ ] **Step 1: Write failing coalescing tests**

```ts
store.queueResource({ path: "C:/workspace/a.ts", kind: "text" });
store.queueResource({ path: "C:/workspace/b.ts", kind: "text" });
expect(store.pendingResource?.path).toBe("C:/workspace/b.ts");
expect(store.pendingResource?.requestId).toBeGreaterThan(1);
```

Assert stale acknowledgements do not clear a newer request and reset clears transport state on workspace change.

- [ ] **Step 2: Run tests and verify RED**

Expected: FAIL because the store does not exist.

- [ ] **Step 3: Add typed desktop bridge command**

```ts
export interface VSCodeWorkbenchResourceRequest {
  requestId: number;
  path: string;
  kind: "text" | "notebook";
  line?: number;
  column?: number;
}

export async function openNativeVSCodeWorkbenchResource(request: VSCodeWorkbenchResourceRequest) {
  return invokeTauriCommand("desktop_open_vscode_workbench_resource", { request }, { timeoutMs: 6_000 });
}
```

- [ ] **Step 4: Implement latest-request-wins state**

The store owns `pendingResource`, `lastAcknowledgedRequestId`, `dispatchingRequestId`, and `lastError`. `acknowledge(id)` clears only when `id` equals the current pending request.

- [ ] **Step 5: Run store and desktop bridge tests and verify GREEN**

---

### Task 6: Routed Explorer Open and Singleton Layout Integration

**Files:**
- Modify: `src/stores/workspace-store.ts`
- Modify: `src/components/explorer/tree-node.tsx`
- Modify: `src/components/explorer/explorer-sidebar.tsx`
- Modify: `src/components/explorer/__tests__/tree-view.test.tsx`
- Create: `src/stores/__tests__/workspace-store-vscode-routing.test.ts`

- [ ] **Step 1: Write failing store and Explorer tests**

Assert PDF and Markdown still call the Lattice file-tab path. Assert `.py`, `.ipynb`, `.tex`, and `.json` create/activate one `vscode-workbench` tab and queue the absolute desktop path. Assert repeated and side opens keep one Workbench tab.

- [ ] **Step 2: Run tests and verify RED**

Expected: Explorer still calls `openFileInPane` directly.

- [ ] **Step 3: Add the high-level action**

```ts
openWorkspaceResourceInPane: (paneId, handle, path) => {
  const surface = resolveWorkspaceFileSurface({
    fileName: handle.name,
    vscodeEnabled: useSettingsStore.getState().settings.vscodeCompatEnabled,
    desktopAvailable: isTauriHost(),
    importedLanguageId: resolveVSCodeLanguageIdForFile(handle.name),
  });
  if (surface !== "vscode") return get().openFileInPane(paneId, handle, path);
  const absolutePath = getDesktopHandlePath(handle);
  if (!absolutePath) return get().openFileInPane(paneId, handle, path);
  // place singleton tab and queue resource
}
```

Use `kind: "notebook"` only for `.ipynb`; all other VS Code-owned files use `text`.

- [ ] **Step 4: Route Explorer normal and side opens**

Replace direct file-open calls in TreeNode and ExplorerSidebar with `openWorkspaceResourceInPane`. Keep low-level `openFileInPane` for internal Lattice-only flows and tests.

- [ ] **Step 5: Run focused tests and verify GREEN**

---

### Task 7: Dedicated Stable Workbench Pane

**Files:**
- Create: `src/components/vscode-compat/vscode-workbench-pane.tsx`
- Create: `src/components/vscode-compat/__tests__/vscode-workbench-pane.test.tsx`
- Modify: `src/components/renderers/desktop-native-webview-pane.tsx`
- Modify: `src/components/main-area/pane-wrapper.tsx`
- Modify: `src/components/main-area/tab.tsx`
- Modify: `src/components/vscode-compat/vscode-activity-panel.tsx`

- [ ] **Step 1: Write failing pane tests**

Assert:

- pending file name appears during startup
- ready state renders one native WebView with `chrome="workbench"`
- URL changes are not used to switch resources
- pending resource is sent once after bridge readiness
- a newer pending request supersedes an older dispatch
- bridge failure exposes Retry and Open with Lattice
- no address bar, back, forward, copy URL, or generic web breadcrumb is rendered

- [ ] **Step 2: Run component tests and verify RED**

- [ ] **Step 3: Add Workbench chrome mode to native WebView pane**

```ts
interface DesktopNativeWebviewPaneProps {
  // existing props
  chrome?: "browser" | "workbench";
  onSnapshot?: (snapshot: DesktopNativeWebviewSnapshot) => void;
}
```

In Workbench mode, do not register browser command-bar actions and do not call `updateWebTab`. Keep bounds, visibility, mount, new-window, download, and state polling behavior shared.

- [ ] **Step 4: Implement `VSCodeWorkbenchPane`**

The component starts/reuses the backend for `workspaceRootPath`, polls until `status === "ready" && bridgeStatus === "ready"`, renders the existing staged overlay until then, mounts the native WebView once, and dispatches the latest pending resource through the store.

On inactive tabs, native WebView visibility changes only. Component identity and label remain stable.

- [ ] **Step 5: Render the new tab before file loading**

In PaneWrapper, branch on `isVSCodeWorkbenchTabState(activeTab)` before the file-content loading path and render `VSCodeWorkbenchPane`. The generic `UniversalFileViewer` never receives a Workbench tab.

- [ ] **Step 6: Update activity and tab UI**

The VS Code activity action calls the workspace store's focus-singleton action. The top Lattice tab uses the stable label `VS Code` with the latest resource name as secondary title; it does not expose `127.0.0.1`.

- [ ] **Step 7: Run focused tests and verify GREEN**

---

### Task 8: Remove Replaced Simulated Workbench and Constrained Host

**Files:**
- Remove the exact files listed under `Removed after replacement passes`.
- Modify: `src/components/layout/app-layout.tsx`
- Modify: `src/components/settings/settings-dialog.tsx`
- Modify: `src/components/ui/plugin-command-dialog.tsx`
- Modify: `src/components/main-area/universal-file-viewer.tsx`
- Modify: `src/components/renderers/code-editor-viewer.tsx`
- Modify: `src/components/notebook/notebook-editor.tsx`
- Modify: `src/components/renderers/jupyter-renderer.tsx`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Run the new-path focused suite before deletion**

The routing, singleton, bridge, backend, store, Explorer, and dedicated-pane tests must all pass. Do not begin deletion while any replacement test fails.

- [ ] **Step 2: Obtain explicit deletion confirmation**

Present the exact file list and the `main.rs` symbol groups below using the repository's dangerous-operation confirmation format. Continue only after explicit confirmation.

- [ ] **Step 3: Remove simulated Surface wrappers**

Remove `VSCodeWorkbenchSurface` imports/JSX from UniversalFileViewer, CodeEditorViewer, NotebookEditor, and JupyterRenderer. These renderers remain valid Lattice fallbacks but no longer pretend to be VS Code.

- [ ] **Step 4: Remove constrained-host consumers**

Remove `useVSCodeExtensionHostStore` startup from AppLayout, old-host status from Settings, and old-host command injection from PluginCommandDialog. Real VS Code commands and extension views stay inside the real Workbench.

- [ ] **Step 5: Remove Rust constrained-host implementation**

Delete these symbol groups from `main.rs`:

- `VSCodeExtensionHost*` request/snapshot/runtime/state structs
- `resolve_vscode_extension_host_runtime`
- `vscode_extension_host_script`
- artifact writing, process management, request, snapshot, start/stop/open/command/view/tree/message functions
- `.manage(VSCodeExtensionHostState::default())`
- all `desktop_*vscode_extension*` invoke registrations
- old constrained-host unit tests

Preserve VS Code profile discovery/import functions and the new `vscode_workbench` module.

- [ ] **Step 6: Delete the obsolete files and verify zero references**

Run:

```powershell
rg -n "VSCodeWorkbenchSurface|vscode-workbench-surface|vscode-extension-host|useVSCodeExtensionHostStore|desktop_start_vscode_extension_host" "src" "src-tauri/src"
```

Expected: no matches outside historical design/release documentation.

- [ ] **Step 7: Run affected tests, typecheck, and Rust tests**

Update tests that asserted the removed simulated surface to assert routing to the real Workbench or clean Lattice fallback instead.

---

### Task 9: Runtime Acceptance, Performance, Documentation, and Release

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `docs/RELEASE_NOTES.md`
- Modify: `docs/DESKTOP_FEATURES.md`
- Refresh: `releases/v2.3.1/*`

- [ ] **Step 1: Run all focused tests**

```powershell
npm exec vitest -- run "src/lib/vscode-workbench" "src/stores/__tests__/vscode-workbench-store.test.ts" "src/stores/__tests__/workspace-store-vscode-routing.test.ts" "src/components/vscode-compat/__tests__/vscode-workbench-pane.test.tsx" "src/components/explorer/__tests__/tree-view.test.tsx"
cargo test --manifest-path "src-tauri/Cargo.toml"
npm run typecheck
```

- [ ] **Step 2: Run real desktop acceptance**

Use the built desktop app and a real workspace. Select `.py`, `.ts`, `.rs`, `.json`, `.ipynb`, and `.tex` from Lattice Explorer. Assert one native WebView label, unchanged Workbench URL, active VS Code editor changes, and no blank intermediate page.

- [ ] **Step 3: Verify state preservation**

Open a VS Code terminal and a compatible code extension, switch to PDF and Markdown in Lattice, then return to code. Confirm terminal process, extension state, notebook kernel UI, and editor tabs remain.

- [ ] **Step 4: Verify rapid-selection performance**

Select at least ten code files rapidly. Confirm only the final request is acknowledged, WebView mount count remains one, and warm open acknowledgement is within 300 ms under normal local load.

- [ ] **Step 5: Update product documentation**

Document the final file matrix, real Extension Host compatibility boundary, singleton behavior, fallback, and measured acceptance results. Remove release claims about the constrained simulated host.

- [ ] **Step 6: Run the complete release gate**

```powershell
npm run qa:gate
```

Expected: lint has zero errors, all tests pass, Next build passes, and Tauri produces MSI and NSIS bundles.

- [ ] **Step 7: Refresh local release artifacts**

```powershell
node "scripts/prepare-release.mjs" --skip-qa --artifacts-dir "src-tauri/target/release"
```

Recompute SHA256 for MSI, NSIS setup, and portable EXE; verify against `checksums.txt` and `release-manifest.json`. Do not install or publish them.

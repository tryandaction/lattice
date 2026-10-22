# VS Code Extension Host Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real desktop VS Code extension host bridge that can load imported VS Code extensions, activate a minimal set of command-capable extensions, and surface runnable extension commands inside Lattice.

**Architecture:** Reuse the existing VS Code import inventory as extension discovery input, then start a desktop-side Node-based extension host process managed by Tauri. The host will load extension `main` entries with a constrained `vscode` shim, register commands over JSON IPC, and the frontend will expose host status plus runnable commands in the VS Code workbench and command palette.

**Tech Stack:** Tauri Rust commands, Node child process IPC over stdio, React/Zustand frontend state, existing `invokeTauriCommand` desktop bridge, Vitest, TypeScript, Rust serde JSON.

---

## File Structure

- Create: `src/lib/vscode-extension-host/types.ts`
  Responsibility: shared frontend TypeScript types for host status, commands, activation results, and snapshots.
- Create: `src/lib/vscode-extension-host/desktop.ts`
  Responsibility: frontend Tauri command wrappers for starting, stopping, querying, and invoking the host.
- Create: `src/stores/vscode-extension-host-store.ts`
  Responsibility: host lifecycle state, command inventory, auto-start behavior after VS Code import, and command invocation.
- Create: `src/lib/vscode-extension-host/command-adapter.ts`
  Responsibility: map host commands into existing UI action shape where needed.
- Modify: `src/components/layout/app-layout.tsx`
  Responsibility: load compat state first, then auto-start or refresh the extension host in desktop sessions.
- Modify: `src/components/settings/settings-dialog.tsx`
  Responsibility: show host availability/status and allow retry/restart after one-click import.
- Modify: `src/components/vscode-compat/vscode-workbench-surface.tsx`
  Responsibility: show extension host status, host-backed commands, and explicit host errors in the VS Code takeover shell.
- Modify: `src/components/ui/plugin-command-dialog.tsx`
  Responsibility: merge VS Code host commands into the global command palette alongside plugin/core commands.
- Modify: `src/lib/vscode-compat/types.ts`
  Responsibility: persist extension runtime entry metadata needed by the host (`main`, `browser`, `activationEvents`, `engines`, `extensionKind`).
- Modify: `src/lib/vscode-compat/storage.ts`
  Responsibility: extract extension runtime entry metadata from imported `package.json`.
- Modify: `src/stores/vscode-compat-store.ts`
  Responsibility: persist the richer extension metadata.
- Modify: `src-tauri/src/main.rs`
  Responsibility: manage the Node extension host process, JSON IPC protocol, host status snapshots, and command invocation endpoints.
- Test: `src/lib/vscode-extension-host/__tests__/desktop.test.ts`
- Test: `src/stores/__tests__/vscode-extension-host-store.test.ts`
- Test: `src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx`
- Test: `src/components/ui/__tests__/plugin-command-dialog.test.tsx`
- Test: `src/lib/vscode-compat/__tests__/storage.test.ts`

## Task 1: Extend Imported Extension Metadata

**Files:**
- Modify: `src/lib/vscode-compat/types.ts`
- Modify: `src/lib/vscode-compat/storage.ts`
- Modify: `src/stores/vscode-compat-store.ts`
- Test: `src/lib/vscode-compat/__tests__/storage.test.ts`

- [ ] **Step 1: Write failing storage tests for runtime metadata**

Add assertions that imported extension inventory entries preserve:

```ts
expect(result.config.extensions).toEqual([
  expect.objectContaining({
    id: "ms-python.python",
    path: expect.stringContaining("ms-python.python"),
    main: "./out/client/extension",
    browser: "./dist/web/extension",
    activationEvents: expect.arrayContaining(["onCommand:python.execInTerminal"]),
    extensionKind: expect.arrayContaining(["workspace"]),
  }),
]);
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `npm run test:run -- src/lib/vscode-compat/__tests__/storage.test.ts`
Expected: FAIL because `main` / `browser` / `activationEvents` / `extensionKind` are not yet present.

- [ ] **Step 3: Add minimal metadata fields to the VS Code types**

Add fields to `VSCodeExtensionInventoryEntry` in `src/lib/vscode-compat/types.ts`:

```ts
main?: string;
browser?: string;
activationEvents?: string[];
extensionKind?: string[];
engines?: Record<string, string>;
```

- [ ] **Step 4: Extract runtime metadata from extension package.json**

In `src/lib/vscode-compat/storage.ts`, preserve runtime-relevant package fields when normalizing the extension entry:

```ts
const activationEvents = Array.isArray(packageJson.activationEvents)
  ? packageJson.activationEvents.filter((value): value is string => typeof value === "string")
  : [];

const extensionKind = Array.isArray(packageJson.extensionKind)
  ? packageJson.extensionKind.filter((value): value is string => typeof value === "string")
  : typeof packageJson.extensionKind === "string"
    ? [packageJson.extensionKind]
    : [];
```

- [ ] **Step 5: Persist the richer extension inventory**

Ensure `src/stores/vscode-compat-store.ts` still round-trips the new extension metadata through local storage without dropping fields.

- [ ] **Step 6: Re-run focused tests**

Run: `npm run test:run -- src/lib/vscode-compat/__tests__/storage.test.ts`
Expected: PASS.

## Task 2: Define the Desktop Extension Host Protocol

**Files:**
- Create: `src/lib/vscode-extension-host/types.ts`
- Create: `src/lib/vscode-extension-host/desktop.ts`
- Test: `src/lib/vscode-extension-host/__tests__/desktop.test.ts`

- [ ] **Step 1: Write failing desktop wrapper tests**

Add tests for wrappers such as:

```ts
await startVSCodeExtensionHost({
  workspaceRootPath: "C:/vault",
  extensions: [{ id: "publisher.demo", path: "C:/ext/demo", main: "./extension.js" }],
});

expect(invokeTauriCommand).toHaveBeenCalledWith(
  "desktop_start_vscode_extension_host",
  expect.objectContaining({
    workspaceRootPath: "C:/vault",
    extensions: expect.any(Array),
  }),
  expect.any(Object),
);
```

- [ ] **Step 2: Run focused test to verify failure**

Run: `npm run test:run -- src/lib/vscode-extension-host/__tests__/desktop.test.ts`
Expected: FAIL because the desktop wrapper module does not exist.

- [ ] **Step 3: Add frontend protocol types**

Create `src/lib/vscode-extension-host/types.ts` with:

```ts
export interface VSCodeHostExtensionInput {
  id: string;
  path: string;
  main?: string;
  browser?: string;
  activationEvents: string[];
  displayName?: string;
}

export interface VSCodeHostCommand {
  id: string;
  title: string;
  extensionId: string;
  category?: string;
  source: "host";
}

export interface VSCodeHostSnapshot {
  status: "idle" | "starting" | "ready" | "error" | "unavailable";
  runtime: "node" | "code-electron-node" | "none";
  commandCount: number;
  activeExtensionCount: number;
  commands: VSCodeHostCommand[];
  lastError: string | null;
}
```

- [ ] **Step 4: Add desktop command wrappers**

Create `src/lib/vscode-extension-host/desktop.ts` wrapping:

```ts
desktop_start_vscode_extension_host
desktop_stop_vscode_extension_host
desktop_get_vscode_extension_host_snapshot
desktop_run_vscode_extension_command
```

- [ ] **Step 5: Re-run focused tests**

Run: `npm run test:run -- src/lib/vscode-extension-host/__tests__/desktop.test.ts`
Expected: PASS.

## Task 3: Implement the Tauri Node Extension Host Manager

**Files:**
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: Add Rust-side host snapshot and process state structs**

Introduce:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct VSCodeExtensionHostSnapshot {
    status: String,
    runtime: String,
    command_count: usize,
    active_extension_count: usize,
    commands: Vec<VSCodeHostCommandSnapshot>,
    last_error: Option<String>,
}
```

- [ ] **Step 2: Add Tauri-managed host state**

Add a managed state similar to `ExecutionSessions`, but single-host:

```rust
#[derive(Default)]
struct VSCodeExtensionHostState {
    process: Mutex<Option<ManagedVSCodeExtensionHost>>,
    snapshot: Mutex<VSCodeExtensionHostSnapshot>,
}
```

- [ ] **Step 3: Add host bootstrap script generator**

Implement a Rust helper that writes a temporary Node script which:

```js
const Module = require("module");
const commandRegistry = new Map();
const extensions = new Map();
// intercept require("vscode")
// expose commands.registerCommand / executeCommand
// load extension main entry
// activate on startup for "*" and on invoke for onCommand:<id>
// communicate over stdin/stdout JSON lines
```

- [ ] **Step 4: Add runtime resolution**

Resolve runtime in order:

```rust
resolve_command_path("node")
resolve_command_path("node.exe")
resolve_vscode_launcher_as_node()
```

`resolve_vscode_launcher_as_node()` should reuse existing VS Code executable discovery and attempt `ELECTRON_RUN_AS_NODE=1` as the fallback runtime mode.

- [ ] **Step 5: Add start/status/stop/run commands**

Expose:

```rust
#[tauri::command]
async fn desktop_start_vscode_extension_host(...)
#[tauri::command]
async fn desktop_stop_vscode_extension_host(...)
#[tauri::command]
async fn desktop_get_vscode_extension_host_snapshot(...)
#[tauri::command]
async fn desktop_run_vscode_extension_command(...)
```

- [ ] **Step 6: Register new Tauri commands**

Add them to `tauri::generate_handler![...]` and `Builder::manage(...)`.

## Task 4: Add the Frontend Host Store and Auto-Start Logic

**Files:**
- Create: `src/stores/vscode-extension-host-store.ts`
- Modify: `src/components/layout/app-layout.tsx`
- Test: `src/stores/__tests__/vscode-extension-host-store.test.ts`

- [ ] **Step 1: Write failing store tests**

Cover:
- desktop sessions auto-start when compat is enabled and extensions with `path` + `main` exist
- unavailable runtime becomes `unavailable`
- host command invocation proxies to desktop bridge

- [ ] **Step 2: Run focused test to verify failure**

Run: `npm run test:run -- src/stores/__tests__/vscode-extension-host-store.test.ts`
Expected: FAIL because the store does not exist.

- [ ] **Step 3: Implement host lifecycle store**

Create Zustand store with:

```ts
snapshot: VSCodeHostSnapshot
startFromCompat(...)
refresh()
stop()
runCommand(commandId)
```

- [ ] **Step 4: Auto-start host after compat load**

In `src/components/layout/app-layout.tsx`:
- load compat state
- if Tauri desktop and compat enabled, call `useVSCodeExtensionHostStore.getState().startFromCompat(...)`

- [ ] **Step 5: Re-run focused tests**

Run: `npm run test:run -- src/stores/__tests__/vscode-extension-host-store.test.ts`
Expected: PASS.

## Task 5: Surface Host Commands in the VS Code Workbench and Command Palette

**Files:**
- Modify: `src/components/vscode-compat/vscode-workbench-surface.tsx`
- Modify: `src/components/ui/plugin-command-dialog.tsx`
- Test: `src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx`
- Test: `src/components/ui/__tests__/plugin-command-dialog.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add assertions for:
- host status pill (`Host ready / 宿主已就绪`)
- host command list in the extensions or run panel
- command palette includes host-backed commands with a VS Code source label

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npm run test:run -- src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx src/components/ui/__tests__/plugin-command-dialog.test.tsx`
Expected: FAIL because host state is not yet surfaced.

- [ ] **Step 3: Add host status UI**

In `src/components/vscode-compat/vscode-workbench-surface.tsx`, show:
- runtime mode
- active extension count
- host command count
- last host error

- [ ] **Step 4: Add runnable host command cards**

Render host commands with:

```ts
{
  id: `vscode-host:${command.id}`,
  label: command.title,
  onClick: () => runCommand(command.id),
}
```

- [ ] **Step 5: Merge host commands into the command palette**

In `src/components/ui/plugin-command-dialog.tsx`, add a command source branch so host commands appear alongside built-in and plugin commands.

- [ ] **Step 6: Re-run focused tests**

Run: `npm run test:run -- src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx src/components/ui/__tests__/plugin-command-dialog.test.tsx`
Expected: PASS.

## Task 6: Settings and Diagnostics

**Files:**
- Modify: `src/components/settings/settings-dialog.tsx`

- [ ] **Step 1: Add desktop host diagnostics block**

Show:
- runtime available/unavailable
- last host error
- number of host-activatable extensions
- restart host action

- [ ] **Step 2: Keep messaging honest**

UI copy must explicitly distinguish:
- imported metadata only
- mapped Lattice behavior
- extension-host-backed commands now running

## Task 7: Verification

**Files:**
- Modify: `docs/DESKTOP_FEATURES.md`
- Modify: `docs/MANUAL_RELEASE_GUIDE.md`
- Modify: `docs/RELEASE_NOTES.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Update docs**

Document:
- desktop-only VS Code extension host bridge
- current supported API surface (`commands.registerCommand`, activation by `*` and `onCommand:*`, basic notifications, workspace folders)
- unsupported APIs still pending

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm run test:run -- src/lib/vscode-compat/__tests__/storage.test.ts src/lib/vscode-extension-host/__tests__/desktop.test.ts src/stores/__tests__/vscode-extension-host-store.test.ts src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx src/components/ui/__tests__/plugin-command-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run docs check**

Run: `npm run test:docs`
Expected: PASS.

- [ ] **Step 5: Run release gate**

Run: `npm run qa:gate`
Expected: PASS.

- [ ] **Step 6: Refresh local desktop release**

Run: `npm run release:prepare -- --skip-qa --artifacts-dir src-tauri/target/release`
Expected: refreshed artifacts in `releases/v2.3.1/`.

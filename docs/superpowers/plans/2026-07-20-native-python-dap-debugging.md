# Native Python DAP Debugging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real Python DAP debugging workflow to the Lattice-native editor and VS Code tools sidebar, including breakpoints, stepping, call stacks, variables, expression evaluation, output, and deterministic cleanup.

**Architecture:** A focused Rust module owns `debugpy.adapter`, TCP DAP framing, request correlation, lifecycle, and process cleanup. A TypeScript boundary and Zustand store normalize that state for a dedicated Run and Debug sidebar, while a small CodeMirror extension owns breakpoint and active-frame rendering.

**Tech Stack:** Rust, Tokio TCP/process APIs, Tauri 2 commands/events, Python debugpy, TypeScript, Zustand, React 19, CodeMirror 6, Vitest, Testing Library.

**Repository rule:** Work directly in the existing `main` worktree. Do not create a branch, stage files, or create commits unless the user separately requests it.

---

### Task 1: Preserve And Validate Python Launch Configuration

**Status: completed (2026-07-20).**

**Files:**
- Modify: `src/lib/vscode-compat/types.ts`
- Modify: `src/lib/vscode-compat/mapper.ts`
- Modify: `src/lib/vscode-compat/task-actions.ts`
- Test: `src/lib/vscode-compat/__tests__/mapper.test.ts`
- Test: `src/lib/vscode-compat/__tests__/task-actions.test.ts`

- [ ] **Step 1: Write failing normalization tests**

Add a Python configuration containing `program`, `module`, `cwd`, `args`,
`env`, `python`, `justMyCode`, `stopOnEntry`, and `subProcess`. Assert the
normalized launch preserves booleans and rejects a configuration that supplies
both `program` and `module` to the debug request builder.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
npm run test:run -- "src/lib/vscode-compat/__tests__/mapper.test.ts" "src/lib/vscode-compat/__tests__/task-actions.test.ts"
```

Expected: the new option assertions fail because the fields and Python debug
request builder do not exist.

- [ ] **Step 3: Add the allowlisted normalized fields**

Extend both launch interfaces with:

```ts
justMyCode?: boolean;
stopOnEntry?: boolean;
subProcess?: boolean;
```

Add `buildPythonDebugLaunchRequest()` returning a discriminated result:

```ts
type PythonDebugLaunchBuildResult =
  | { supported: true; request: PythonDebugLaunchRequest }
  | { supported: false; reason: string };
```

Resolve `${workspaceFolder}`, `${file}`, and `${fileDirname}` from explicit
options. Reject missing context, unresolved variables, non-Python types,
non-launch requests, and configurations without exactly one of program/module.

- [ ] **Step 4: Verify GREEN**

Run the Task 1 focused command. Expected: PASS.

### Task 2: Implement And Test The DAP Codec

**Status: completed (2026-07-20).**

**Files:**
- Create: `src-tauri/src/debug_adapter.rs`
- Modify: `src-tauri/src/main.rs`
- Test: Rust tests inside `src-tauri/src/debug_adapter.rs`

- [ ] **Step 1: Write failing codec tests**

Define tests that feed a frame in one chunk, byte-by-byte, and as two adjacent
frames. Assert this wire form:

```text
Content-Length: 45\r\n\r\n{"seq":1,"type":"request","command":"threads"}
```

Add rejection cases for missing length, non-numeric length, 8 MiB overflow,
invalid JSON, and a missing DAP `type`.

- [ ] **Step 2: Run tests and verify RED**

```powershell
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter::tests::codec -- --nocapture
```

Expected: FAIL because the module and codec are absent.

- [ ] **Step 3: Implement bounded framing and message types**

Add serializable request/response/event envelopes plus `encode_dap_message()`
and an incremental `DapDecoder`. Preserve unknown body fields as
`serde_json::Value`; do not create protocol-wide structs that A2.1 does not use.

- [ ] **Step 4: Verify codec tests and Rust formatting**

```powershell
cargo fmt --manifest-path "src-tauri/Cargo.toml" -- --check
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter::tests::codec -- --nocapture
```

Expected: PASS.

### Task 3: Build The Managed Python Debug Session

**Status: completed (2026-07-20).**

**Files:**
- Modify: `src-tauri/src/debug_adapter.rs`
- Modify: `src-tauri/src/main.rs`
- Test: Rust async tests inside `src-tauri/src/debug_adapter.rs`

- [ ] **Step 1: Write failing validation and lifecycle tests**

Test workspace-contained program/cwd validation, dotted module validation,
environment bounds, stale session rejection, and single-active-session
enforcement. Build a Tokio loopback fake adapter that records commands and
returns `initialize`, `initialized`, `setBreakpoints`, `configurationDone`,
`stopped`, `threads`, `stackTrace`, `scopes`, `variables`, and `terminated`.

- [ ] **Step 2: Verify RED**

```powershell
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter::tests::session -- --nocapture
```

Expected: FAIL because session management is missing.

- [ ] **Step 3: Implement request correlation and event routing**

Use monotonically increasing request sequence ids and a pending
`HashMap<i64, oneshot::Sender<_>>`. The reader task removes a matching sender
for responses and sends normalized events through an `EventSink` trait. This
trait lets tests record events without constructing a Tauri application.

- [ ] **Step 4: Implement direct adapter launch and cleanup**

Probe the interpreter with `-c "import debugpy"`, reserve a loopback port,
spawn `-m debugpy.adapter --host 127.0.0.1 --port <port>` without a shell, and
connect for at most 5 seconds. Capture stdout/stderr, use the existing Windows
no-window process helper, and kill/reap adapter plus debuggee after failure or a
2-second disconnect grace period.

- [ ] **Step 5: Implement the fixed command surface**

Expose the commands listed in the design. Use typed request bodies for launch,
breakpoints, execution control, stack/scopes/variables, and evaluate. Register
`DebugAdapterState` and every command in `main.rs`.

- [ ] **Step 6: Verify session tests and Cargo checks**

```powershell
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter -- --nocapture
cargo check --manifest-path "src-tauri/Cargo.toml"
```

Expected: PASS with no adapter child remaining after the cleanup test.

### Task 4: Add The Renderer Boundary And Debug Store

**Status: completed (2026-07-20).**

**Files:**
- Create: `src/lib/vscode-debug/desktop.ts`
- Create: `src/lib/vscode-debug/__tests__/desktop.test.ts`
- Create: `src/stores/vscode-debug-store.ts`
- Create: `src/stores/__tests__/vscode-debug-store.test.ts`

- [ ] **Step 1: Write failing desktop adapter tests**

Mock Tauri invoke/listen. Assert each exported action uses the exact fixed
command, camelCase payload, and approved timeout. Assert one `debug://event`
listener is disposed and non-desktop calls fail before invoke.

- [ ] **Step 2: Write failing store tests**

Assert lifecycle transitions, stale-session event rejection, stack/scope reset
while running, bounded output, lazy variable caching, workspace-scoped
breakpoint persistence, and verified-breakpoint updates from DAP responses.

- [ ] **Step 3: Verify RED**

```powershell
npm run test:run -- "src/lib/vscode-debug/__tests__/desktop.test.ts" "src/stores/__tests__/vscode-debug-store.test.ts"
```

Expected: FAIL because both modules are absent.

- [ ] **Step 4: Implement the adapter and store**

Keep all Tauri imports in `desktop.ts`. Store actions call typed adapter
functions, subscribe once, and use a request generation/session id check before
applying asynchronous results. Persist only breakpoints, never active session
objects or variables.

- [ ] **Step 5: Verify GREEN and typecheck**

```powershell
npm run test:run -- "src/lib/vscode-debug/__tests__/desktop.test.ts" "src/stores/__tests__/vscode-debug-store.test.ts"
npm run typecheck
```

Expected: PASS.

### Task 5: Integrate Breakpoints And Active Frames With CodeMirror

**Status: completed (2026-07-20).**

**Files:**
- Create: `src/lib/vscode-debug/editor-extension.ts`
- Create: `src/lib/vscode-debug/__tests__/editor-extension.test.ts`
- Modify: `src/components/editor/codemirror/code-editor.tsx`
- Modify: `src/components/renderers/code-editor-viewer.tsx`
- Modify: `src/components/editor/codemirror/__tests__/code-editor.test.tsx`
- Modify: `src/components/renderers/__tests__/code-editor-viewer.test.tsx`

- [ ] **Step 1: Write failing editor extension tests**

Mount a CodeMirror view with a canonical file path. Click gutter line 3 and
assert the callback receives `{ path, line: 3 }`; update state with verified
line 3 and active line 4 and assert distinct markers. Assert disposal removes
handlers and that a Unicode path remains unchanged.

- [ ] **Step 2: Verify RED**

```powershell
npm run test:run -- "src/lib/vscode-debug/__tests__/editor-extension.test.ts" "src/components/editor/codemirror/__tests__/code-editor.test.tsx"
```

Expected: FAIL because the extension does not exist.

- [ ] **Step 3: Implement a stable CodeMirror compartment**

Expose `createDebugEditorExtension()` and an update effect. Install it through
`extraExtensions` from `CodeEditorViewer`; do not rebuild `EditorView` when a
breakpoint is verified or a frame changes. Disable gutter interaction for
read-only/non-desktop/non-runnable files.

- [ ] **Step 4: Connect navigation and store state**

Resolve `absoluteFilePath`, toggle store breakpoints, and derive the active
frame for that file. Reuse `openFileInPane` plus pending line navigation for
stack frames; do not introduce a second file-opening route.

- [ ] **Step 5: Verify editor tests and typecheck**

Run both Task 5 tests plus `npm run typecheck`. Expected: PASS.

### Task 6: Build The Native Run And Debug Sidebar

**Status: completed (2026-07-20).**

**Files:**
- Create: `src/components/vscode-compat/vscode-run-debug-panel.tsx`
- Create: `src/components/vscode-compat/__tests__/vscode-run-debug-panel.test.tsx`
- Modify: `src/components/vscode-compat/vscode-activity-panel.tsx`
- Modify: `src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx`
- Modify: `src/lib/i18n/en-US.ts`
- Modify: `src/lib/i18n/zh-CN.ts`

- [ ] **Step 1: Write failing lifecycle/control tests**

Render idle, starting, running, stopped, restarting, stopping, terminated, and
error snapshots. Assert exact enabled controls and tooltips. Assert Python
launch starts DAP, tasks remain ordinary Run actions, and Node launch displays
the unsupported-debug reason without calling Start Debugging.

- [ ] **Step 2: Write failing inspection tests**

Assert stack selection/navigation, lazy scope and variable expansion,
expression evaluation in the selected frame, breakpoint visibility, output
stream labels, bounded error rendering, clear output, and duplicate-start
prevention.

- [ ] **Step 3: Verify RED**

```powershell
npm run test:run -- "src/components/vscode-compat/__tests__/vscode-run-debug-panel.test.tsx" "src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx"
```

Expected: FAIL because the dedicated panel is absent.

- [ ] **Step 4: Implement the dedicated panel**

Use stable icon-button dimensions, Lucide controls, tooltips, native sidebar
sections, and existing workspace navigation. Keep tasks/non-debug launches in
a separate Run section. Preserve output and exact errors through termination;
clear transient inspection data on resume.

- [ ] **Step 5: Replace the old inline panel and verify GREEN**

Remove the old `RunDebugPanel` from `vscode-activity-panel.tsx`, render the new
component, and rerun the Task 6 tests plus typecheck and changed-file ESLint.
Expected: PASS with no duplicate runner or debug actions.

### Task 7: Real Debugpy Smoke, Product Truth, Full QA, And Release

**Status: completed (2026-07-20).**

**Files:**
- Modify: `docs/VS_CODE_COMPATIBILITY_PLAN.md`
- Modify: `docs/DESKTOP_FEATURES.md`
- Modify: `docs/LATTICE_RELEASE_READINESS.md`
- Modify: `docs/RELEASE_NOTES.md`
- Modify: `docs/superpowers/plans/2026-07-20-native-python-dap-debugging.md`
- Refresh: `releases/v2.3.1/`

- [ ] **Step 1: Add and run an opt-in real adapter smoke test**

Create a temporary Python script with a deterministic local variable. With
`LATTICE_REAL_DEBUGPY_SMOKE=1`, assert breakpoint stop, stack, scope, variable,
step, continue, termination, child cleanup, and temporary-directory deletion.
The test must refuse any path inside the Lattice repository.

```powershell
$env:LATTICE_REAL_DEBUGPY_SMOKE="1"
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter::tests::real_debugpy_smoke -- --nocapture
Remove-Item Env:LATTICE_REAL_DEBUGPY_SMOKE
```

Expected: one real smoke test passes and no `debugpy.adapter` child remains.

- [ ] **Step 2: Update product truth and explicit boundaries**

Document shipped local Python launch debugging and retain explicit A2.2 gaps.
Node/js-debug program launch was subsequently completed in A2.2.1; remote
attach, browser/terminal targets, general child/worker sessions, advanced
breakpoints, and arbitrary extension-provided adapters remain open.

- [ ] **Step 3: Run focused and complete verification**

```powershell
npm run typecheck
cargo fmt --manifest-path "src-tauri/Cargo.toml" -- --check
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter -- --nocapture
cargo check --manifest-path "src-tauri/Cargo.toml"
npm run qa:gate
```

Expected: all commands pass. Record exact test counts and the existing official
dependency-audit exceptions; do not hide unrelated pre-existing warnings.

- [ ] **Step 4: Refresh and verify the local release**

Copy only the successful build outputs using the repository release workflow,
regenerate `releases/v2.3.1/SHA256SUMS.txt`, and compare every manifest entry to
the copied files. Verify MSI, NSIS installer, and standalone executable exist
and report whether they are signed.

- [ ] **Step 5: Update execution status honestly**

Mark only verified tasks complete in this plan. Report shipped A2.1 behavior,
test/build evidence, checksums, signing status, and every remaining A2.2 limit.

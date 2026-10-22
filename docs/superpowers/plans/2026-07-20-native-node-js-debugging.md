# Native Node js-debug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans and superpowers:test-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real local Node root-process launch debugger to Lattice using Microsoft's pinned standalone vscode-js-debug DAP server.

**Architecture:** Build-time resource preparation verifies and extracts the official `v1.117.0` standalone server. The Rust backend generalizes the existing DAP process holder and adds one fixed Node start command; the renderer adds a typed Node launch request while reusing the current debug store, CodeMirror breakpoint integration, and Run and Debug sidebar.

**Tech Stack:** Node.js resource preparation scripts, Microsoft vscode-js-debug, Rust/Tokio/Tauri 2, DAP, TypeScript, Zustand, React 19, CodeMirror 6, Vitest.

**Repository rule:** Work directly in the existing `main` worktree. Do not create branches, stage files, commit, or push. Refresh only the local `releases/v2.3.1` directory after the same-phase QA gate passes.

---

### Task 1: Prepare And Verify The Official js-debug Resource

**Files:**
- Create: `scripts/js-debug-runtime.json`
- Create: `scripts/prepare-js-debug-resources.mjs`
- Create: `scripts/__tests__/prepare-js-debug-resources.test.mjs`
- Modify: `package.json`
- Modify: `src-tauri/tauri.conf.json`
- Generate: `src-tauri/resources/vscode-js-debug/js-debug/`

- [ ] **Step 1: Write failing descriptor and archive-safety tests**

Export pure helpers from the new script and test this pinned descriptor:

```json
{
  "version": "1.117.0",
  "assetUrl": "https://github.com/microsoft/vscode-js-debug/releases/download/v1.117.0/js-debug-dap-v1.117.0.tar.gz",
  "assetBytes": 1216795,
  "sha256": "ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772",
  "rootDirectory": "js-debug"
}
```

Tests must assert rejection of HTTP URLs, non-GitHub release paths, invalid
hashes, wrong sizes, `../escape` archive entries, absolute entries, a missing
`js-debug/src/dapDebugServer.js`, and a missing `js-debug/LICENSE`.

- [ ] **Step 2: Verify RED**

Run:

```powershell
npm run test:run -- "scripts/__tests__/prepare-js-debug-resources.test.mjs"
```

Expected: FAIL because the preparation module does not exist.

- [ ] **Step 3: Implement atomic verified preparation**

Export this exact public surface:

```js
export {
  validateDescriptor,
  validateArchiveEntries,
  verifyArchive,
  prepareJsDebugResources,
};
```

Use `fetch`, `crypto.createHash`, `node:fs/promises`, and the system `tar`
executable invoked with an argument array and `windowsHide: true`. Extract to a
temporary sibling directory and rename only after complete validation.

- [ ] **Step 4: Wire build resources**

Add scripts:

```json
"prepare:js-debug-resources": "node scripts/prepare-js-debug-resources.mjs",
"prepare:desktop-resources": "npm run prepare:typescript-resources && npm run prepare:js-debug-resources"
```

Add `resources/vscode-js-debug/**/*` to Tauri bundle resources.

- [ ] **Step 5: Verify GREEN and real pinned preparation**

Run:

```powershell
npm run test:run -- "scripts/__tests__/prepare-js-debug-resources.test.mjs"
npm run prepare:js-debug-resources
Get-FileHash -Algorithm SHA256 "src-tauri/resources/vscode-js-debug/js-debug/src/dapDebugServer.js"
```

Expected: tests pass and the server plus MIT license exist locally.

### Task 2: Preserve And Build Node Launch Configuration

**Files:**
- Modify: `src/lib/vscode-compat/types.ts`
- Modify: `src/lib/vscode-compat/mapper.ts`
- Modify: `src/lib/vscode-compat/task-actions.ts`
- Modify: `src/lib/vscode-compat/__tests__/mapper.test.ts`
- Modify: `src/lib/vscode-compat/__tests__/task-actions.test.ts`

- [ ] **Step 1: Write failing mapper and builder tests**

Add a `pwa-node` launch with:

```ts
{
  name: "Node: Current File",
  type: "pwa-node",
  request: "launch",
  program: "${file}",
  cwd: "${workspaceFolder}",
  runtimeExecutable: "node",
  runtimeArgs: ["--enable-source-maps"],
  args: ["--demo"],
  env: { NODE_ENV: "development" },
  stopOnEntry: false,
  sourceMaps: true,
  smartStep: true,
  skipFiles: ["<node_internals>/**"],
  outFiles: ["${workspaceFolder}/dist/**/*.js"]
}
```

Assert normalization preserves every allowlisted field and
`buildNodeDebugLaunchRequest()` resolves the three supported variables. Add
rejection tests for attach, browser types, missing program, unresolved
variables, integratedTerminal, and traversal in outFiles.

- [ ] **Step 2: Verify RED**

```powershell
npm run test:run -- "src/lib/vscode-compat/__tests__/mapper.test.ts" "src/lib/vscode-compat/__tests__/task-actions.test.ts"
```

Expected: new field and builder assertions fail.

- [ ] **Step 3: Implement the typed builder**

Add:

```ts
export interface NodeDebugLaunchRequest {
  kind: "node";
  name: string;
  workspaceRootPath: string;
  program: string;
  cwd: string;
  runtimeExecutable?: string;
  runtimeArgs: string[];
  args: string[];
  env?: Record<string, string>;
  stopOnEntry: boolean;
  sourceMaps: boolean;
  smartStep: boolean;
  skipFiles: string[];
  outFiles: string[];
}
```

Return `{ supported: true, request } | { supported: false, reason }`. Reuse one
variable resolver for Python and Node instead of duplicating interpolation.

- [ ] **Step 4: Verify GREEN**

Run the Task 2 command plus `npm run typecheck`. Expected: PASS.

### Task 3: Generalize The Rust Session And Handle Reverse Requests

**Files:**
- Modify: `src-tauri/src/debug_adapter.rs`
- Modify: `src-tauri/src/main.rs`
- Test: Rust tests in `src-tauri/src/debug_adapter.rs`

- [ ] **Step 1: Write failing adapter-neutral session tests**

Assert a `StartedDebugSession` records `adapter_label`, status/stop errors use
that label, and Python still produces the same initialize/launch sequence.

Add a fake adapter that sends this reverse request:

```json
{"seq":31,"type":"request","command":"runInTerminal","arguments":{}}
```

Assert the client writes a DAP failure response with `request_seq: 31`,
`success: false`, and a bounded explanatory message.

- [ ] **Step 2: Verify RED**

```powershell
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter::tests::session -- --nocapture
```

Expected: tests fail because the process holder is Python-specific and reverse
requests are ignored.

- [ ] **Step 3: Generalize the holder and response loop**

Rename `StartedPythonDebugSession` to `StartedDebugSession`, add
`adapter_label`, and make stop/status errors label-aware. In the DAP reader,
route incoming `type: "request"` to a bounded failure response writer. Do not
expose arbitrary reverse request handlers to the renderer.

- [ ] **Step 4: Verify GREEN and Python regression**

```powershell
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter -- --nocapture
```

Expected: all existing Python tests plus new generic tests pass.

### Task 4: Add The Managed Node js-debug Session

**Files:**
- Modify: `src-tauri/src/debug_adapter.rs`
- Modify: `src-tauri/src/main.rs`
- Test: Rust tests in `src-tauri/src/debug_adapter.rs`

- [ ] **Step 1: Write failing Node validation and protocol tests**

Test canonical workspace program/cwd/breakpoint paths, environment bounds,
bounded `skipFiles`/`outFiles`, runtime argument NUL rejection, and resource
entry resolution. A fake adapter must record:

```text
initialize -> launch -> setBreakpoints -> setExceptionBreakpoints -> configurationDone
```

Assert launch includes `type: pwa-node`, `console: internalConsole`,
`autoAttachChildProcesses: false`, and `__workspaceFolder`.

- [ ] **Step 2: Verify RED**

```powershell
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter::tests::node -- --nocapture
```

Expected: FAIL because Node request/session functions are absent.

- [ ] **Step 3: Implement Node validation and adapter launch**

Add typed `NodeDebugLaunchRequest`/`ValidatedNodeDebugLaunch`. Resolve the
packaged entry below the Tauri resource directory and reject any escape:

```text
vscode-js-debug/js-debug/src/dapDebugServer.js
```

Probe `node --version`, reserve loopback, spawn direct arguments, capture output,
connect using the shared deadline, and configure through the shared DAP client.

- [ ] **Step 4: Add and register the fixed command**

Register only:

```rust
desktop_start_node_debug_session(request, app, state)
```

Keep the shared single-active-session slot and all existing controls/queries.

Implementation correction from the real adapter smoke: standalone js-debug
always issues a `startDebugging` reverse request for the launched root target,
even with `autoAttachChildProcesses: false`. The shipped implementation accepts
only a bounded `launch` request with `__pendingTargetId`, opens a second
connection to the same loopback server, replays the current breakpoint and
exception configuration, and routes controls to that target client. All other
reverse requests remain explicit failures. This is required root-target binding,
not general child-process or worker debugging.

- [ ] **Step 5: Verify GREEN**

```powershell
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter -- --nocapture
cargo check --manifest-path "src-tauri/Cargo.toml"
rustfmt --edition 2021 --check "src-tauri/src/debug_adapter.rs"
```

Expected: PASS.

### Task 5: Connect Node Debugging To The Native Sidebar

**Files:**
- Modify: `src/lib/vscode-debug/desktop.ts`
- Modify: `src/lib/vscode-debug/__tests__/desktop.test.ts`
- Modify: `src/stores/vscode-debug-store.ts`
- Modify: `src/stores/__tests__/vscode-debug-store.test.ts`
- Modify: `src/components/vscode-compat/vscode-run-debug-panel.tsx`
- Modify: `src/components/vscode-compat/__tests__/vscode-run-debug-panel.test.tsx`
- Modify: `src/lib/i18n/en-US.ts`
- Modify: `src/lib/i18n/zh-CN.ts`

- [ ] **Step 1: Write failing desktop/store tests**

Assert `startNodeDebugSession()` invokes
`desktop_start_node_debug_session` with the exact request and launch timeout.
Assert the store dispatches `{ kind: "node" }` to Node while preserving the
start-event buffer and all shared lifecycle behavior.

- [ ] **Step 2: Write failing panel behavior tests**

Replace the existing Node ordinary-run expectation with a real debug start for
a supported `pwa-node` launch. Retain ordinary Run fallback tests for attach,
browser, integrated terminal, and missing program configurations, including the
exact reason in `title`.

- [ ] **Step 3: Verify RED**

```powershell
npm run test:run -- "src/lib/vscode-debug/__tests__/desktop.test.ts" "src/stores/__tests__/vscode-debug-store.test.ts" "src/components/vscode-compat/__tests__/vscode-run-debug-panel.test.tsx"
```

Expected: Node start assertions fail while Python tests remain green.

- [ ] **Step 4: Implement the discriminated start path**

Export:

```ts
type DebugLaunchRequest = PythonDebugLaunchRequest | NodeDebugLaunchRequest;
```

Give Python requests `kind: "python"`, dispatch by `request.kind` in the store,
and select the appropriate builder in the panel. Keep controls and inspection
UI adapter-neutral.

- [ ] **Step 5: Verify GREEN**

Run the Task 5 command, the activity panel tests, `npm run typecheck`, and
changed-file ESLint. Expected: PASS with zero errors.

### Task 6: Prove A Real Node Debug Session

**Files:**
- Modify: `src-tauri/src/debug_adapter.rs`
- Modify: `docs/VS_CODE_COMPATIBILITY_PLAN.md`
- Modify: `docs/DESKTOP_FEATURES.md`
- Modify: `docs/LATTICE_RELEASE_READINESS.md`
- Modify: `docs/RELEASE_NOTES.md`
- Modify: this plan

- [ ] **Step 1: Add an opt-in real Node smoke**

With `LATTICE_REAL_JS_DEBUG_SMOKE=1`, create a temporary JavaScript file:

```js
function main() {
  const latticeValue = 42;
  console.log(latticeValue);
}
main();
```

Start the bundled server and local Node, stop on the `console.log` line, inspect
`latticeValue`, evaluate `latticeValue + 1`, continue, observe termination,
stop the session, and delete the temporary workspace with bounded Windows retry.

- [ ] **Step 2: Run real smoke and all focused gates**

```powershell
$env:LATTICE_REAL_JS_DEBUG_SMOKE = "1"
cargo test --manifest-path "src-tauri/Cargo.toml" debug_adapter::tests::node_real_js_debug_smoke -- --exact --nocapture
Remove-Item Env:LATTICE_REAL_JS_DEBUG_SMOKE
npm run test:run -- "src/lib/vscode-compat/__tests__/task-actions.test.ts" "src/lib/vscode-debug/__tests__/desktop.test.ts" "src/stores/__tests__/vscode-debug-store.test.ts" "src/components/vscode-compat/__tests__/vscode-run-debug-panel.test.tsx"
```

Expected: one real Node smoke passes and no `dapDebugServer.js` or debuggee Node
process remains.

- [ ] **Step 3: Update product truth**

Document local Node root-process launch as shipped. Keep attach, browser,
terminal, child multi-session, arbitrary adapter, and advanced-breakpoint gaps
explicit.

### Task 7: Complete QA And Refresh The Desktop Release

**Files:**
- Refresh: `releases/v2.3.1/`

- [ ] **Step 1: Run the complete same-phase gate**

```powershell
npm run qa:gate
```

Expected: lint, typecheck, docs, all Vitest, Next build, and Tauri build pass.

- [ ] **Step 2: Refresh the local release**

```powershell
node "scripts/prepare-release.mjs" --skip-qa --version 2.3.1 --artifacts-dir "src-tauri/target/release"
```

- [ ] **Step 3: Independently verify artifacts**

For MSI, NSIS, and portable exe, compare source and release size/SHA-256 to
`release-manifest.json`, check Authenticode status, and verify no adapter,
debuggee, Cargo, or Rustc process remains.

- [ ] **Step 4: Record honest completion**

Report exact tests/builds/hashes/signing/audit findings. Mark only local Node
root launch as added; do not claim full VS Code, Cursor, or Trae parity.

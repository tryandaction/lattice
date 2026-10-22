# VS Code Runtime Truthful Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lattice expose only VS Code extension capabilities that have been imported from a real local manifest and successfully registered by the desktop extension host, while preserving Lattice's document-first workflows.

**Architecture:** Keep the existing Tauri-managed Node host and VS Code shim. Extend its snapshot with per-extension lifecycle results, then use that runtime snapshot as the only source of executable commands and registered views. Keep manifest contributions as discovery metadata for capability classification, explicit activation attempts, icon resolution, and failure diagnostics; never count them as runnable commands.

**Tech Stack:** Tauri/Rust, Node extension-host shim, React, Zustand, TypeScript, Vitest, local VS Code extension manifests.

---

## File Structure

- Modify: `src/lib/vscode-extension-host/types.ts`
  - Define host extension lifecycle results and separate actual registered commands/views from imported manifest metadata.
- Modify: `src-tauri/src/main.rs`
  - Record activation success/failure per extension in the generated Node host snapshot; return it through each IPC response.
- Modify: `src/stores/vscode-extension-host-store.ts`
  - Retain manifest command metadata only for diagnostics and build the interactive catalog strictly from `snapshot.commands`.
- Modify: `src/components/vscode-compat/vscode-activity-panel.tsx`
  - Render activity icons for view-capable imported extensions, resolve a view through the host on click, show compact host state/failure information, and avoid manifest-command fallback.
- Modify: `src/lib/vscode-compat/extensions.ts`
  - Add deterministic capability classification used by Activity Bar ordering and collapsed inventory-only sections.
- Modify: `src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx`
  - Cover zero registered commands, host-backed views, host errors, icon resolution, and inventory-only suppression.
- Modify: `src/stores/__tests__/vscode-extension-host-store.test.ts`
  - Cover the distinction between imported metadata and runtime registration.
- Modify: `src/lib/vscode-compat/__tests__/extensions.test.ts`
  - Cover extension capability classification and priority ordering.
- Modify: `src/components/renderers/__tests__/code-editor-viewer.test.tsx`
  - Confirm code rendering remains free of VS Code chrome and continues to send only code documents to the host.
- Modify: `src/components/renderers/__tests__/jupyter-renderer.test.tsx`
  - Confirm notebook rendering keeps stored outputs distinct from current execution failures and remains free of takeover UI.

## Task 1: Define Runtime Truth in Shared Types

- [ ] **Step 1: Write failing tests for runtime-only commands**

Add a panel test with a runnable manifest command, host status `ready`, and an empty `snapshot.commands`; assert that the command count is `0 registered commands`, no command button exists, and the visible message says no command has registered.

- [ ] **Step 2: Run the focused test to verify red**

Run:

```powershell
npm run test -- --run src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx
```

Expected: the test fails because the panel currently renders `importedCommands` as commands.

- [ ] **Step 3: Add per-extension host lifecycle type**

In `src/lib/vscode-extension-host/types.ts`, add `VSCodeHostExtensionState` with `id`, `displayName`, `status` (`pending | active | failed | skipped`), `commandCount`, `viewCount`, `error`, and `missingApi` fields. Add `extensions: VSCodeHostExtensionState[]` to `VSCodeHostSnapshot` and initialize it in `EMPTY_VSCODE_HOST_SNAPSHOT`.

- [ ] **Step 4: Re-run the focused type/test command**

Run the same command. Expected: it remains red only for the intended panel behavior, not a TypeScript import/type error.

## Task 2: Report Actual Host Registration and Activation Failures

- [ ] **Step 1: Write Rust unit tests for lifecycle data in snapshots**

Add a `src-tauri/src/main.rs` test deserializing a snapshot that contains one active extension and one failed extension with a missing API list. Assert the command and view arrays are retained and extension status is preserved.

- [ ] **Step 2: Run the Rust test to verify red**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml vscode_extension_host_snapshot_deserializes_extension_states
```

Expected: failure because the snapshot lacks `extensions` lifecycle data.

- [ ] **Step 3: Implement lifecycle recording inside the Node host script**

In `vscode_extension_host_script()`:

- create one state entry for every requested extension;
- mark it `active` only after `activate()` returns;
- mark it `failed` with the caught error when module loading or `activate()` rejects;
- compute each extension's registered command/view counts from the registries;
- include all lifecycle entries in `buildSnapshot()`;
- keep a global `lastError` only as a short summary, not the only diagnostic source.

- [ ] **Step 4: Preserve the lifecycle list in Rust IPC responses**

Extend `VSCodeExtensionHostSnapshot` in `src-tauri/src/main.rs` with matching serde fields so start, execute-command, resolve-view, resolve-tree, post-message, open-document, and status calls all return the exact host result.

- [ ] **Step 5: Run the Rust test to verify green**

Run the Task 2 command. Expected: PASS.

## Task 3: Make the Store and Activity Panel Runtime-Truthful

- [ ] **Step 1: Write failing store test**

In `src/stores/__tests__/vscode-extension-host-store.test.ts`, start from a snapshot with empty `commands` and non-empty manifest commands. Assert the state exposes manifest command metadata separately but the runtime command catalog has length zero.

- [ ] **Step 2: Run the focused store test to verify red**

Run:

```powershell
npm run test -- --run src/stores/__tests__/vscode-extension-host-store.test.ts
```

Expected: failure because the current store calls manifest-derived commands `importedCommands` and the panel consumes them as runtime commands.

- [ ] **Step 3: Change the host store contract**

Rename `importedCommands` to `manifestCommands` and retain it only as immutable imported metadata. Add a selector/helper returning `snapshot.commands` for executable commands. Do not fabricate a command on activation failure or host unavailability.

- [ ] **Step 4: Update Activity Panel selection logic**

In `src/components/vscode-compat/vscode-activity-panel.tsx`:

- display `snapshot.commandCount` and `snapshot.commands.length` as `registered commands`;
- source command buttons only from `snapshot.commands`;
- source activity entries from manifest `viewContainerItems` and view contributions, but prioritize an extension only if its host lifecycle state is `active` or it owns registered views;
- on an icon click, attempt `resolveView`/`resolveTree` only for a host-registered or host-activatable view;
- show compact `Starting`, `Failed`, `Needs VS Code API: ...`, or `No registered entry` states instead of empty feature cards;
- keep inventory-only extensions out of the top activity strip.

- [ ] **Step 5: Run panel and store tests to verify green**

Run:

```powershell
npm run test -- --run src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx src/stores/__tests__/vscode-extension-host-store.test.ts
```

Expected: PASS, including the regression that `0 registered commands` does not produce a runnable command button.

## Task 4: Classify Imported Extension Capabilities

- [ ] **Step 1: Write failing capability classification tests**

Add test fixtures for runnable, command-capable, view-capable, debug-capable, notebook-capable, grammar/theme-only, and inventory-only extensions. Assert that only view-capable and active command-capable extensions can enter the activity ordering.

- [ ] **Step 2: Run classification test to verify red**

Run:

```powershell
npm run test -- --run src/lib/vscode-compat/__tests__/extensions.test.ts
```

Expected: failure because the current activity entry helper treats any manifest command as actionable.

- [ ] **Step 3: Implement a single capability classifier**

Add `classifyVSCodeExtensionCapability()` to `src/lib/vscode-compat/extensions.ts`. Return one primary capability plus booleans for command/view/debug/notebook/grammar/theme metadata. Use it for ordering and for the secondary inventory presentation. Preserve extension paths and icon fields unchanged.

- [ ] **Step 4: Run classification and panel tests to verify green**

Run the Task 4 command together with the Activity Panel test. Expected: PASS.

## Task 5: Preserve Code and Notebook Boundaries

- [ ] **Step 1: Add focused regression tests**

Add assertions that code and notebook content has no takeover banner, no activity bar in the reading/editor area, and no generic `Search` or `Run` duplication. Add a notebook fixture containing historical `error` output and assert it does not render a current execution failure indicator without a new execution result.

- [ ] **Step 2: Run code and notebook tests to verify red or document existing coverage**

Run:

```powershell
npm run test -- --run src/components/renderers/__tests__/code-editor-viewer.test.tsx src/components/renderers/__tests__/jupyter-renderer.test.tsx
```

Expected: new test fails only if current UI leaks VS Code chrome or misclassifies notebook output.

- [ ] **Step 3: Apply minimal renderer corrections**

Keep `VSCodeWorkbenchSurface` transparent. Keep the standalone `VSCodeActivityPanel` in the application side panel. Notify the host only for code/IPYNB documents and keep PDF, Markdown, Word, HTML, and image routing untouched in `universal-file-viewer.tsx`.

- [ ] **Step 4: Run focused renderer tests to verify green**

Run the Task 5 command. Expected: PASS.

## Task 6: Verify With Real Local Extensions and Rendered UI

- [ ] **Step 1: Add a local manifest smoke script**

Create `scripts/smoke-vscode-extensions.mjs`. It reads `%USERPROFILE%/.vscode/extensions`, resolves latest installed versions for `anthropic.claude-code`, `openai.chatgpt`, `augment.vscode-augment`, `ms-python.python`, `ms-toolsai.jupyter`, `james-yu.latex-workshop`, and `ms-vscode.js-debug-nightly`, then prints runtime entry, contribution counts, resolved icon path, and capability class. Missing extensions must be reported, not invented.

- [ ] **Step 2: Run the smoke script**

Run:

```powershell
node scripts/smoke-vscode-extensions.mjs
```

Expected: a real local inventory with no synthetic entries and explicit missing-extension rows where applicable.

- [ ] **Step 3: Run required project verification**

Run in order:

```powershell
npm run typecheck
npm run test -- --run
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

- [ ] **Step 4: Run rendered Web validation**

Start the local development server and use the local browser to verify: code file -> side Activity Bar -> agent icon -> registered view/tree/webview or compact failure state. Capture desktop and mobile screenshots, inspect browser console errors, and verify PDF/Markdown/image pages do not show VS Code chrome.

- [ ] **Step 5: Evaluate release refresh eligibility**

Run `npm run qa:gate`. Only after all required checks pass in the same phase, refresh local artifacts with `node scripts/prepare-release.mjs --skip-qa`. Do not commit, push, deploy, or replace release artifacts on a failed gate.

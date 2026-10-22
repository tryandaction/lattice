# Native VS Code Workbench Implementation Plan

## Task 1: Backend contract tests

- Add focused Rust tests for CLI discovery candidates, secure argument construction, authenticated URL construction, and readiness classification.
- Run the new tests and confirm they fail before implementation.

## Task 2: Tauri server lifecycle

- Add a single-purpose VS Code Workbench module with snapshot, managed child, and state types.
- Implement `desktop_start_vscode_workbench`, `desktop_get_vscode_workbench_status`, and `desktop_stop_vscode_workbench`.
- Bind to loopback, generate a UUID token, validate the workspace, poll HTTP readiness, and terminate only the owned child.
- Register state and commands in `main.rs`, including application shutdown cleanup.

## Task 3: Frontend bridge tests

- Add typed bridge tests for command names, payload keys, timeout policy, and non-Tauri fallback behavior.
- Implement the smallest client API needed by the activity panel.

## Task 4: Real runtime launcher tests

- Replace the legacy activity-panel expectations with tests for stopped, preparing, ready, error, retry, and open-main-tab behavior.
- Ensure the ready URL is opened through `openWebUrlInActivePane` with a stable VS Code tab identity.

## Task 5: Product UI integration

- Replace the simulated extension UI with a compact real-runtime launcher and diagnostics.
- Poll while preparing and stop polling on ready/error.
- Keep the Workbench in the main pane through the existing native WebView renderer.
- Add Chinese and English product strings without claiming universal desktop-extension compatibility.

## Task 6: Runtime acceptance

- Start the local server against the Lattice workspace and wait through first-time preparation.
- Verify HTTP Workbench readiness and open it in a real browser/native WebView.
- Confirm Explorer, editor, terminal, Run and Debug, Extensions, and one supported extension activation path.
- Record any extension-specific incompatibility as a VS Code runtime limitation, not a successful Lattice activation.

## Task 7: Regression and release

- Run focused Vitest and Rust tests, TypeScript checks, build, Tauri checks, and the repository QA gate.
- Refresh `releases/v2.3.1` only after all required checks pass.
- Do not commit, push, or create a branch unless explicitly requested.

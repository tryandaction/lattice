# VS Code Source Control Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete a safe local Git workflow in the Lattice VS Code Source Control sidebar with diff, open, stage, unstage, stage-all, unstage-all, and confirmed commits.

**Architecture:** Move Git ownership into a focused Rust module that exposes only fixed Tauri commands, then extend the existing TypeScript adapter and render a dedicated React panel. Git output is parsed only in Rust; the renderer receives structured snapshots and every mutation returns fresh status.

**Tech Stack:** Rust, Tokio process APIs, Tauri 2 commands, React 19, TypeScript, Vitest, Testing Library, Lucide icons.

## Execution Status

- Tasks 1-5: completed on 2026-07-20 with Rust, adapter, component, typecheck, and changed-file lint verification green.
- Task 6: completed on 2026-07-20; full QA passed and the verified artifacts were copied to `releases/v2.3.1`.
- Post-release mutation smoke: completed on 2026-07-20 in an isolated temporary repository. Real status, diff, stage, unstage, stage-all, unstage-all, commit, and cleanup assertions passed without changing the Lattice repository.

---

### Task 1: Extract And Harden Source Control Status Parsing

**Files:**
- Create: `src-tauri/src/source_control.rs`
- Modify: `src-tauri/src/main.rs`
- Test: Rust tests in `src-tauri/src/source_control.rs`

- [ ] **Step 1: Write failing pure parser tests**

Add tests for a NUL-delimited branch header, staged/unstaged/untracked files,
rename records, conflict XY pairs, detached HEAD, and Unicode paths. Assert the
public serialized fields from the design, including `original_path`, `staged`,
`unstaged`, `conflict`, and `untracked`.

- [ ] **Step 2: Run the parser tests and verify RED**

Run:

```powershell
cargo test --manifest-path "src-tauri/Cargo.toml" source_control -- --nocapture
```

Expected: FAIL because `source_control` and `parse_porcelain_v1_z()` do not yet
exist.

- [ ] **Step 3: Implement the minimal status types and parser**

Create serializable `SourceControlChange` and `SourceControlSnapshot` in the new
module. Parse `git status --porcelain=v1 -z -b --ahead-behind` by splitting raw
bytes on NUL. Treat rename/copy records as two consecutive paths and classify
known conflict pairs (`DD`, `AU`, `UD`, `UA`, `DU`, `AA`, `UU`) explicitly.

- [ ] **Step 4: Move repository discovery and status command into the module**

Expose:

```rust
#[tauri::command]
pub async fn desktop_get_source_control_status(
    path: String,
) -> Result<SourceControlSnapshot, String>;
```

Resolve the canonical root with `git -C <workspace> rev-parse --show-toplevel`,
then execute the fixed porcelain status command. Keep `configure_tokio_command`
available as `pub(crate)` from `main.rs` or move a focused equivalent into the
module. Remove the old duplicate structs and command from `main.rs` and import
the module command for Tauri registration.

- [ ] **Step 5: Run Rust tests and check**

Run:

```powershell
cargo test --manifest-path "src-tauri/Cargo.toml" source_control -- --nocapture
cargo check --manifest-path "src-tauri/Cargo.toml"
```

Expected: PASS.

### Task 2: Define Safe Diff And Mutation Commands

**Files:**
- Modify: `src-tauri/src/source_control.rs`
- Modify: `src-tauri/src/main.rs`
- Test: Rust tests in `src-tauri/src/source_control.rs`

- [ ] **Step 1: Write failing path and command-spec tests**

Test that empty, absolute, parent-traversal, and outside-root paths are rejected;
duplicate paths are removed; wildcard characters become literal pathspecs; and
the generated argument vectors exactly match the approved Git command contract.
Also test 2 MiB UTF-8-safe truncation.

- [ ] **Step 2: Run the focused Rust tests and verify RED**

Run the Task 1 Cargo test command. Expected: FAIL because validation, command
specs, and truncation do not exist.

- [ ] **Step 3: Implement pure command specifications**

Add private builders for `Diff`, `StagePaths`, `UnstagePaths`, `StageAll`,
`UnstageAll`, and `Commit`. Each builder returns a program-independent argument
vector containing only fixed flags and validated `:(literal)` pathspecs. Do not
accept renderer-provided flags.

- [ ] **Step 4: Implement bounded Git execution**

Add a runner that invokes `git` directly with Tokio, applies 10-second status/
mutation timeouts and 30-second diff/commit timeouts, caps stdout/stderr to 2
MiB, configures no-window behavior on Windows, and returns exit status plus
sanitized output. Commit writes the trimmed UTF-8 message through piped stdin to
`git commit --file=-` and retains normal hooks.

- [ ] **Step 5: Add fixed Tauri commands**

Expose the six commands named in the design. Diff returns
`SourceControlDiff`; every successful stage/unstage/commit command calls the
status function and returns a fresh `SourceControlSnapshot`. Reject empty commit
messages and commits with unresolved conflicts.

- [ ] **Step 6: Register commands and run Rust verification**

Add the commands to `generate_handler!`, then run the Task 1 Cargo commands.
Expected: PASS.

### Task 3: Extend The Renderer Source Control Adapter

**Files:**
- Modify: `src/lib/vscode-compat/source-control.ts`
- Modify: `src/lib/vscode-compat/__tests__/source-control.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Add one test per command asserting exact Tauri command names, camelCase payloads,
and timeouts. Assert mutations return the backend snapshot. Assert non-desktop or
missing-workspace calls return/throw a truthful local availability error without
invoking Tauri.

- [ ] **Step 2: Run adapter tests and verify RED**

Run:

```powershell
npm run test:run -- src/lib/vscode-compat/__tests__/source-control.test.ts
```

Expected: FAIL because diff/mutation functions and expanded types are missing.

- [ ] **Step 3: Implement types and adapter functions**

Export:

```ts
getVSCodeSourceControlDiff(root, path, staged)
stageVSCodeSourceControlPaths(root, paths)
unstageVSCodeSourceControlPaths(root, paths)
stageAllVSCodeSourceControlChanges(root)
unstageAllVSCodeSourceControlChanges(root)
commitVSCodeSourceControlChanges(root, message)
```

Reuse one workspace guard and one mutation invoke helper to avoid duplicated
availability and timeout logic.

- [ ] **Step 4: Run adapter tests and typecheck**

Run the Task 3 test command, then `npm run typecheck`. Expected: PASS.

### Task 4: Build The Dedicated Source Control Panel

**Files:**
- Create: `src/components/vscode-compat/vscode-source-control-panel.tsx`
- Create: `src/components/vscode-compat/__tests__/vscode-source-control-panel.test.tsx`
- Modify: `src/components/vscode-compat/vscode-activity-panel.tsx`
- Modify: `src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx`
- Modify: `src/lib/i18n/en-US.ts`
- Modify: `src/lib/i18n/zh-CN.ts`

- [ ] **Step 1: Write failing grouping and navigation tests**

Render structured staged, unstaged, untracked, renamed, deleted, and conflict
entries. Assert `Merge Changes`, `Staged Changes`, and `Changes` groups, branch
and ahead/behind labels, clean/unavailable states, and stable row status. Assert
Open creates a desktop file handle from `repositoryRoot/path` and calls
`openFileInActivePane` with the repository-relative path.

- [ ] **Step 2: Run component tests and verify RED**

Run:

```powershell
npm run test:run -- src/components/vscode-compat/__tests__/vscode-source-control-panel.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement read-only structure and extraction**

Create the panel using existing buttons, Lucide icons, `createDesktopFileHandle`,
and workspace store actions. Keep rows at a stable height, use icon buttons with
tooltips, and avoid nested cards. Move the old SourceControlPanel out of the
activity panel and render the new component inside the existing built-in tool
wrapper.

- [ ] **Step 4: Add failing diff interaction tests**

Assert staged rows request staged diff, unstaged rows request unstaged diff, only
one inline patch is open, loading does not resize rows, binary/truncated/error
states are explicit, and closing the patch retains the main snapshot.

- [ ] **Step 5: Implement the bounded inline diff viewer**

Use a `<pre>` with horizontal and vertical scrolling and a constrained height.
Do not parse or syntax-highlight patches in this phase. Keep the main panel
interactive during diff loading.

- [ ] **Step 6: Run both Source Control and activity panel tests**

Run the new test plus `vscode-activity-panel.test.tsx`. Expected: PASS.

### Task 5: Add Stage, Unstage, And Confirmed Commit UX

**Files:**
- Modify: `src/components/vscode-compat/vscode-source-control-panel.tsx`
- Modify: `src/components/vscode-compat/__tests__/vscode-source-control-panel.test.tsx`
- Modify: `src/lib/i18n/en-US.ts`
- Modify: `src/lib/i18n/zh-CN.ts`

- [ ] **Step 1: Write failing stage and unstage tests**

Assert per-row and section actions invoke the correct adapter, replace the
snapshot with the returned value, disable every mutation button while one action
is running, and preserve an exact backend error without hiding the previous
snapshot.

- [ ] **Step 2: Verify RED, implement mutations, and verify GREEN**

Run the Task 4 component test command, implement the minimal shared mutation
handler, then rerun. Expected final result: PASS.

- [ ] **Step 3: Write failing commit tests**

Assert commit is disabled for empty message, no staged entries, unresolved
conflicts, or active mutation. Assert clicking enabled Commit opens a modal with
the message and staged count. Assert cancel performs no operation; confirm calls
the adapter once; success clears the message; failure keeps it.

- [ ] **Step 4: Implement the commit confirmation dialog**

Build a focused portal dialog inside the component using the existing Portal
pattern and UI layer conventions. Add Escape/cancel behavior, focus the safe
Cancel action initially, and use explicit Commit text for the destructive side
effect. Do not use `window.confirm`.

- [ ] **Step 5: Run focused tests, typecheck, and lint the changed area**

Run both component tests, adapter tests, `npm run typecheck`, and
`npx eslint` for the changed TS/TSX files. Expected: PASS with no new warnings.

### Task 6: Documentation, Full Verification, And Local Release

**Files:**
- Modify: `docs/VS_CODE_COMPATIBILITY_PLAN.md`
- Modify: `docs/DESKTOP_FEATURES.md`
- Modify: `docs/superpowers/plans/2026-07-20-vscode-scm-actions.md`
- Refresh: `releases/v2.3.1/`

- [ ] **Step 1: Update product truth**

Document shipped local SCM actions and retain the explicit boundaries: no
remote, discard/reset, branch mutation, merge/rebase, or credential workflow.

- [ ] **Step 2: Run focused cross-layer verification**

Run Rust source-control tests, adapter/panel/activity tests, `npm run typecheck`,
and `cargo check`. Expected: PASS.

- [ ] **Step 3: Run the required release gate**

Run `npm run qa:gate` and require exit code 0. Record exact test counts and all
warnings or audit findings.

- [ ] **Step 4: Refresh the local desktop release**

Run:

```powershell
node scripts/prepare-release.mjs --skip-qa --artifacts-dir "C:/lb/Lattice/src-tauri/target/release"
```

Use only artifacts from the successful Task 6 gate.

- [ ] **Step 5: Independently verify release artifacts**

Compare source and `releases/v2.3.1` MSI, NSIS, and executable sizes and SHA-256
values. Check Authenticode status and report it without claiming unsigned files
are signed.

- [ ] **Step 6: Preserve the user's Git policy**

Do not create a branch, stage files, commit, or push. This plan is executed in
the existing main worktree because the user explicitly requested it.

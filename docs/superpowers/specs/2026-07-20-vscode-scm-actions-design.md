# Lattice VS Code Source Control Actions Design

## Status

Approved A1 scope: complete the local Git workflow inside the Lattice-native VS
Code sidebar. This phase builds on the existing read-only Source Control panel.
It does not embed Code OSS and does not add remote or destructive Git actions.

## Product Contract

The Source Control tool must support the daily local workflow without leaving
Lattice:

1. inspect repository, branch, ahead/behind, conflicts, staged changes, and
   unstaged changes;
2. open a changed file in the existing Lattice editor;
3. inspect a bounded staged or unstaged patch;
4. stage or unstage one literal path;
5. stage or unstage every visible change;
6. enter a commit message, review a confirmation, and create a local commit;
7. refresh immediately after every mutation and show exact Git failures.

No visible action may be a placeholder. Disabled actions must explain their
precondition through label, title, or inline status.

## Explicit Non-Goals

- No push, pull, fetch, clone, remote management, or credential prompts.
- No discard, checkout, reset, clean, stash, rebase, merge, cherry-pick, or
  branch creation/deletion.
- No amend, force, bypassed hooks, GPG-signing configuration, or arbitrary Git
  command input.
- No renderer-side process execution and no shell command construction.

These operations require separate product and safety reviews.

## Architecture

### Rust Source Control Module

Create `src-tauri/src/source_control.rs` and move the existing status behavior
out of `main.rs`. The module owns Git process execution, repository discovery,
porcelain parsing, path validation, diff bounds, mutations, and unit tests.

Only fixed operations are exposed:

```rust
pub enum SourceControlMutation {
    StagePaths { paths: Vec<String> },
    UnstagePaths { paths: Vec<String> },
    StageAll,
    UnstageAll,
    Commit { message: String },
}
```

The enum is internal. Tauri exposes separate commands so the renderer cannot
submit arbitrary arguments:

- `desktop_get_source_control_status`
- `desktop_get_source_control_diff`
- `desktop_stage_source_control_paths`
- `desktop_unstage_source_control_paths`
- `desktop_stage_all_source_control_changes`
- `desktop_unstage_all_source_control_changes`
- `desktop_commit_source_control_changes`

Every command receives a workspace path. Repository discovery runs
`git -C <workspace> rev-parse --show-toplevel`, allowing a workspace opened on a
repository subdirectory while keeping the canonical repository root in the
snapshot.

### TypeScript Adapter

Extend `src/lib/vscode-compat/source-control.ts` as the only renderer adapter.
It defines snapshots, diffs, operation results, desktop availability checks,
timeouts, and Tauri command names. React does not call `invokeTauriCommand`
directly.

The status model becomes:

```ts
interface VSCodeSourceControlChange {
  path: string;
  originalPath: string | null;
  index: string;
  worktree: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  conflict: boolean;
  untracked: boolean;
}
```

The diff model is:

```ts
interface VSCodeSourceControlDiff {
  path: string;
  staged: boolean;
  content: string;
  binary: boolean;
  truncated: boolean;
  error: string | null;
}
```

Mutation commands return a fresh `VSCodeSourceControlSnapshot`, eliminating a
second renderer round trip and preventing stale groups after an operation.

### Source Control Panel

Split the panel implementation into
`src/components/vscode-compat/vscode-source-control-panel.tsx`; the activity
panel remains responsible only for tool selection and extension-contributed
views.

The panel contains:

- repository header with branch and ahead/behind counts;
- compact commit textarea and Commit button;
- `Merge Changes`, `Staged Changes`, and `Changes` sections as applicable;
- per-row open, diff, stage, or unstage controls;
- section-level stage-all or unstage-all controls;
- an inline bounded patch viewer below the selected row;
- exact loading, success, empty, and error states.

The commit button is enabled only when at least one index change exists and the
trimmed message is non-empty. Selecting Commit opens a confirmation dialog that
shows the message and staged file count. Confirmation invokes the backend once.
The message remains present on failure and clears only after a successful commit.

Changed-file opening reuses the existing workspace store/open-file route. It
does not create a VS Code Workbench tab or external VS Code window.

## Git Command Contract

The backend follows the official Git machine interfaces:

- status: `git status --porcelain=v1 -z -b --ahead-behind`;
- unstaged diff: `git diff --no-ext-diff --no-textconv --unified=3 --
  :(literal)<path>`;
- staged diff: `git diff --cached --no-ext-diff --no-textconv --unified=3 --
  :(literal)<path>`;
- stage paths: `git add -- :(literal)<path>...`;
- stage all: `git add -A -- .`;
- unstage paths: `git restore --staged -- :(literal)<path>...`;
- unstage all: `git restore --staged -- .`;
- commit: `git commit --file=-`, with the UTF-8 message written to stdin.

References: [git-status](https://git-scm.com/docs/git-status),
[git-diff](https://git-scm.com/docs/git-diff),
[git-restore](https://git-scm.com/docs/git-restore), and
[git-commit](https://git-scm.com/docs/git-commit).

No command uses `cmd.exe`, PowerShell, Bash, `sh -c`, string concatenation, or
user-provided flags. Normal Git commit hooks remain enabled; the product does not
silently bypass repository policy.

## Parsing And Path Safety

Status uses NUL delimiters so spaces, tabs, Unicode, quotes, and newlines in file
names are not reparsed from presentation text. Rename/copy entries preserve the
destination path and original path separately. Conflict XY pairs are classified
explicitly and never offered a one-click commit until they are resolved.

Every requested path must be repository-relative, non-empty, and free of parent
traversal. The canonical joined path must remain under the repository root.
Git receives `:(literal)` pathspecs so wildcard characters have no pathspec
meaning. Duplicate paths are removed while preserving request order.

## Performance And Bounds

- Status, stage, and unstage commands have a 10-second timeout.
- Diff and commit commands have a 30-second timeout because hooks and large
  repositories can take longer.
- Captured stdout/stderr is bounded to 2 MiB per request.
- Diff content is truncated with `truncated: true`; the editor remains usable.
- Only one mutation runs from the panel at a time; refresh remains available
  after failures.
- Status refresh never scans file contents.

## Error Handling

- Missing Git, non-repository workspace, detached HEAD, and unborn HEAD are
  represented explicitly rather than thrown as generic transport failures.
- A failed Git command returns sanitized stderr and its exit status.
- A hook failure remains visible in the commit area and does not clear the
  message.
- An untracked file has no normal Git patch; the backend returns a bounded text
  preview when readable, or `binary: true` for binary content.
- Rename, deletion, and binary changes can still be staged/unstaged even when no
  textual diff is available.
- After any successful mutation, failure to refresh is returned as an operation
  error rather than pretending the UI is current.

## Testing Strategy

Rust unit tests cover NUL porcelain parsing, branch/ahead/behind parsing,
rename/copy records, conflicts, traversal rejection, literal pathspec creation,
output truncation, and command argument construction. They do not mutate the
real Lattice repository.

TypeScript adapter tests cover every Tauri command, desktop-only behavior,
timeouts, and fresh-snapshot mutation results.

React tests cover staged/unstaged/conflict grouping, changed-file opening, diff
loading/errors, stage/unstage, stage-all/unstage-all, commit preconditions,
confirmation, success clearing, failure preservation, and concurrent-action
disabling.

Focused tests run before `npm run typecheck`, Rust checks, and the required
`npm run qa:gate`. The local release is refreshed only from the same successful
Tauri build phase.

## Acceptance Criteria

1. A repository opened at its root or a child directory resolves to the correct
   repository root and shows branch/ahead/behind accurately.
2. Staged, unstaged, untracked, renamed, deleted, and conflicted paths appear in
   truthful sections without path corruption.
3. Selecting a changed file opens it in Lattice and selecting its diff shows a
   bounded staged or unstaged patch.
4. Stage, unstage, stage-all, and unstage-all return an immediately refreshed
   snapshot and never execute a shell.
5. Commit requires staged changes, a non-empty message, and explicit user
   confirmation; hook failures preserve the message and staged state.
6. No remote, destructive, or arbitrary Git operation is reachable from the UI
   or Tauri API.
7. All focused tests, typecheck, Rust checks, full QA, desktop build, release
   synchronization, and checksum comparison pass before handoff.


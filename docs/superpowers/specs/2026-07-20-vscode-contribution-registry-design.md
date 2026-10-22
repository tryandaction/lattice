# Lattice VS Code Contribution Registry Design

## Status

Approved approach: Lattice-native compatibility shell (方案 A).

Lattice keeps its editor, panes, research workflows, PDF/Markdown experiences,
AI surfaces, workspace model, and execution infrastructure. It does not restore
the full Code OSS Workbench. VS Code compatibility is implemented as explicit,
testable adapters around imported manifests and an isolated extension host.

## Honest Baseline

The current product has six built-in VS Code tool buttons. Explorer, Search,
read-only Source Control, imported tasks, extension inventory, and registered
commands have real implementations. It is not yet Cursor/Trae-level compatibility:

- extension-contributed View Containers are parsed but not rendered as Activity
  Bar tools;
- `container` is passed into the host input and then dropped from host view
  snapshots;
- manifest views that activate on `onView:<id>` are invisible until activation,
  while the UI only lists already-registered host views;
- extension status shows only a coarse state and hides `error`/`missingApi`;
- Source Control is read-only and Run/Debug is not a DAP implementation;
- there is no marketplace, update, disable, uninstall, or VSIX lifecycle.

This phase fixes the first four items only. SCM mutations, DAP, and extension
installation are separate reviewed phases.

## Product Contract

### Visible Tools Must Be Real

Every visible extension tool must satisfy one of these states:

1. **Ready:** its manifest View Container contains at least one contributed view,
   the owning extension is runnable, and the host can activate the view.
2. **Starting:** activation is in progress and the tool shows a bounded loading
   state without blocking the editor.
3. **Unavailable:** activation failed or required API is missing; the tool opens
   diagnostics with the exact extension, view, error, and missing API.

An empty icon with no content, no action, and no reason is forbidden.

### Contribution Registry

Create a pure `buildVSCodeContributionRegistry()` adapter. Its inputs are the
normalized imported extension inventory and the latest host snapshot. Its output
is the only data source used by the VS Code sidebar for extension tools.

The registry:

- reuses `getVSCodeActivityEntries()` for manifest containers and fallback
  containers;
- preserves container id, title, icon, extension id/path, and ordered view ids;
- merges registered host view kind/status by view id;
- exposes per-extension `active`, `failed`, `skipped`, or `pending` diagnostics;
- suppresses command-only extensions from the activity navigation because they
  belong in Commands, not in an empty View Container;
- never treats manifest presence as proof that runtime activation succeeded.

### Host Activation Protocol

Add an `activate-view` request to the isolated extension host.

1. The frontend selects an extension container.
2. The store calls `activateView(viewId)` for the first unresolved view.
3. The host finds the owning extension and activates `onView:<viewId>`.
4. The extension registers a TreeView or WebviewView.
5. The host returns a refreshed snapshot containing `container` and `kind`.
6. The frontend resolves the registered view with the correct existing bridge.

Activation errors update the host extension state and are returned as structured
diagnostics. The editor remains mounted and usable throughout.

### Sidebar Navigation

The VS Code tools header contains built-in tools followed by manifest-backed
extension View Containers. The navigation is horizontally scrollable and each
button has a tooltip and stable width. Imported icons are not injected as unsafe
inline SVG; this phase uses a consistent extension-tool glyph while preserving
the original icon path in registry metadata for a later audited asset pipeline.

Selecting an extension tool opens a container panel that:

- shows all contributed views in manifest order;
- activates unresolved views lazily;
- renders TreeView/WebviewView through the existing components;
- preserves resolved webview sessions according to host options;
- shows exact activation or missing API diagnostics inline.

The generic Extensions tool remains the inventory and diagnostics surface. It is
not the only route to extension tools.

## Types And Boundaries

`VSCodeHostView` gains `container?: string`.

`VSCodeExtensionHostState` gains:

```ts
activateView(viewId: string): Promise<VSCodeHostSnapshot>;
```

The contribution registry returns:

```ts
interface VSCodeContributionRegistry {
  containers: VSCodeContributionContainer[];
  diagnostics: VSCodeContributionDiagnostic[];
}
```

No React component parses raw extension manifests. No Rust/Tauri command builds
UI structures. The extension host reports runtime truth; the pure registry merges
that truth with imported declarative metadata.

## Error Handling

- Host unavailable: keep manifest containers visible only in the Extensions
  diagnostics surface, not as apparently runnable activity tools.
- Activation failure: keep the selected container open and display the exact
  error/missing API with a retry action.
- View registered with unexpected kind: trust the refreshed host snapshot and
  use the matching resolver.
- View never registered after activation: report `unavailable`; do not fall back
  to embedding VS Code or opening an external window.
- Duplicate container/view ids: first normalized contribution wins and a
  diagnostic records the duplicate.

## Performance

- Registry construction is pure and memoized from extensions/snapshot.
- No extension is activated just to render the navigation.
- Only the selected unresolved view activates.
- Tree and webview payloads remain lazy.
- Code-file opening never waits for sidebar activation.

## Acceptance Criteria

1. A runnable extension with an `activitybar` View Container appears as a separate
   tool after the six built-in tools.
2. Clicking it activates `onView:<id>`, learns the registered view kind, and
   renders its TreeView or WebviewView in the Lattice sidebar.
3. Views contributed to built-in `explorer`, `scm`, or `debug` containers are
   attached to the corresponding built-in tool instead of duplicated.
4. Command-only extensions do not create empty activity icons.
5. Failed/skipped extensions show exact error and `missingApi` details in the
   Extensions diagnostics surface.
6. Host unavailable or activation failure never blocks editing, saving, file
   operations, search, or running code.
7. No normal user action creates a full VS Code Workbench tab or starts Code OSS.
8. Focused tests, typecheck, `npm run qa:gate`, Tauri bundles, and local release
   checks pass before handoff.

## Deferred Phases

- Extension enable/disable, trusted VSIX import, marketplace search/update.
- Git diff, stage/unstage, commit confirmation, branch and conflict workflows.
- Debug Adapter Protocol sessions, breakpoints, variables, call stack, console.
- Audited loading and theming of third-party Activity Bar SVG icons.


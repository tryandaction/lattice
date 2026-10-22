# Lattice VS Code Integrated Editor Sidebar Design

## Decision

Lattice keeps its own window frame, command bar, tabs, panes, research tools,
PDF/Markdown experiences, AI panel, and file model. VS Code compatibility is
integrated at two bounded surfaces:

1. the far-left VS Code activity icon opens a Lattice-owned left sidebar that
   hosts VS Code tools and imported extension contributions;
2. code and runnable files open in the normal Lattice pane using the existing
   high-performance editor and notebook surfaces with imported VS Code settings,
   language behavior, snippets, tasks, launch configurations, commands, and
   extension document activation.

The default workflow must never open or embed a complete VS Code Workbench page.

## Root Cause Of The Current Failure

- The VS Code activity button calls `openVSCodeWorkbenchInActivePane()` instead
  of selecting `activityView = "vscode"`.
- `renderDesktopSidePanel()` has no VS Code branch even though the settings type
  already includes the view.
- settings normalization discards a persisted `"vscode"` activity view.
- code, notebook, configuration, and text files are routed to a singleton
  `vscode-workbench` tab instead of normal file tabs.
- when that tab is active, the desktop layout intentionally collapses the
  Lattice sidebar and hides plugin and AI panels.
- the installed Code OSS runtime currently starts its ESM entry through a
  Windows verbatim `\\?\` path, producing `ERR_INVALID_FILE_URL_PATH`. This
  runtime failure is real, but fixing it would still preserve the wrong product
  architecture.

## Product Contract

### Activity Rail And Sidebar

- The far-left VS Code icon is always visible on desktop.
- Clicking it selects the VS Code activity view and opens the existing resizable
  Lattice sidebar. Clicking it again collapses that sidebar, matching the other
  activity icons.
- The sidebar contains compact tool navigation for Explorer, Search, Source
  Control, Run and Debug, Extensions, imported extension view containers, and
  a command launcher.
- Explorer and Search reuse Lattice's existing fast workspace implementations.
  Source Control and Run/Debug expose the capabilities already available in the
  current workspace and execution infrastructure. Unsupported capabilities are
  labelled honestly instead of opening a blank surface.
- Imported host-registered TreeView and WebviewView contributions render inside
  the sidebar. Selecting one does not replace or reload the active editor.

### Code And Runnable Files

- Code, configuration, text, `.tex`, and runnable files open as normal Lattice
  file tabs and render through `CodeEditorViewer`.
- `.ipynb` keeps the existing Lattice notebook editor and output model.
- Imported VS Code editor settings, keybindings, snippets, tasks, launch
  configurations, language associations, and extension inventory remain active.
- Opening a code document notifies the independent extension host when it is
  ready, allowing document-based activation without launching Code OSS.
- PDF, Markdown, Office, media, image, web, and research-document routes are
  unchanged.

### Extension Contributions

- The sidebar consumes only host snapshots and imported manifests; third-party
  extension code never executes in the React renderer.
- A TreeView resolves on selection and renders hierarchical items with command
  execution through the host bridge.
- A WebviewView resolves on first visibility, receives the existing sandbox and
  message bridge, and keeps its mounted session only when
  `retainContextWhenHidden` is requested.
- Host errors and missing API capabilities appear in a compact diagnostics
  section. A failed extension cannot masquerade as a working empty panel.
- Commands from active host snapshots are preferred; manifest commands remain
  visible as discoverable entries and report host readiness before execution.

### Native Workbench Boundary

- `NativeVSCodeWorkbenchPane` and the Code OSS server are removed from normal
  file routing and from the activity rail.
- Existing runtime code may remain temporarily as an internal diagnostic asset,
  but no standard user action may create a `vscode-workbench` tab.
- Release startup must not spawn Code OSS merely because a code file or the VS
  Code sidebar is opened.

### Current Capability Boundary (2026-07-18 Iteration)

- Explorer and Search are fully backed by Lattice's existing file and workspace
  implementations; they do not open a second VS Code window or ask the user to
  locate the file again.
- Source Control now reads the active Git repository through a hidden desktop
  backend command and displays branch, ahead/behind counts, and changed files.
  Staging, committing, checkout, and conflict resolution are deliberately not
  exposed yet because they are state-changing operations and require a separate
  reviewed command surface.
- Extensions can be imported from detected local VS Code profiles or manually
  rescanned from the sidebar. Runnable desktop extensions can expose commands,
  TreeViews, and WebviewViews through the independent host. Extensions that need
  unsupported VS Code APIs are shown with host status/error rather than being
  presented as working.
- Run and Debug executes imported shell tasks and supported Python launch
  configurations through Lattice's existing execution runner. It does not claim
  full VS Code debugger protocol parity.
- Commands are executable only when the independent extension host is ready;
  manifest-only commands remain discoverable and report host availability.

## Performance Rules

- Opening a code file performs normal file loading only; it does not start a
  server, create a child webview, poll HTTP, or wait for an extension scan.
- The extension host starts lazily when the VS Code sidebar becomes visible and
  imported runnable extensions exist.
- Tree and webview content resolve lazily per selected view.
- Sidebar navigation must preserve the mounted editor and current cursor/scroll
  state.
- Host failures must not block editing, saving, running, renaming, moving, or
  deleting files.

## Acceptance Criteria

1. Clicking the far-left VS Code icon opens a left sidebar and never creates a
   `VS Code` main-area tab.
2. Opening `.py`, `.ts`, `.tsx`, `.rs`, `.json`, `.yaml`, `.tex`, or other text
   code files immediately displays the Lattice code editor.
3. Opening `.ipynb` displays the Lattice notebook editor.
4. Explorer, Search, Run/Debug, Extensions, commands, and imported extension
   views are reachable from the VS Code sidebar.
5. A registered TreeView and WebviewView can resolve and interact through the
   existing desktop extension-host bridge without displacing the editor.
6. The current Code OSS HTTP 500 path cannot be reached through normal code
   opening or the VS Code activity icon.
7. Focused tests, typecheck, `npm run qa:gate`, desktop packaging, and local
   release refresh all pass before handoff.

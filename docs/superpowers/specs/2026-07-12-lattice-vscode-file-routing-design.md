# Lattice and VS Code Intelligent File Routing Design

## Objective

Make the Lattice Explorer the single file entry point while assigning each file to the product surface that handles it best. Lattice retains its document and media workflows. A single persistent real VS Code Workbench handles source code, configuration, notebooks, LaTeX, build files, debugging, terminals, and compatible code extensions.

The integration must not reload VS Code, recreate its native WebView, restart its Extension Host, or discard terminal and debugging state when the user selects another code-oriented file.

## Product Contract

### Lattice-owned files

Lattice opens these files in its existing native renderers:

- PDF and research annotation surfaces
- Markdown and MDX
- Word and PowerPoint documents
- images, audio, and video
- Lattice metadata and internal research artifacts

Markdown remains Lattice-owned because its live preview, formulas, citations, links, annotations, and research workflows provide a distinct advantage. Executable fenced blocks may expose an explicit `Open in VS Code` action, but opening a Markdown file does not automatically replace the Lattice view.

### VS Code-owned files

The real VS Code Workbench opens these files:

- programming source and header files
- `.ipynb` notebooks
- `.tex`, `.bib`, and LaTeX project/build files
- JSON, JSONC, YAML, TOML, XML, INI, and environment configuration
- shell, PowerShell, batch, command, and build scripts
- project manifests, lockfiles, Dockerfiles, Makefiles, and other code-tooling files
- unknown text files that Lattice has no specialized document renderer for

Unknown binary files continue through Lattice's unsupported/compatibility path. The routing policy is a pure centralized function and can be extended by imported VS Code language contributions without changing Explorer components.

### Compatibility boundary

Code extensions run in the real VS Code Web/Remote Extension Host with the installed VS Code Server version. Lattice does not emulate extension manifests or private `vscode` APIs on this path.

The supported contract is identical to VS Code Web/Remote compatibility for the same VS Code commit. Extensions that require Electron renderer internals, a local desktop UI Extension Host, or an unsupported API proposal remain unsupported and show VS Code's own compatibility or activation error.

## Architecture

### 1. Central file-routing policy

Add one pure routing module that returns one of:

- `lattice`
- `vscode`
- `unsupported`

Inputs are the normalized file name, extension, imported VS Code language associations, desktop availability, and whether VS Code integration is enabled. Explicit Lattice document/media ownership wins over imported language associations. Code, notebook, LaTeX, configuration, and tooling ownership routes to VS Code when the desktop runtime is available and enabled.

All Explorer file-open actions call one high-level `openWorkspaceResourceInPane` action. Low-level Lattice tab creation remains available internally but is no longer called directly by Explorer nodes.

### 2. Dedicated singleton Workbench tab

Introduce a dedicated `vscode-workbench` tab kind instead of representing VS Code as a generic web URL tab.

The tab has one deterministic identity per workspace across the entire layout. Repeated code-file selections activate the existing tab and update its pending resource request. Opening code in another pane moves or activates that same Workbench surface in the target pane; it never creates a second Workbench WebView.

The Workbench tab:

- owns one stable native WebView label
- keeps one authenticated Workbench URL for its lifetime
- bypasses the generic WebViewer URL toolbar and navigation controls
- is hidden when a Lattice document tab is active and shown again without remounting
- is destroyed only when explicitly stopped, the workspace changes, the tab is closed, or Lattice exits

VS Code's internal primary sidebar is collapsed after bridge activation so the Lattice Explorer remains the main directory tree. Users can reopen VS Code's sidebar for extension views, Source Control, Search, Testing, or debugging when needed.

### 3. Lattice bridge extension

Bundle a small workspace Extension Host extension with Lattice. Load it into the Workbench through VS Code's supported startup payload `extensionDevelopmentPath`; do not copy it into or modify the user's `.vscode/extensions` directory.

The extension declares workspace execution and activates on startup. It uses stable VS Code APIs:

- `vscode.workspace.openTextDocument`
- `vscode.window.showTextDocument`
- `vscode.workspace.openNotebookDocument`
- `vscode.window.showNotebookDocument`
- `vscode.commands.executeCommand` only for documented workbench commands

The extension exposes a loopback HTTP bridge. Tauri chooses the port, generates a random token, passes both through the owned VS Code Server process environment, and validates the extension's health before sending commands.

Supported requests are:

- `health`
- `openTextDocument` with path and optional line/column
- `openNotebookDocument` with path
- `focusWorkbench`
- `closePrimarySidebar`

Every request has a monotonically increasing request ID and returns an explicit success or error response. The bridge binds only to `127.0.0.1`, requires the random bearer token, limits request size, and rejects paths outside the canonical active workspace.

The bridge never exposes arbitrary VS Code command execution from the frontend.

### 4. Open-resource data flow

1. The user selects a file in Lattice Explorer.
2. The centralized routing policy chooses Lattice or VS Code.
3. Lattice-owned files follow the existing file-tab and renderer path.
4. VS Code-owned files activate or create the singleton Workbench tab.
5. If the Server or bridge is still starting, the store keeps only the latest pending resource request.
6. Once ready, Tauri sends the canonical file path to the bridge.
7. The bridge opens the document through the real VS Code API and acknowledges the request.
8. Lattice clears the pending state only after the acknowledgement.

Rapid file selections are coalesced. Superseded requests are not sent after a newer request exists.

## User Experience

### Normal operation

- Selecting a document opens a normal Lattice tab.
- Selecting code, configuration, `.ipynb`, or `.tex` activates the same Workbench tab and opens the selected resource inside VS Code.
- VS Code maintains its internal editor tabs, terminals, debug sessions, language servers, notebook kernels, and extension state.
- Switching back to a document only hides the Workbench WebView.
- The VS Code activity button focuses the singleton Workbench and shows concise runtime diagnostics; it does not create a new WebView.

### Startup

Cold startup uses the existing contacting/downloading/installing/starting phases. The requested file name is visible while waiting. When the bridge becomes healthy, the latest requested resource opens automatically.

No blank Workbench is shown before both the Workbench and bridge are ready.

### Failure and recovery

- If VS Code is disabled or unavailable, source text falls back to Lattice's CodeMirror editor with a clear degraded-mode status.
- If the Server is running but the bridge is unavailable, Lattice retries the bridge health check with bounded backoff while preserving only the latest file request.
- If the bridge returns a path or open error, Lattice keeps the Workbench alive and offers retry or Lattice fallback; it does not reload VS Code.
- If the native WebView process fails, Lattice shows an explicit recovery action. Automatic recovery may recreate the WebView once, but repeated failures stop and surface diagnostics.
- Workspace changes terminate the old owned Server and bridge before starting the new workspace runtime.

## Performance Requirements

- A warm code-file switch must not navigate the Workbench URL or change the native WebView label.
- A warm request should receive a bridge acknowledgement within 300 ms under normal local load.
- The Workbench WebView mount count remains one for repeated file selections in the same workspace.
- Rapid selections are coalesced within 100 ms and only the newest resource is opened.
- Opening a Lattice document must not stop the VS Code Server, Extension Host, terminal, notebook kernel, or debug session.
- Cached Server startup retains the current under-20-second expectation; first-time Server preparation retains the honest 1-8-minute expectation.

## State Ownership

- `VSCodeWorkbenchState` in Tauri owns the Server process, bridge token/port, workspace path, readiness, and elapsed startup state.
- A focused frontend workbench store owns the latest pending resource request and the stable Workbench tab identity.
- The workspace layout owns whether the Workbench tab is active, but it does not own Server lifecycle or bridge transport.
- The bridge extension owns only VS Code editor/notebook actions and reports; it does not manage Lattice layout.

## Security

- Server and bridge bind only to loopback.
- Server and bridge use independent random tokens.
- Authenticated URLs and bridge tokens are never persisted or logged.
- Tauri canonicalizes workspace and resource paths before dispatch.
- The bridge independently rejects resources outside the active workspace.
- Bridge commands are an allowlist; arbitrary command IDs and code execution are not accepted.
- Lattice manages and terminates only processes it started.

## Testing Strategy

### Unit and store tests

- routing matrix for Lattice, VS Code, imported associations, unknown text, and unknown binary files
- singleton Workbench tab reuse across repeated code-file selections
- document-to-code-to-document transitions without Workbench destruction
- latest-request-wins behavior for rapid selections
- fallback behavior when desktop or integration is unavailable

### Bridge and backend tests

- secure Server arguments and bridge environment propagation
- token enforcement and request size limits
- canonical in-workspace path validation, including Windows case handling and traversal rejection
- text document and notebook request serialization
- bridge readiness, timeout, retry, process exit, and workspace-switch cleanup

### Component tests

- dedicated Workbench surface has no generic browser toolbar
- startup overlay includes the pending file name
- ready state focuses the existing Workbench tab
- error state keeps retry and Lattice fallback usable

### Runtime acceptance

- select Python, TypeScript, Rust, JSON, `.ipynb`, and `.tex` from Lattice Explorer
- confirm each opens in one unchanged Workbench WebView
- confirm Explorer selection causes no Workbench URL navigation or page reload
- confirm language completion, diagnostics, formatting, terminal, Run and Debug, and notebook kernel UI remain available
- confirm compatible installed code extensions activate in the real Extension Host
- switch repeatedly between PDF/Markdown and code while preserving terminal and extension state
- measure warm file-switch latency and rapid-selection coalescing

## Release Gate

Focused tests must pass before the full repository gate. Stage close requires:

- TypeScript typecheck
- focused Vitest and Rust tests
- `npm run qa:gate`
- real desktop and Playwright acceptance against the built binary
- local `releases/v2.3.1` refresh through the canonical release script

No Git commit, push, remote deployment, or application installation is part of this work.

# VS Code Compatibility Implementation Plan

## Current Product Goal

Lattice should keep PDF, Markdown, HTML, annotations, formulas, links, AI evidence, Quantum Keyboard, and sub-document workflows as its home field. For executable code files and notebooks, importing VS Code should make the browsing and editing surface feel like a professional VS Code-style workbench instead of a generic document viewer.

## 2026-07-20 A2.1 Native Debugging Baseline

The shipped native surface now has a real, bounded Python debugging path. A
Python `launch` entry with exactly one `program` or dotted `module` target can
start `debugpy.adapter` through a direct Tauri process, set file breakpoints,
stop and continue, step over/into/out, inspect threads/call stack/scopes and
variables, evaluate an expression in the selected frame, and stream bounded
debug output. The Run and Debug icon is a persistent Lattice activity-bar tool;
it opens a native sidebar and does not replace Lattice's surrounding workspace
with a second VS Code window.

Opening a supported code file keeps Lattice's native CodeMirror editor while
adding VS Code-style breakpoint gutters, verified markers, active-frame
highlighting, launch controls, and navigation from a stopped stack frame. The
workspace file is already the active Lattice document; the user does not need
to reopen a folder inside another workbench.

The boundary is intentional: local Node program launches now use the pinned
vscode-js-debug runtime, while remote attach, browser/terminal launches,
child-process or worker multi-session debugging, advanced breakpoint
conditions/logpoints, and arbitrary extension-provided debug adapters are not
implemented. `stopOnEntry` is forwarded to debugpy but is not advertised as a
reliable first-stop guarantee on every local Python/debugpy version; a line
breakpoint is the deterministic supported stop mechanism.

## Implemented Baseline

### 2026-07-21 Direct Language Provider Bridge

- The desktop Host now invokes extension-registered Completion, Hover,
  Definition, Diagnostic, Reference, Formatting, Rename, and CodeAction
  providers through a versioned request protocol.
- CodeMirror consumes completion, hover, definition navigation, and diagnostics
  directly. References merge into the existing dock; formatting, current-file
  rename, and current-file Quick Fix use validated TextEdit/WorkspaceEdit data.
- Code documents open without waiting for extension activation. Matching
  `onLanguage` extensions warm in the background through a deduplicated promise;
  the first feature request joins the same activation instead of starting it
  twice.
- Provider calls time out after 1.2 seconds, errors are isolated per provider,
  stale document versions are discarded, and workspace paths are validated.
- Multi-file Rename/CodeAction edits remain rejected. Extensions that depend on
  Language Client or separate language-server processes still require P2 LSP
  routing and are not reported as compatible merely because their manifest is
  visible.

- One-click desktop import from local VS Code and VS Code Insiders profiles.
- Import of `settings.json`, `keybindings.json`, user snippets, `.vscode/tasks.json`, `.vscode/extensions.json`, and installed extension inventories.
- Mapping for editor options, file associations, file/search excludes, snippets, formatter identity, `workbench.colorTheme`, tasks, and common runner hints.
- Installed extension contribution scanning for:
  - `contributes.languages`
  - `contributes.snippets`
  - `contributes.commands`
  - `contributes.views`
  - `contributes.viewsContainers`
  - `contributes.menus`
  - `contributes.notebooks`
  - `contributes.notebookRenderer`
  - `contributes.grammars`
  - `contributes.themes`
  - `contributes.debuggers`
  - `contributes.configuration`
- A bounded VS Code-compatible coding surface for executable code files, read-only code browsing, editable `.ipynb`, and read-only `.ipynb`; native Lattice editors remain the primary content surface and add compact language, formatter, kernel, and problem status.
- A dedicated VS Code extension workbench exposes Host-registered views in a full-height session-aware viewport. Host lifecycle diagnostics and command inventory are secondary to the active view.
- The desktop Host invokes explicit and contribution-derived `onCommand`, `onView`, and debugger activation events for compatible extensions. Document-driven language and notebook activation is limited to supported coding-agent extensions; Python and Jupyter continue through Lattice's native code and Notebook workflows rather than an incomplete VS Code workbench shim.
- `Open in VS Code` remains a desktop handoff action when the local command is available.
- The desktop P0.5 host bridge now supports a constrained runtime surface for command-capable extensions:
  - `commands.registerCommand`
  - `commands.executeCommand`
  - `window.showInformationMessage` / `showWarningMessage` / `showErrorMessage`
  - `workspace.workspaceFolders`
  - `workspace.getConfiguration()`
  - `extensions.getExtension()` / `extensions.all`
  - `Disposable`
  - `EventEmitter`
  - explicit and contribution-derived activation on `*`, `onStartupFinished`, `onCommand`, `onView`, `onLanguage`, `onNotebook`, and debugger events
- Imported VS Code tasks can run through the Lattice Run panel where supported.
- Imported VS Code theme contributions retain `label`, `id`, `uiTheme`, and `path`; the active `workbench.colorTheme` is surfaced in Settings and the code workbench.
- Supported VS Code workbench commands such as search, tasks, extensions, debug/source-control, and notebook execution commands route to the matching Lattice workbench panel. Extension-private commands enter the UI only after the Host registers them.
- Extension metadata is classified as runnable, command-capable, view-capable, debug-capable, notebook-capable, grammar/theme-only, or inventory-only; that classification never substitutes for Host registration.
- Compatibility diagnostics show per-extension activation state, error text, and explicitly detected missing shim APIs.
- The Run & Tasks panel groups imported VS Code tasks into default, build, test, and other sections, with default tasks visually marked.
- The desktop Source Control panel resolves the actual repository root, separates merge/staged/working changes, opens changed files in Lattice, renders bounded staged or working diffs, stages/unstages paths or all changes, and creates a local commit only after explicit confirmation. Git runs through fixed Tauri commands without a shell; remote, discard/reset, branch mutation, merge/rebase, and credential workflows remain out of scope.

## Professional Completion Criteria

### P0: Shipped Compatibility Layer

This phase is now implemented.

- Import must be one-click and require no manual JSON file selection.
- Imported settings must be opt-in and not slow down folder opening by default.
- Opening executable code files after import must preserve the Lattice code editor and notify the Host with the document language.
- Opening `.ipynb` after import must preserve native cells and output rendering without activating unsupported VS Code Notebook UI services.
- Imported extension capabilities must be visible as structured capabilities, not just extension counts.
- Lattice document-first surfaces must stay unaffected for PDF, Markdown, HTML, annotations, formulas, links, and AI evidence.
- Command-capable desktop extensions should be able to activate without immediately failing on the most common VS Code utility APIs.

### P1: Near-Term Hardening

- Add command palette integration for imported extension commands beyond the current Workbench Surface command routing.
- Add command palette entry points for the existing mapped/detected/external capability filters.
- Add per-language formatter routing for imported formatter IDs where a local formatter is available.
- Add richer workspace-level task execution history and last-run status for grouped VS Code tasks.
- Add richer Notebook cell status items based on kernel/runtime state.
- Add telemetry-free local diagnostics explaining why a VS Code extension is listed, mapped, or not executable.

### P2: Remaining Host Scope

- Expand the constrained Host API only when a real locally installed extension reports a concrete missing shim API.
- Implement Language Server Protocol routing for extensions that depend on
  `vscode-languageclient` or external servers such as Pylance, Rust Analyzer,
  ESLint, and Volar.
- Add debugger-contribution routing beyond the native local Python/debugpy and
  Node/js-debug program-launch paths, including remote attach, browser targets,
  terminal launches, and general multi-session lifecycle management.
- Add a permissions and trust model before running third-party extension code beyond the local, user-imported desktop host.
- Add separately reviewed remote Git, branch, conflict-resolution, and history workflows; the shipped local SCM layer intentionally exposes none of these operations.

## Non-Goals For The Current Layer

- Do not execute arbitrary VS Code extension JavaScript inside the renderer.
- Do not claim full Pylance, ESLint, Rust Analyzer, Volar, debugger, or webview
  parity without separately verified Language Client/service routing.
- Do not let VS Code compatibility override Lattice's PDF/Markdown/document workflows.

## Verification Gates

- Focused VS Code compatibility tests must cover storage, mapper, status, Surface UI, Jupyter renderer, and code editor integration.
- `npm run typecheck` must pass.
- `npm run test:docs` must pass after documentation updates.
- `npm run build` must pass before updating desktop artifacts.
- `npm run tauri:build` and `release:prepare` are required before claiming the desktop product was refreshed.

# Lattice Code OSS Desktop Shell Migration Design

## Status

- Product direction approved: 2026-07-17
- Development branch: `main`, by explicit product-owner instruction
- Remote deployment, Git commit, and Git push: out of scope unless separately requested
- Release target: local Windows desktop artifacts under `releases/v2.3.1`

## Decision Summary

Lattice will stop treating VS Code as a web application embedded inside the existing Tauri workspace. The desktop product will become a pinned Code OSS desktop distribution. Code OSS owns the primary window, activity bar, editor groups, terminal, source control, testing, debugging, notebooks, extension host, and extension management. Lattice research capabilities are integrated into that Workbench through built-in extensions, custom editors, webviews, and a local core service.

The existing Tauri application remains available only while features are migrated. It is not the final desktop shell. The code-server iframe, polling lifecycle, loopback Workbench bridge, and manual `extensions.json` mutation are transitional code and must be removed from production before release acceptance.

## Evidence For The Decision

The current implementation cannot meet the requested Cursor or Trae class of behavior because:

1. Code OSS runs through code-server and is rendered in an iframe inside a separate Lattice layout.
2. Lattice and Code OSS both render explorers, activity controls, tab systems, and side panels.
3. Desktop-only extension behavior is not equivalent to the Code OSS web/server target.
4. Extension import creates directory junctions and writes registry records instead of using the native extension-management service.
5. Startup depends on a local HTTP endpoint, readiness polling, and a second bridge health check.
6. Child process stdout and stderr are discarded, so failures become timeouts instead of actionable diagnostics.

These are architectural constraints, not isolated UI defects.

## Product Goals

1. Present one desktop IDE window with a persistent Lattice activity-bar entry.
2. Open the current workspace and requested code file directly, without another folder picker.
3. Run compatible VS Code extensions in the real desktop extension host.
4. Provide native Code OSS editing, terminals, tasks, tests, debugging, Git, notebooks, Problems, Output, and editor groups.
5. Preserve Lattice PDF reading, annotation, notes, citations, research objects, AI workflows, and experiment records.
6. Keep warm navigation immediate and cold startup within a bounded, measured budget.
7. Produce a reproducible Windows installer from pinned upstream source and repository-owned overlays.

## Non-Goals

1. Redistribute Microsoft's proprietary Visual Studio Code product or trademarks.
2. Promise compatibility with extensions whose licenses or services restrict them to Microsoft distributions.
3. Reimplement the VS Code extension API in Lattice.
4. Keep the Tauri window as a second permanent desktop shell.
5. Vendor the complete Code OSS source tree into this repository.
6. Change Lattice document behavior before an equivalent integrated surface is available.

## Target Architecture

### 1. Reproducible Code OSS Distribution

The repository owns a small overlay under `desktop/code-oss/`. A source contract pins:

- upstream repository: `https://github.com/microsoft/vscode.git`
- tag: `1.128.0`
- commit: `fc3def6774c76082adf699d366f31a557ce5573f`
- product identity and data-folder names
- Open VSX endpoints
- built-in Lattice extensions
- checksums for generated release inputs

Preparation scripts clone the pinned commit into `.lattice-build/code-oss/source` and keep that checkout immutable and clean. On Windows, all generated build state lives under the physical short path `C:\lb\LatticeCodeOSS`: its detached worktree is `C:\lb\LatticeCodeOSS\build-source`, and its tools, logs, staging data, overlay manifest, and distribution are siblings beneath the same owned root. A repository ownership marker prevents reuse by another checkout. Directory junctions are explicitly insufficient because Node resolves them back to the whitespace-containing physical repository path before upstream `node-gyp.cmd` invocations. Non-Windows builds may keep generated state under `.lattice-build/code-oss`.

Builds run only from the generated worktree. This keeps upstream verification independent from product patching, makes failed overlays disposable without touching the source baseline, prevents a multi-gigabyte vendor snapshot from obscuring Lattice changes, and guarantees Windows child-process command paths do not contain whitespace.

### 2. Code OSS Desktop Main Process

The Code OSS Electron desktop entry point owns the product window and lifecycle. The product name, application name, protocol, user-data folder, icons, and extension gallery are Lattice-specific. The product must not display Microsoft Visual Studio Code branding.

The default window opens the selected Lattice workspace. Code files use normal Code OSS editors. Research files use Lattice custom editors or commands contributed by built-in extensions.

### 3. Built-In Lattice Workbench Extension

`desktop/code-oss/extensions/lattice-workbench` is shipped as a built-in extension. It contributes:

- a permanent Lattice activity-bar view container
- Research, Documents, Notes, Experiments, and AI views
- commands for opening Lattice objects and sending editor context to Lattice
- custom editors for supported research document types where a native Code OSS editor is not appropriate
- URI handlers for file and research-object navigation
- a profile-import command and migration status view

The extension uses supported stable VS Code APIs. Proposed APIs require an explicit product configuration entry and a test proving why the stable API is insufficient.

### 4. Lattice Core Service

The existing Rust/Tauri backend contains useful native capabilities, but the final product does not need a second Tauri window. Native functionality is extracted behind a headless `lattice-core` process with a narrow authenticated IPC contract.

The core service owns operations that do not belong in an extension host:

- native PDF processing and file conversion
- long-running research jobs
- local model and tool orchestration
- data migration and indexed research storage
- capabilities that require existing Rust libraries

The Workbench extension starts one owned service per application session. The service binds to a private local transport, emits structured logs, and terminates with the parent process.

### 5. Research Webview Bridge

Reusable React surfaces are built as static webview assets. They communicate with the extension through `acquireVsCodeApi().postMessage` and typed messages. They never call Tauri APIs directly.

The bridge has four layers:

1. Webview UI sends a typed request.
2. The built-in extension validates the request and workspace identity.
3. The extension handles native VS Code operations directly or forwards a permitted operation to `lattice-core`.
4. Results return through a correlated response or event message.

Every request has a schema, request ID, timeout policy, cancellation behavior, and user-visible error state.

### 6. Workspace And File Identity

Code OSS workspace URIs are the source of truth for open folders and code resources. Lattice research objects store canonical workspace-relative references rather than separate display paths.

Opening a code file follows one path:

1. Resolve the canonical `vscode.Uri` inside the active workspace.
2. Call `workspace.openTextDocument` or `workspace.openNotebookDocument`.
3. Call the matching `window.show*Document` API with the requested selection.
4. Acknowledge only after the editor is visible.

No HTTP bridge, iframe navigation, or second workspace selection is involved.

### 7. Profile And Extension Migration

Migration is explicit, previewable, and transactional.

Settings, keybindings, snippets, UI state, and profiles are imported through a migration service with backups. Extensions are resolved by identifier and compatible version, then installed through Code OSS extension-management commands. Existing VS Code extension directories are never mounted or modified.

Each extension receives one result:

- installed
- already installed
- incompatible engine
- incompatible platform
- unavailable in the configured registry
- restricted by distribution or license
- failed with an actionable log reference

Open VSX is the default registry. Local VSIX installation is supported. Microsoft-specific extensions are not silently copied when their license or service contract prevents redistribution or execution in Code OSS.

## Process Model

```text
Lattice Code OSS desktop
  |-- Electron main/shared processes
  |-- renderer Workbench
  |-- desktop extension host
  |     |-- lattice-workbench built-in extension
  |     `-- compatible user extensions
  `-- lattice-core owned native service
```

There is no local code-server process in the accepted product.

## Startup And Performance Budgets

- Main window first meaningful paint: p95 <= 3 seconds on the supported reference machine.
- Workspace restored and Explorer interactive: p95 <= 5 seconds.
- Built-in Lattice activity entry visible at first Workbench paint.
- Warm code-file open acknowledgement: p95 <= 150 milliseconds.
- Warm Lattice research view reveal: p95 <= 250 milliseconds.
- `lattice-core` starts lazily unless startup-critical data is required.
- Extension migration and indexing never block first Workbench paint.
- No 250 ms continuous polling loop is permitted.

Phase timings are written to local structured logs without file contents, tokens, or full personal paths.

## Reliability And Diagnostics

- Every owned process writes rotating structured logs.
- Process exit records executable, phase, exit code, and sanitized stderr.
- Startup uses events and process handles, not HTTP readiness heuristics.
- A crashed research webview can reload without restarting the Workbench.
- A crashed `lattice-core` can restart once and restore idempotent state.
- Extension migration uses staging and rollback.
- The product never displays an endless spinner. Each bounded operation transitions to success, retryable error, or terminal error.

## Security

- Trust Code OSS workspace-trust decisions for task, terminal, debug, and extension execution.
- Validate every webview message and core-service request.
- Restrict file operations to active workspace roots or explicit user-selected files.
- Use CSP nonces and resource roots for every webview.
- Keep the native service transport local and authenticated with per-session credentials.
- Redact credentials and personal paths from logs.
- Do not bypass extension signature, license, or platform checks.

## Migration Roadmap

### Phase 1: Desktop Distribution Foundation

Pin upstream Code OSS, create the reproducible checkout/build overlay, define Lattice product metadata, and ship a minimal built-in extension with a persistent activity-bar entry. Produce a development desktop build that opens a workspace and a code file without Tauri or code-server.

Exit criteria:

- upstream commit validation passes
- product metadata contains no Microsoft branding
- built-in extension is present in the built distribution
- the Lattice activity entry is visible
- Explorer, editor, terminal, source control, run/debug, and Extensions views are native Code OSS surfaces

### Phase 2: Core Service Extraction

Split native operations from the Tauri window into a headless service and typed client. Add lifecycle ownership, authentication, structured logs, and focused native tests.

Exit criteria:

- service starts without a console window
- extension can health-check and stop the owned service
- representative file and PDF operations pass through the typed client

### Phase 3: Research Workbench Integration

Add Lattice Research views, reusable webview assets, workspace state, file tree integration, PDF/document commands, notes, annotations, citations, and bidirectional navigation.

Exit criteria:

- Lattice activity entry opens useful research views
- a PDF or research object opens without launching the old Tauri window
- code selections can create or update a Lattice research reference

### Phase 4: Profile And Extension Migration

Implement profile discovery, preview, transactional settings migration, extension resolution, native installation, progress reporting, and compatibility diagnostics.

Exit criteria:

- settings, keybindings, snippets, and themes migrate with backup
- compatible test extensions install, activate, contribute commands, and persist after restart
- incompatible and restricted extensions receive truthful reasons

### Phase 5: Coding And Notebook Workflows

Verify terminals, tasks, launch configurations, tests, Git, debugging, notebooks, language servers, formatters, webviews, and experiment handoff.

Exit criteria:

- Python and TypeScript reference workspaces support edit, run, debug, test, and terminal workflows
- a notebook opens and executes through a compatible extension stack
- Lattice experiment records can reference code, environment, and output

### Phase 6: Legacy Removal

Remove production iframe/code-server paths, custom extension-host emulation, duplicate VS Code compatibility UI, obsolete settings, runtime resources, and dead release scripts.

Exit criteria:

- no code-server package or Workbench iframe ships
- no duplicate Lattice and Code OSS Explorer appears
- no black console window or polling timeout path remains

### Phase 7: Release Qualification

Run focused tests, full QA, clean-profile installer tests, desktop E2E, extension activation tests, performance measurements, crash recovery, and release packaging.

Exit criteria:

- all acceptance scenarios pass from a clean Windows profile
- release checksums match the built artifacts
- `releases/v2.3.1` contains only the qualified desktop product

## Release Acceptance Matrix

The migration is complete only when every item below has executable evidence:

1. The first window is the Lattice-branded Code OSS Workbench.
2. The Lattice activity entry is always present and opens working views.
3. Selecting a code file opens it directly in the native editor.
4. Native Explorer, Search, Source Control, Run/Debug, Extensions, Testing, terminal, Problems, Output, notebooks, and status bar work.
5. At least one theme, formatter, language server, debugger, test adapter, and webview extension activates and persists.
6. PDF reading, annotations, notes, citations, research AI, and experiment records remain available.
7. Code and research navigation is bidirectional.
8. Startup and warm navigation meet the defined budgets.
9. There is no nested Workbench, duplicate Explorer, endless connecting screen, or visible console flash.
10. The installer works without separately installed Visual Studio Code.

## Delivery Discipline

Each phase receives its own detailed implementation plan and TDD cycle. A phase is not complete because its unit tests pass; it must also satisfy its visible exit criteria. The local release directory is refreshed only after all phases and the repository quality gate pass.

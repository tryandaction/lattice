# Lattice Code OSS Workbench Integration Design

## Status

- Approved direction: bundled Code OSS Workbench with Open VSX
- Product owner approval: 2026-07-15
- Target product: Lattice desktop
- Existing `code-tunnel serve-web` integration: transitional only

## Objective

Lattice must provide code reading, editing, execution, debugging, terminal, source control, notebook, and extension behavior through a real Code OSS Workbench and extension host. The integration must preserve Lattice's document reading, PDF annotation, research notes, knowledge organization, and AI workflows.

The finished product must feel like one application. A file selected in Lattice opens at the requested location in the Code Workbench without asking the user to select a folder again. Code OSS owns code-oriented UI and runtime behavior; Lattice owns research-oriented UI and data.

## Non-Goals

- Reimplementing VS Code APIs in a custom Node shim.
- Shipping or depending on the proprietary Microsoft Visual Studio Code distribution.
- Using Microsoft Marketplace as an unlicensed default extension registry.
- Replacing Lattice's PDF, document, annotation, knowledge, or research workflows with Code OSS editors.
- Migrating the complete Lattice desktop shell from Tauri to Electron.

## Architecture Decision

### Desktop shell

Tauri remains the application shell and process supervisor. It starts and monitors a bundled, pinned Code OSS runtime as a sidecar. The Code OSS Workbench is presented inside the existing Lattice workspace only when a code tab is active.

Lattice does not start a new Code OSS process for each file. One managed runtime is reused for the active workspace. The Workbench iframe/webview remains mounted while Lattice tabs change so extension activation, editor state, terminals, and debug sessions survive navigation.

### Code OSS distribution

The release contains a reproducible Code OSS runtime assembled by a repository script. The runtime version, commit, checksums, extension registry configuration, and applied Lattice patches are recorded in a machine-readable manifest.

The runtime is stored outside the main Tauri binary as a desktop resource so release preparation can validate its contents independently. Production startup never downloads a version-matched VS Code Server.

Open VSX is the default extension registry. Registry endpoints are configured through the Code OSS product configuration generated during resource preparation.

### Runtime profile

Lattice owns an isolated Code OSS profile under the Lattice application data directory:

- user data
- extensions
- logs
- workspace storage
- machine settings
- runtime cache

The profile is independent from `.vscode`. Import operations copy compatible extensions and selected settings into the Lattice profile; they never mutate the source VS Code profile.

### Process lifecycle

The Tauri backend owns a `CodeWorkbenchRuntime` service with explicit states:

`stopped -> starting -> workbenchReady -> bridgeReady -> ready -> stopping -> stopped`

Failures produce a typed error containing phase, command, exit status, log path, and retryability. The frontend receives state changes over Tauri events. Polling is used only as a bounded recovery mechanism when an event is missed.

On Windows, every sidecar and helper process is created without a console window. Graceful shutdown is attempted first; forced termination is used only after a bounded timeout during application shutdown.

## Integration Boundary

### Bundled Lattice Code extension

A bundled extension named `lattice.lattice-code-bridge` is installed into the isolated profile. It uses supported Code OSS extension APIs and provides:

- open document at line and column
- reveal workspace resource
- report active editor and selection
- report diagnostics and execution context needed by Lattice
- expose Lattice Research views inside the Code Workbench
- send code selections to Lattice notes, citations, and AI workflows
- open Lattice documents, PDFs, notes, and research objects in the host shell

The extension communicates with Tauri through an authenticated loopback service. The service binds only to `127.0.0.1`, uses a per-runtime random token, validates request schemas, and restricts file operations to the active workspace.

### Canonical workspace identity

Tauri is the source of truth for the active workspace path. Before starting Code OSS, it canonicalizes the path and assigns a stable workspace identity. Lattice and Code OSS exchange canonical file URIs rather than display paths.

Opening a code file follows this sequence:

1. Lattice activates or creates one Code Workbench tab.
2. The runtime starts only if it is not already available for the canonical workspace.
3. The Workbench becomes visible as soon as its URL is ready.
4. The bridge queues the latest file request and acknowledges it after `vscode.window.showTextDocument` succeeds.
5. Newer requests supersede older pending requests.

The user is never asked to select the workspace again.

### UI ownership

When the Code Workbench tab is active, Code OSS owns its activity bar, Explorer, Search, Source Control, Run and Debug, Extensions, Problems, Output, Terminal, editor groups, and status bar.

Lattice hides its duplicate activity rail, Explorer, plugin dock, and AI dock for that tab. The outer Lattice tab strip remains available for returning to documents and research views. Lattice layout preferences are not overwritten.

## Extension Strategy

### Installation and management

Extension installation, enablement, disablement, uninstall, activation, commands, webviews, language servers, themes, snippets, formatters, and debuggers run through the real Code OSS extension service.

Lattice does not execute third-party extensions through the existing custom extension-host shim. That shim is deprecated and removed after migration consumers are replaced.

### VS Code import

The importer scans detected stable and Insiders profiles, reads extension manifests, and builds an import plan. Each extension is classified as:

- compatible
- incompatible engine version
- unsupported platform or architecture
- missing runnable entry
- restricted distribution
- already installed
- requires manual review

Compatible extensions are copied atomically into a staging directory, verified, and then promoted into the Lattice profile. Failed imports leave the existing Lattice profile unchanged. Settings, keybindings, snippets, tasks, and launch configurations use separate previewable import steps.

Extensions that depend on Microsoft-only services or distribution terms are not silently copied. The UI explains the restriction and offers a compatible Open VSX alternative when one is known.

## Code Execution and Debugging

Code OSS owns integrated terminals, tasks, launch configurations, debug adapters, test adapters, problems, and output channels. Lattice code tabs do not route these operations through the lightweight Lattice runner.

The existing Lattice runner remains available for research workflows and reproducible one-shot calculations. A bundled command can transfer the active file, selection, environment metadata, and output reference between Code OSS and a Lattice experiment record.

Workspace trust gates terminal execution, tasks, debugging, and extension activation. Lattice mirrors trust state but does not bypass Code OSS trust decisions.

## Lattice Research Integration

The bundled bridge extension contributes a `Lattice Research` view container with focused views for:

- linked documents and citations
- notes and annotations related to the active file
- experiment and run records
- research AI context and proposed actions

Actions include sending a code selection to a note, attaching a source location to a citation, opening a linked PDF at its annotation, and bringing a Lattice research object into focus. Large document renderers remain in the Lattice shell and are not embedded as nested cards in Code OSS.

## Performance Requirements

- Warm Workbench visible: p95 at or below 2.5 seconds.
- Cold Workbench visible on supported hardware: p95 at or below 8 seconds.
- Warm file-open acknowledgement: p95 at or below 250 milliseconds.
- No production runtime download during first use.
- No continuous 250 ms status polling after event transport is connected.
- Switching between Lattice and Code tabs does not restart Code OSS.
- Extension import work runs outside the render path and reports progress.
- The default extension set is intentionally small to protect startup time.

Performance telemetry is local and records phase durations without file contents or personal paths.

## Security and Reliability

- Loopback-only authenticated bridge with per-runtime credentials.
- Strict allowed-origin and content-security policies.
- Canonical path checks for every resource operation.
- Isolated Code OSS user data and extension directories.
- Atomic extension import and rollback.
- Structured logs with token and path redaction.
- Extension-host or Workbench crashes do not terminate the Lattice shell.
- Runtime restart restores the workspace and replays only the latest pending resource request.

## Migration Plan

### Phase 1: reproducible Code OSS runtime

Add the pinned runtime manifest, preparation script, checksum validation, Tauri resource configuration, and local runtime discovery. Keep the current Workbench behind a legacy adapter during this phase.

### Phase 2: managed Workbench lifecycle

Introduce the runtime service, Tauri event protocol, isolated profile, hidden process launch, health diagnostics, and persistent frontend surface. Replace the current `code-tunnel` startup path.

### Phase 3: native extension bridge and file flow

Build the bundled Code OSS extension and authenticated bridge. Complete bidirectional file, editor, selection, workspace, and Lattice-object navigation. Remove HTTP readiness as a prerequisite for showing the Workbench.

### Phase 4: extension registry and import

Configure Open VSX, implement the import planner and transactional importer, and verify extension commands, webviews, language servers, formatters, themes, snippets, and persistence.

### Phase 5: execution and debugging

Verify terminal profiles, tasks, launch configurations, debug adapters, test adapters, Git, Problems, Output, and notebooks. Add Lattice experiment handoff commands.

### Phase 6: research integration and legacy removal

Ship the Lattice Research view container, complete cross-surface navigation, remove the custom VS Code API shim and legacy `code-tunnel` implementation, then clean transitional settings and documentation.

## Verification

Each phase requires focused unit and integration tests. The release gate additionally requires:

- production Next build and TypeScript validation
- Rust tests for lifecycle, profile, path, process, and import logic
- Code OSS extension tests using the extension test runner
- end-to-end desktop tests for cold/warm startup, file navigation, terminal, tasks, debugging, Git, notebook, extension install, extension webview, crash recovery, and Lattice research actions
- Windows checks proving no console window appears
- performance measurements against the stated p95 thresholds
- installer verification from a clean Windows user profile

The local desktop release is refreshed only after the repository QA gate passes. Remote deployment, Git commit, and Git push remain outside this work unless explicitly requested.

## Release Acceptance Criteria

The migration is complete only when all of the following are true:

1. Lattice runs without a separately installed Visual Studio Code.
2. Opening a code file never asks the user to choose the workspace again.
3. Code OSS Explorer, Extensions, terminal, tasks, run/debug, Git, Problems, and editor groups work in the integrated surface.
4. Compatible imported extensions activate in the real extension host and persist after restart.
5. Lattice document and research workflows retain their current behavior.
6. Cross-navigation between code and research objects is bidirectional.
7. Startup and file-open performance meet the stated thresholds.
8. No black console window, endless connecting state, duplicate Explorer, or silent import failure remains.
9. Transitional `code-tunnel` and custom extension-host implementations are removed from production paths.


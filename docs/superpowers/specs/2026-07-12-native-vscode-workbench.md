# Native VS Code Workbench Design

## Objective

Replace Lattice's simulated VS Code extension surface with the real VS Code Web Workbench backed by the locally installed VS Code Server. The integrated workbench must own code navigation, language services, terminals, tasks, debugging, webviews, and extension activation.

## Architecture

1. Tauri discovers the installed `code-tunnel` CLI that matches the user's VS Code installation.
2. Tauri starts `serve-web` on `127.0.0.1` with a random port, a per-process UUID connection token, telemetry disabled, and the current Lattice workspace as `--default-folder`.
3. Lattice polls the loopback endpoint. HTTP 202 is `preparing`; a successful Workbench response is `ready`; process exit or an invalid response is `error`.
4. The VS Code activity panel is a compact launcher and diagnostic surface. Once ready, it opens the authenticated loopback URL as a normal main-area web tab.
5. Desktop web tabs already use Tauri's native child WebView, so VS Code receives a full browser context without iframe CSP or `X-Frame-Options` failures.
6. VS Code itself decides whether an extension runs in the web or remote Node.js Extension Host. Lattice does not parse manifests or emulate `vscode` APIs on the primary path.

## Lifecycle

The host exposes `start`, `status`, and `stop` commands. A second start for the same live workspace is idempotent. Starting another workspace stops the managed process first. Closing the application terminates the managed server. The first server preparation can download a large version-matched package, so the UI must keep showing `preparing` with actionable detail instead of opening a blank tab.

## Security

- Bind only to `127.0.0.1`.
- Always require a random connection token; never use `--without-connection-token`.
- Validate that the requested workspace exists and is a directory.
- Do not log or persist the authenticated URL.
- Manage only the process spawned by Lattice.

## Product Behavior

- Clicking the VS Code activity opens a concise native-runtime panel.
- `Open VS Code Workbench` starts or reuses the server and opens the main-area tab when ready.
- The panel reports CLI discovery, preparing, ready, stopped, and error states.
- Browser-only Lattice builds explain that a local desktop host is required.
- The legacy compatibility inventory can remain available as diagnostics during migration, but it is not presented as a working extension host.

## Compatibility Contract

This integration provides the actual VS Code Web/remote runtime, not a promise that every desktop-only extension supports a web client. Unsupported extensions must show VS Code's own compatibility reason. Workspace extensions, language servers, terminals, tasks, debuggers, and webviews run only when supported by the installed VS Code version and the extension's declared host kind.

## Acceptance Criteria

- The current folder opens in the real VS Code Explorer.
- Source files open in the real VS Code editor with navigation and language features.
- Integrated terminal, Run and Debug, and task surfaces are present and usable.
- The Extensions view is VS Code's real view and activation errors come from VS Code.
- A supported installed extension can activate and render its contributed UI/webview.
- First-time download, process failure, retry, reuse, and application shutdown are handled without blank or orphaned views.


# Lattice Native Node js-debug Design

## Status

Approved by the user's standing instruction to continue the best implementation
after A2.1. This A2.2.1 slice adds a truthful local Node launch workflow without
claiming complete VS Code JavaScript debugging parity.

## Product Contract

For an imported `node` or `pwa-node` `launch` configuration with a workspace
program, the user can start a real Microsoft js-debug DAP session from the
existing Lattice Run and Debug sidebar. Breakpoints, stepping, stack frames,
scopes, variables, evaluation, output, restart, stop, and editor navigation use
the same native UI and state model already shipped for Python.

Lattice remains the application shell and CodeMirror remains the source editor.
The feature must not open a VS Code window, start a visible console, or require
the user to reopen the workspace.

## Adapter Source And Distribution

Lattice bundles Microsoft's official standalone `vscode-js-debug` DAP asset:

- repository: `microsoft/vscode-js-debug`;
- release: `v1.117.0`;
- asset: `js-debug-dap-v1.117.0.tar.gz`;
- size: `1,216,795` bytes;
- SHA-256: `ad8d04ede9d4b75cc290fd5438a65047a06f786d04f604b6112485b36f090772`;
- license: MIT, preserved as `js-debug/LICENSE` in the bundled resource.

The release is the current official stable standalone server and matches the
js-debug version bundled with the local VS Code 1.129.1 installation. A resource
preparation script downloads only this HTTPS GitHub release asset, verifies the
exact byte count and SHA-256 before extraction, rejects path traversal, and
checks that `js-debug/src/dapDebugServer.js` and `js-debug/LICENSE` exist.

Prepared resources live under:

```text
src-tauri/resources/vscode-js-debug/js-debug/
```

Tauri packages the directory. Runtime debugging never downloads code and never
loads an arbitrary adapter path from the renderer.

## Supported Launch Configuration

This slice supports only:

- `type`: `node` or `pwa-node`;
- `request`: `launch`;
- one `program` that resolves to a regular file inside the workspace;
- `cwd`, `args`, string `env`, `runtimeExecutable`, `runtimeArgs`;
- `stopOnEntry`, `sourceMaps`, `smartStep`, `skipFiles`, and `outFiles`;
- `${workspaceFolder}`, `${file}`, and `${fileDirname}` resolution.

`runtimeExecutable` defaults to `node`. The adapter itself always runs with a
trusted Node executable resolved by the backend; `runtimeExecutable` is passed
only as a js-debug launch option for the debuggee. Environment payloads reuse
the existing 128 KiB and 512-entry bounds. Program, cwd, and breakpoint sources
must remain inside the canonical workspace. Glob patterns are bounded strings,
cannot contain NUL, and cannot escape through `..` path segments.

The backend sends an internal-console launch with
`autoAttachChildProcesses: false`. The standalone server still uses one
`startDebugging` reverse request to bind the launched root target to a second
internal DAP connection. Lattice handles only that bounded handshake; it does
not expose the target connection or arbitrary reverse commands to the renderer.

## Explicit Non-Goals

A2.2.1 does not support:

- `attach`, process pickers, or remote inspector endpoints;
- Chrome, Edge, WebView2, Deno, Electron, or extension-host targets;
- `node-terminal` and integrated/external terminal consoles;
- npm/yarn/pnpm command launches without a concrete program;
- child-process or worker multi-session debugging;
- compound configurations;
- extension-provided adapter descriptor factories;
- conditional, hit-count, log, function, instruction, or data breakpoints.

Unsupported configurations remain ordinary Run actions when Lattice can run
them, with an exact unsupported-debug explanation in the UI.

## Resource Preparation

Create `scripts/prepare-js-debug-resources.mjs` plus a pinned descriptor JSON.
The script uses structured archive inspection instead of trusting file names.
It extracts into a temporary sibling directory, validates the expected layout,
then replaces the generated resource directory. A failed download, size/hash
mismatch, invalid archive entry, or missing license leaves the previous valid
resource untouched and exits nonzero.

`prepare:desktop-resources` runs TypeScript and js-debug resource preparation.
Tests mock download bytes and archive listings; release builds additionally
exercise the real pinned asset.

## Rust Architecture

Keep `DapClient`, framing, response correlation, normalized events, queries, and
controls adapter-neutral. Generalize the process holder from Python-specific to:

```rust
struct StartedDebugSession {
    adapter: Child,
    client: Arc<DapClient>,
    adapter_label: &'static str,
}
```

Add `NodeDebugLaunchRequest` and `ValidatedNodeDebugLaunch`. The new Tauri
command is fixed and typed:

```text
desktop_start_node_debug_session
```

The command resolves the bundled server from the Tauri resource directory,
probes the backend Node executable with `node --version`, reserves a loopback
port, and starts without a shell or console window:

```text
node <resource>/js-debug/src/dapDebugServer.js <port> 127.0.0.1
```

The shared session slot remains single-session across Python and Node. All
existing control/query/stop commands continue to address the active session by
id. Error messages use the recorded adapter label rather than saying `debugpy`
for a Node session.

The protocol sequence remains initialize, begin launch, wait for initialized,
set file breakpoints, set exception breakpoints, configurationDone, then await
launch. The initialize request uses `adapterID: "pwa-node"`; launch uses
`type: "pwa-node"`, `console: "internalConsole"`, `__workspaceFolder`, and
`autoAttachChildProcesses: false`.

The root connection accepts `startDebugging` only when it contains a bounded
`__pendingTargetId` and `request: "launch"`. It reconnects to the same loopback
server, replays initialize/breakpoints/exception/configurationDone, and routes
queries and controls to the latest root-target client. Every other reverse
request receives a failure response with the same request sequence. No reverse
request may silently leave js-debug waiting forever.

## Renderer And Store

Extend the launch normalization model with the allowlisted Node fields. Add
`buildNodeDebugLaunchRequest()` next to the Python builder. It returns the same
supported/reason discriminated result and resolves the same workspace variables.

`src/lib/vscode-debug/desktop.ts` exports `NodeDebugLaunchRequest` and
`startNodeDebugSession()`. The Zustand store replaces its Python-only start
action with `startDebugging(request)` over a discriminated request union and
dispatches to the correct fixed Tauri command. All event, breakpoint, stack,
variable, evaluation, and control behavior remains shared.

The sidebar chooses Python or Node debug builders by launch type. A supported
Node configuration uses the existing BugPlay action. Unsupported Node launch
variants retain their ordinary Run action and truthful title.

## Performance And Cleanup

The official server is prepared at build time and loaded from local resources.
No network access occurs on debug start. The adapter connection uses the same
30-second failure ceiling added for cold Windows Python startup but proceeds as
soon as the port listens. Output remains capped at 1 MiB per adapter pipe and
1,000 renderer entries.

Disconnect sends `terminateDebuggee: true`, waits two seconds, then kills and
reaps the standalone server. A real smoke requires both the adapter and Node
debuggee to exit and the isolated temporary workspace to be removable.

## Testing And Acceptance

1. Resource script tests prove URL/version/hash/layout/path traversal handling.
2. Mapper/builder tests prove fields, variable resolution, and truthful rejects.
3. Rust tests prove Node validation, adapter arguments, root/target launch
   sequences, bounded `startDebugging`, reverse-request failure responses,
   shared single-session state, and cleanup.
4. Desktop/store/panel tests prove exact Tauri command payloads and real Node
   debug selection instead of ordinary Run fallback.
5. An opt-in real smoke launches a temporary JavaScript file, stops on a line
   breakpoint, reads a local value, evaluates an expression, continues, observes
   termination, and proves no adapter/debuggee or temporary directory remains.
6. Focused tests, typecheck, Rust checks, complete QA, Tauri build, release
   refresh, and independent checksums pass before the feature is reported as
   shipped.

## Remaining Boundary After A2.2.1

This slice provides real local Node root-process launch debugging, including the
standalone server's required internal root-target binding. Browser targets,
attach, terminal launches, child-process/worker multi-session routing, arbitrary
extension adapters, and advanced breakpoints remain separate reviewed phases.

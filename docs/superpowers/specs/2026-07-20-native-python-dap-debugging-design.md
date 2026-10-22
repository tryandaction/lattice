# Lattice Native Python DAP Debugging Design

## Status

Approved A2.1 scope. Lattice will add a native Debug Adapter Protocol (DAP)
client and complete one truthful Python debugging workflow before attempting
generic extension-provided adapters. The editor and sidebar remain Lattice UI;
Code OSS is not embedded.

## Product Contract

For a Python file or supported Python `launch.json` configuration, a user can:

1. add and remove line breakpoints from the Lattice code editor gutter;
2. start a real debug session without opening a terminal window;
3. stop on verified breakpoints and see the active source line;
4. continue, pause, step over, step into, step out, restart, and stop;
5. inspect threads, call stacks, scopes, and expandable variables;
6. inspect stdout, stderr, adapter messages, and exact failures;
7. evaluate an expression in the selected stack frame;
8. open a stack frame in the existing Lattice editor.

No control may be icon-only or simulated. Unsupported launch types remain
available as ordinary Run actions with an explicit explanation that real debug
support is not yet available.

## Explicit Scope

The first shippable adapter is Python `debugpy`, for local `launch` requests.
Supported launch fields are `program` or `module`, `cwd`, `args`, `env`,
`python`, `justMyCode`, `stopOnEntry`, and `subProcess`. Workspace variables in
path fields are resolved before the backend request.

The following are intentionally deferred to A2.2:

- Node/JavaScript debugging through `ms-vscode.js-debug`;
- arbitrary `DebugAdapterDescriptorFactory` execution;
- remote attach, process-id attach, containers, SSH, WSL, and browser targets;
- compound configurations and multi-session debugging;
- conditional, hit-count, log-point, function, and data breakpoints;
- extension-contributed debug configuration resolvers and trackers.

These deferred capabilities must not be presented as working in the UI.

## Architecture

### Rust DAP Core

Create `src-tauri/src/debug_adapter.rs`. It owns all adapter processes, TCP
connections, DAP framing, request sequencing, response correlation, session
state, timeouts, output bounds, and cleanup. The renderer never opens a socket
or launches a process.

Only one debug session is active in A2.1. `DebugAdapterState` holds the active
session behind an asynchronous mutex. A session owns:

```rust
struct DebugSession {
    id: String,
    workspace_root: PathBuf,
    adapter: Child,
    writer: OwnedWriteHalf,
    next_seq: AtomicI64,
    pending: Arc<Mutex<HashMap<i64, oneshot::Sender<DapResponse>>>>,
    lifecycle: Arc<RwLock<DebugLifecycle>>,
    reader_task: JoinHandle<()>,
}
```

The reader uses `Content-Length: <bytes>\r\n\r\n<json>` framing and accepts
headers case-insensitively. It rejects missing/invalid lengths, frames above 8
MiB, invalid UTF-8/JSON, and messages without a DAP `type`. Responses are routed
to pending request channels; events are normalized and emitted as
`debug://event` payloads.

Tauri exposes fixed commands rather than arbitrary DAP forwarding:

- `desktop_start_python_debug_session`
- `desktop_set_debug_breakpoints`
- `desktop_continue_debug_session`
- `desktop_pause_debug_session`
- `desktop_step_over_debug_session`
- `desktop_step_into_debug_session`
- `desktop_step_out_debug_session`
- `desktop_restart_debug_session`
- `desktop_stop_debug_session`
- `desktop_get_debug_stack_trace`
- `desktop_get_debug_scopes`
- `desktop_get_debug_variables`
- `desktop_evaluate_debug_expression`

Every command requires the active session id. Stale commands fail explicitly.
The renderer cannot choose an arbitrary DAP command or inject adapter flags.

### Python Adapter Launch

The backend resolves the configured interpreter and verifies it with a bounded
`import debugpy` probe. It reserves a loopback port, starts the adapter directly
without a shell, and connects with bounded retry:

```text
<python> -m debugpy.adapter --host 127.0.0.1 --port <ephemeral-port>
```

On Windows, child processes use the no-window creation flag. The adapter binds
only to `127.0.0.1`; no firewall-facing address is accepted. The port exists for
the short lifetime of the local session. Adapter stdout/stderr are captured and
bounded, never attached to a visible console.

The protocol sequence is:

1. connect to the adapter and send `initialize`;
2. send `launch` with the allowlisted configuration;
3. wait for `initialized`;
4. send `setBreakpoints` for each source and `setExceptionBreakpoints`;
5. send `configurationDone` and await the launch response;
6. on `stopped`, request threads and the selected thread stack;
7. request scopes and variables only while stopped;
8. on stop, send `disconnect` with `terminateDebuggee: true`, then force-kill
   the adapter after a bounded grace period.

Initialize/connect uses a 5-second deadline, ordinary requests use 10 seconds,
launch/restart/disconnect use 30 seconds, and shutdown gets a 2-second graceful
period. A failure at any stage terminates the adapter and clears active state.

### TypeScript Adapter And Store

Create `src/lib/vscode-debug/desktop.ts` as the only Tauri boundary. It defines
the renderer DTOs, command names, timeouts, desktop guards, and one event
subscription. React components do not call Tauri directly.

Create `src/stores/vscode-debug-store.ts` for user-visible state:

```ts
type DebugLifecycle =
  | "idle" | "starting" | "running" | "stopped"
  | "restarting" | "stopping" | "terminated" | "error";

interface VSCodeDebugState {
  sessionId: string | null;
  lifecycle: DebugLifecycle;
  breakpoints: Record<string, DebugBreakpoint[]>;
  threads: DebugThread[];
  stackFrames: DebugStackFrame[];
  selectedThreadId: number | null;
  selectedFrameId: number | null;
  scopes: DebugScope[];
  variablesByReference: Record<number, DebugVariable[]>;
  output: DebugOutputEntry[];
  error: string | null;
}
```

Breakpoints are persisted per workspace using canonical absolute source paths.
Session data is not persisted. The store ignores events from stale session ids
and unsubscribes once when the application shell is disposed.

### Editor Integration

Create `src/lib/vscode-debug/editor-extension.ts` as a focused CodeMirror 6
extension. It renders a stable breakpoint gutter and active-frame line without
recreating the editor. Gutter clicks call a supplied toggle callback; visual
markers are derived from store state through a StateEffect/StateField update.

`CodeEditorViewer` provides the canonical absolute path and installs the debug
extension only for runnable code files in the desktop build. When a DAP stack
frame points to another workspace file, the existing workspace open-file path
is reused, then the existing pending-navigation route scrolls to its line.

The active frame uses a restrained whole-line highlight. Verified breakpoints,
unverified breakpoints, and the current stopped line are visually distinct and
have accessible labels/tooltips.

### Run And Debug Sidebar

Extract `VSCodeRunDebugPanel` into its own component. It contains:

- a compact configuration selector;
- Start/Restart/Stop and Continue/Pause/Step controls using Lucide icons;
- truthful status and error text;
- Breakpoints, Variables, Watch/Evaluate, Call Stack, and Debug Console
  collapsible sections;
- expandable variables loaded lazily by `variablesReference`;
- stack frame buttons that navigate to the Lattice editor;
- ordinary tasks and non-Python run configurations in a separate Run section.

Control dimensions remain stable while state changes. Unsupported actions are
disabled with explicit titles. No nested cards or full VS Code Workbench frame
is introduced.

## Launch Configuration Rules

`VSCodeLaunchConfigurationDefinition` and the normalized model retain the
allowlisted Python options. `${workspaceFolder}`, `${file}`, and `${fileDirname}`
are resolved in the renderer using an explicit active file context. An
unresolved variable is an error, not a path string passed to Python.

For `program`, the canonical target must be inside the opened workspace and be
a regular file. For `module`, the value must match a dotted Python identifier.
`cwd` must remain inside the workspace. Interpreter and argument values are
passed directly to `Command`; no shell parsing occurs. Environment keys and
values are strings and the total environment payload is bounded.

## State And Error Contract

- `starting` ends only after configuration is accepted by the adapter.
- `running` never displays stale scopes or variables.
- `stopped` always identifies the stop reason and active thread/frame when the
  adapter provides them.
- a `terminated` or `exited` event clears stack/scopes/variables but preserves
  bounded session output until the next start or explicit clear action;
- adapter crashes, timeouts, invalid frames, unavailable `debugpy`, bad paths,
  and rejected requests expose exact sanitized errors;
- all event and output collections are bounded to prevent long sessions from
  degrading the workbench.

## Testing Strategy

Rust pure tests cover frame encoding/decoding, partial reads, multiple frames,
invalid/oversized headers, response correlation, stale sessions, path/module
validation, timeout cleanup, and event normalization. Async session tests use a
loopback fake adapter that asserts the exact initialize/launch/breakpoint/
configuration sequence and returns deterministic stopped/stack/scope/variable
data.

TypeScript tests cover command payloads/timeouts, non-desktop guards, event
subscription cleanup, launch normalization, variable expansion, stale-event
rejection, and breakpoint persistence.

React tests cover control enablement across every lifecycle, unsupported launch
truthfulness, breakpoint grouping, stack navigation, lazy variables, evaluation,
output/error rendering, and no duplicate starts.

CodeMirror tests cover gutter toggle behavior, verified/unverified markers,
active-line updates, disposal, and paths with spaces/Unicode.

A real smoke test creates a temporary Python script, starts the installed
`debugpy`, stops at a breakpoint, inspects a local variable, steps once,
continues to termination, verifies no child process remains, and deletes the
temporary directory. It never targets or mutates the Lattice repository.

## Acceptance Criteria

1. A Python file can stop on a real line breakpoint inside Lattice.
2. Continue, pause, step over, step into, step out, restart, and stop issue real
   DAP requests and maintain truthful lifecycle state.
3. Call stack, scopes, variables, evaluation, stdout, stderr, and failures are
   visible in the native left sidebar; stack navigation opens the correct file
   and line in the Lattice editor.
4. Starting, debugging, and stopping never open a console window or leave an
   adapter/debuggee process behind.
5. Node and unsupported extension debuggers are never labelled as working DAP
   sessions in A2.1.
6. Focused tests, typecheck, Rust tests/checks, full QA, desktop build, release
   synchronization, and artifact checksum validation all pass before handoff.


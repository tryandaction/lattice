# VS Code Compatible Coding Workbench

## Decision

Lattice will provide a desktop-only, VS Code-compatible coding workbench for
code files, notebooks, and locally imported VS Code extension views. It will
not claim to embed or replace the complete VS Code Desktop workbench.

## Problem Evidence

- The extension host starts successfully and registers real commands and
  views for installed Claude, Codex, Augment, Python, and Jupyter extensions.
- `VSCodeWorkbenchSurface` is intentionally transparent, so code and notebook
  routes do not receive a coding workbench layout.
- `VSCodeActivityPanel` is a diagnostics-first panel. It renders extension
  views in a fixed-height iframe and omits the lifecycle and option handling
  required by a VS Code webview.
- A WebviewView needs resource handling, script/form policy, a persistent
  `acquireVsCodeApi` object, bidirectional messages, and explicit visibility
  lifetime management. A manifest import alone cannot supply these.

## Product Contract

### Code And Notebook Surface

- Code and `.ipynb` routes keep Lattice's existing CodeMirror and notebook
  editors. No PDF, Markdown, image, or research-document route changes.
- `VSCodeWorkbenchSurface` becomes a bounded coding shell with an editor
  status bar. It exposes the current language, formatter, kernel, problem
  count, and host state without hiding the file content or duplicating the
  global Lattice navigation.
- The shell uses the same stable dimensions and visual density as a VS Code
  editor surface. It does not attempt to reproduce all VS Code menus.

### Extension Workbench

- The current `VSCodeActivityPanel` becomes an extension workbench rather
  than a command inventory. Its activity strip contains only extensions with
  host-registered views, ordered with coding-agent views first.
- Selecting an activity entry displays its first registered view immediately.
  Additional registered views are selectable from the sidebar header.
- Host status and command inventory move into a compact diagnostics disclosure
  so they do not occupy the primary workflow.
- A webview has a full-height, resizable viewport. It is not rendered inside a
  420px diagnostic card.

### Webview Runtime

- The Node host returns the webview options provided by an extension alongside
  its HTML. The renderer uses only supported options to set iframe sandbox
  policy and resource access behavior.
- A single injected bridge provides `acquireVsCodeApi()` state and forwards
  extension-to-host messages. Host-to-webview messages are delivered to the
  exact iframe session after it is ready.
- Resource rewriting remains local desktop-only and preserves every extension
  resource URI. CSP source replacement is limited to the local resource scheme
  used by the Lattice desktop preview protocol.
- Hiding a view keeps its iframe session mounted when the extension requested
  `retainContextWhenHidden`; otherwise Lattice disposes the session and asks
  the host to resolve it again when reopened.

## Supported Initial Verification Matrix

| Workflow | Required result |
| --- | --- |
| Claude Code sidebar | View opens in the full-height side pane, loads local assets, and exchanges messages with the host. |
| Codex sidebar | View can be selected and does not displace the active code editor. |
| Python file | Existing code editor opens with a language/status surface and sends a Python document activation event. |
| Jupyter notebook | Existing notebook editor and stored outputs remain intact; notebook activation is sent without claiming a kernel implementation. |
| Missing API | The view stays unavailable with the exact missing API/error displayed in diagnostics, never as an empty usable-looking pane. |

## Explicit Non-Goals

- Bundling Electron or embedding the full VS Code desktop workbench.
- Claiming full compatibility for arbitrary extensions, Language Servers, Debug
  Adapters, authentication providers, terminals, or Remote Development.
- Executing third-party code in the React renderer.
- Changing non-coding Lattice workflows.

## Acceptance Criteria

1. The default extension UI is a workbench with real host views, not a list of
   extension manifests, commands, or repeated fallback icons.
2. A resolved webview has no fixed diagnostic height and follows the declared
   script/form policy.
3. Every webview message has a stable view identifier; no message may cross
   from one extension view session into another.
4. The code and notebook status surfaces render only on coding routes.
5. Unit tests cover the bridge, host snapshot options, activity selection,
   session retention, and coding-shell boundaries.
6. The local Claude/Codex/Python/Jupyter smoke test and full release gate pass
   before `releases/` is refreshed.

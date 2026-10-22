# VS Code Compatible Coding Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the imported-extension diagnostics surface with a desktop coding workbench that can host supported VS Code WebviewViews and preserves Lattice's native code and notebook workflows.

**Architecture:** Keep the existing Tauri-managed Node extension host as the only process that executes imported extension code. Extend its serialized webview contract with options and a targeted session lifecycle. React renders an activity strip, a resizable extension sidebar, and a reusable full-height webview frame; it retains a session only when the extension requested it. `VSCodeWorkbenchSurface` adds coding-only chrome around the current editors without replacing their content.

**Tech Stack:** Tauri/Rust, Node extension-host shim, React, TypeScript, Zustand, Tailwind, Vitest, local VS Code extensions.

---

## File Structure

- Create: `src/lib/vscode-extension-host/webview-document.ts`
  - Build a trusted desktop `srcDoc` document with the singleton VS Code bridge,
    resource rewriting, and per-view message envelope.
- Create: `src/lib/vscode-extension-host/__tests__/webview-document.test.ts`
  - Verify bridge uniqueness, message isolation, CSP/resource rewriting, and
    option-derived sandbox policy.
- Create: `src/components/vscode-compat/vscode-webview-frame.tsx`
  - Own a mounted iframe session, readiness, targeted inbound messages, and
    retain/dispose behavior.
- Create: `src/components/vscode-compat/__tests__/vscode-webview-frame.test.tsx`
  - Verify full-height frame behavior, outbound messages, and retained sessions.
- Modify: `src/lib/vscode-extension-host/types.ts`
  - Serialize supported `VSCodeHostWebviewOptions` in host webview responses.
- Modify: `src-tauri/src/main.rs`
  - Capture `webview.options`, return it for resolved webviews, and retain only
    the existing Node host boundary.
- Modify: `src/components/vscode-compat/vscode-activity-panel.tsx`
  - Replace the diagnostics-first view card with the extension workbench and
    reuse `VSCodeWebviewFrame`.
- Modify: `src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx`
  - Cover host-view-first activity selection, diagnostics disclosure, and no
    manifest-command takeover.
- Modify: `src/components/vscode-compat/vscode-workbench-surface.tsx`
  - Render coding-only status chrome around existing code/notebook children.
- Modify: `src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx`
  - Cover code/notebook status fields and non-coding boundary behavior.
- Modify: `scripts/smoke-vscode-extensions.mjs`
  - Resolve Claude and Codex views in the controlled local extension smoke
    session and report their returned HTML/options without printing HTML.

### Task 1: Define The Webview Document Contract

**Files:**
- Create: `src/lib/vscode-extension-host/__tests__/webview-document.test.ts`
- Create: `src/lib/vscode-extension-host/webview-document.ts`

- [ ] **Step 1: Write the failing bridge test**

```ts
it("creates one stateful VS Code API bridge scoped to the requested view", () => {
  const document = buildVSCodeWebviewDocument({
    viewId: "claude.sidebar",
    html: "<html><head></head><body>Claude</body></html>",
    options: { enableScripts: true, retainContextWhenHidden: true },
  });

  expect(document.html).toContain("window.acquireVsCodeApi = () => api");
  expect(document.html).toContain('viewId: "claude.sidebar"');
  expect(document.sandbox).toContain("allow-scripts");
  expect(document.retainContextWhenHidden).toBe(true);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test -- --run src/lib/vscode-extension-host/__tests__/webview-document.test.ts`

Expected: FAIL because `buildVSCodeWebviewDocument` does not exist.

- [ ] **Step 3: Implement the minimal document builder**

```ts
export function buildVSCodeWebviewDocument(input: VSCodeWebviewDocumentInput) {
  const html = injectVSCodeWebviewBridge(rewriteVSCodeWebviewHtmlResources(input.html), input.viewId);
  return {
    html,
    sandbox: input.options?.enableScripts ? "allow-scripts allow-same-origin" : "allow-same-origin",
    retainContextWhenHidden: input.options?.retainContextWhenHidden === true,
  };
}
```

The injected script must create one `api` object per iframe document and relay
only `{ type: "lattice-vscode-webview-message", viewId, message }` envelopes.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm run test -- --run src/lib/vscode-extension-host/__tests__/webview-document.test.ts`

Expected: PASS.

### Task 2: Return Webview Options From The Extension Host

**Files:**
- Modify: `src/lib/vscode-extension-host/types.ts`
- Modify: `src-tauri/src/main.rs`
- Modify: `src/lib/vscode-extension-host/__tests__/desktop.test.ts`

- [ ] **Step 1: Write failing host serialization tests**

Add a Rust snapshot test that deserializes:

```json
{
  "viewId": "claude.sidebar",
  "title": "Claude Code",
  "extensionId": "anthropic.claude-code",
  "html": "<main></main>",
  "options": { "enableScripts": true, "enableForms": true, "retainContextWhenHidden": true },
  "source": "host"
}
```

Add a TypeScript bridge test asserting `options` survives
`resolveVSCodeExtensionHostView`.

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml vscode_extension_host_webview_snapshot_deserializes`

Run: `npm run test -- --run src/lib/vscode-extension-host/__tests__/desktop.test.ts`

Expected: FAIL because the `options` field is not part of the shared contract.

- [ ] **Step 3: Extend the contract minimally**

```ts
export interface VSCodeHostWebviewOptions {
  enableScripts?: boolean;
  enableForms?: boolean;
  retainContextWhenHidden?: boolean;
}

export interface VSCodeHostWebviewContent {
  // existing fields
  options?: VSCodeHostWebviewOptions;
}
```

In the Node host, serialize only these three booleans from `host.view.webview.options`.
Do not expose arbitrary extension options or filesystem roots to the renderer.

- [ ] **Step 4: Run the focused tests to verify they pass**

Run the two Step 2 commands.

Expected: PASS.

### Task 3: Add A Retained Full-Height Webview Frame

**Files:**
- Create: `src/components/vscode-compat/vscode-webview-frame.tsx`
- Create: `src/components/vscode-compat/__tests__/vscode-webview-frame.test.tsx`

- [ ] **Step 1: Write the failing frame tests**

```tsx
it("posts outbound messages for its own view and preserves a retained session", () => {
  render(<VSCodeWebviewFrame content={content} onMessage={onMessage} />);
  expect(screen.getByTitle("Claude Code webview")).toHaveClass("h-full");
  window.dispatchEvent(new MessageEvent("message", {
    data: { type: "lattice-vscode-webview-message", viewId: "claude.sidebar", message: { ready: true } },
  }));
  expect(onMessage).toHaveBeenCalledWith("claude.sidebar", { ready: true });
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test -- --run src/components/vscode-compat/__tests__/vscode-webview-frame.test.tsx`

Expected: FAIL because the frame component does not exist.

- [ ] **Step 3: Implement the frame**

```tsx
export function VSCodeWebviewFrame({ content, onMessage }: VSCodeWebviewFrameProps) {
  const document = useMemo(() => buildVSCodeWebviewDocument(content), [content]);
  return <iframe title={`${content.title} webview`} className="h-full min-h-0 w-full" sandbox={document.sandbox} srcDoc={document.html} />;
}
```

Add targeted `window.message` filtering by `viewId`, send pending host messages only
after iframe load, and retain the component keyed by `viewId` when requested.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm run test -- --run src/components/vscode-compat/__tests__/vscode-webview-frame.test.tsx`

Expected: PASS.

### Task 4: Convert The Activity Panel Into The Extension Workbench

**Files:**
- Modify: `src/components/vscode-compat/vscode-activity-panel.tsx`
- Modify: `src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx`

- [ ] **Step 1: Write the failing workbench-first test**

```tsx
it("opens the selected host view in the extension workspace without diagnostics chrome", async () => {
  render(<VSCodeActivityPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Open Claude Code extension view" }));

  expect(await screen.findByTestId("vscode-extension-workbench")).toBeTruthy();
  expect(screen.queryByText("Host registered views")).toBeNull();
  expect(screen.getByTitle("Claude Code webview")).toHaveClass("h-full");
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test -- --run src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx`

Expected: FAIL because the panel renders diagnostics-first cards and a fixed-height iframe.

- [ ] **Step 3: Implement the workbench layout**

Replace the extension-mode body with a fixed-width activity strip and a
`data-testid="vscode-extension-workbench"` sidebar. Render selected host views
through `VSCodeWebviewFrame`; keep tree views through the existing tree renderer.
Move host state, activation errors, raw command counts, and command buttons into
a collapsed `Extension diagnostics` section. Do not render manifest-only command
buttons as executable actions.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm run test -- --run src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx src/components/vscode-compat/__tests__/vscode-webview-frame.test.tsx`

Expected: PASS.

### Task 5: Make The Coding Surface Visible On Code And Notebook Routes

**Files:**
- Modify: `src/components/vscode-compat/vscode-workbench-surface.tsx`
- Modify: `src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx`

- [ ] **Step 1: Write the failing coding-shell test**

```tsx
it("adds code-only status information without changing editor content", () => {
  render(<VSCodeWorkbenchSurface fileName="demo.py" fileKind="code" languageLabel="Python" problemCount={2}><div>Editor content</div></VSCodeWorkbenchSurface>);
  expect(screen.getByTestId("vscode-workbench-surface")).toBeTruthy();
  expect(screen.getByText("Python")).toBeTruthy();
  expect(screen.getByText("2 Problems")).toBeTruthy();
  expect(screen.getByText("Editor content")).toBeTruthy();
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run test -- --run src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx`

Expected: FAIL because the surface is a fragment.

- [ ] **Step 3: Implement the bounded shell**

Wrap children in a full-height flex column and add a compact bottom status bar.
Show only provided props, avoid a generic `Open in VS Code` button, and do not
alter content routing. The status bar must render no empty separators.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm run test -- --run src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx src/components/renderers/__tests__/code-editor-viewer.test.tsx src/components/renderers/__tests__/jupyter-renderer.test.tsx`

Expected: PASS.

### Task 6: Verify Real Extensions And Release Eligibility

**Files:**
- Modify: `scripts/smoke-vscode-extensions.mjs`
- Test: `scripts/smoke-vscode-extensions.mjs`

- [ ] **Step 1: Add a failing controlled-view assertion**

Require the smoke report to contain Claude/Codex view result summaries with
`viewId`, `htmlLength`, and serialized options after resolving their first
registered webview. Missing local extensions remain reported, not synthesized.

- [ ] **Step 2: Run the smoke command to verify it fails**

Run: `npm run smoke:vscode:extensions`

Expected: FAIL because the report does not resolve or summarize a real view.

- [ ] **Step 3: Add view-resolution reporting**

Send one `resolve-view` request for each available Claude and Codex webview.
Report only identifiers, HTML length, and options; do not print webview HTML or
user content. Keep the current Python and Jupyter document activation requests.

- [ ] **Step 4: Run focused and full verification**

Run:

```powershell
npm run test -- --run src/lib/vscode-extension-host/__tests__/webview-document.test.ts src/components/vscode-compat/__tests__/vscode-webview-frame.test.tsx src/components/vscode-compat/__tests__/vscode-activity-panel.test.tsx src/components/vscode-compat/__tests__/vscode-workbench-surface.test.tsx
npm run typecheck
npm run smoke:vscode:extensions
npm run qa:gate
```

Expected: all commands exit 0. Only after the gate passes in this implementation
phase, run `node scripts/prepare-release.mjs --skip-qa --artifacts-dir "src-tauri/target/release"` to refresh local `releases/` artifacts.

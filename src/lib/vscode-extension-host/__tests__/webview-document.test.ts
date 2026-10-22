import { describe, expect, it } from "vitest";
import { buildVSCodeWebviewDocument } from "../webview-document";

describe("VS Code webview document", () => {
  it("creates one stateful VS Code API bridge scoped to the requested view", () => {
    const document = buildVSCodeWebviewDocument({
      viewId: "claude.sidebar",
      html: "<html><head></head><body>Claude</body></html>",
      options: { enableScripts: true, retainContextWhenHidden: true },
    });

    expect(document.html).toContain("window.acquireVsCodeApi = () => api");
    expect(document.html).toContain('const viewId = "claude.sidebar"');
    expect(document.html).toContain('type: "lattice-vscode-webview-message", viewId, message');
    expect(document.sandbox).toContain("allow-scripts");
    expect(document.retainContextWhenHidden).toBe(true);
  });

  it("keeps messages and resource policies isolated by view", () => {
    const document = buildVSCodeWebviewDocument({
      viewId: "codex.sidebar",
      html: '<html><head><meta http-equiv="Content-Security-Policy" content="img-src vscode-webview:"></head><body></body></html>',
      options: { enableForms: true },
    });

    expect(document.html).toContain('const viewId = "codex.sidebar"');
    expect(document.html).not.toContain('const viewId = "claude.sidebar"');
    expect(document.sandbox).toContain("allow-forms");
    expect(document.sandbox).not.toContain("allow-scripts");
  });

  it("relays host replies to the webview message channel for the same view", () => {
    const document = buildVSCodeWebviewDocument({
      viewId: "claude.sidebar",
      html: "<html><head></head><body>Claude</body></html>",
    });

    expect(document.html).toContain('data.type !== "lattice-vscode-host-message"');
    expect(document.html).toContain("data.viewId !== viewId");
    expect(document.html).toContain("origin: window.location.origin");
    expect(document.html).toContain("source: window.parent === window ? null : window.parent");
  });

  it("provides the VS Code theme contract expected by contributed webviews", () => {
    const document = buildVSCodeWebviewDocument({
      viewId: "kilo-code.sidebar",
      html: "<html><head></head><body><div id=\"root\"></div></body></html>",
      themeKind: "dark",
    });

    expect(document.html).toContain('data-lattice-vscode-webview-theme="dark"');
    expect(document.html).toContain("--vscode-font-family:");
    expect(document.html).toContain("--vscode-font-size: 13px");
    expect(document.html).toContain("--vscode-editor-background: #1e1e1e");
    expect(document.html).toContain('const themeClass = "vscode-dark"');
    expect(document.html).toContain("classList.add(themeClass)");
    expect(document.html).toContain("html, body { height: 100%; min-height: 0; }");
  });
});

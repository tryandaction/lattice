import { describe, expect, it } from "vitest";
import {
  rewriteVSCodeWebviewCspSource,
  rewriteVSCodeWebviewHtmlResources,
} from "@/lib/vscode-extension-host/webview-html";

describe("VS Code webview HTML resource rewriting", () => {
  it("rewrites Lattice webview resource URIs into loadable local paths outside Tauri", () => {
    const html = '<script src="lattice-webview-resource:C%3A%2Fext%2Fmedia%2Fmain.js"></script>';

    const rewritten = rewriteVSCodeWebviewHtmlResources(html);

    expect(rewritten).not.toContain("lattice-webview-resource:");
    expect(rewritten).toContain("C:/ext/media/main.js");
  });

  it("leaves malformed resource URIs unchanged instead of throwing", () => {
    const html = '<link href="lattice-webview-resource:%E0%A4%A">';

    expect(rewriteVSCodeWebviewHtmlResources(html)).toBe(html);
  });

  it("replaces the VS Code CSP source with the active desktop resource scheme", () => {
    const html = '<meta http-equiv="Content-Security-Policy" content="script-src vscode-webview:; style-src vscode-webview:">';

    expect(rewriteVSCodeWebviewCspSource(html, "lattice-preview:")).toContain(
      "script-src lattice-preview:; style-src lattice-preview:",
    );
  });

  it("allows extension-bundled data fonts without broadening scripts or styles", () => {
    const html = '<meta http-equiv="Content-Security-Policy" content="default-src none; font-src vscode-webview:; script-src vscode-webview:; style-src vscode-webview:">';

    const rewritten = rewriteVSCodeWebviewCspSource(html, "lattice-preview:");

    expect(rewritten).toContain("font-src lattice-preview: data:");
    expect(rewritten).toContain("script-src lattice-preview:");
    expect(rewritten).not.toContain("script-src lattice-preview: data:");
    expect(rewritten).not.toContain("style-src lattice-preview: data:");
  });

  it("uses a directory-preserving Tauri resource URL and converted CSP origin", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        convertFileSrc: (filePath: string, protocol: string) =>
          `http://${protocol}.localhost/${encodeURIComponent(filePath)}`,
      },
    });
    const html = [
      '<meta http-equiv="Content-Security-Policy" content="script-src vscode-webview:; style-src vscode-webview:">',
      '<script src="lattice-webview-resource:C%3A%2Fext%2Fwebview%2Findex.js"></script>',
    ].join("");

    try {
      const rewritten = rewriteVSCodeWebviewHtmlResources(html);

      expect(rewritten).toContain(
        "http://lattice-preview.localhost/C%3A/ext/webview/index.js",
      );
      expect(rewritten).toContain(
        "script-src http://lattice-preview.localhost; style-src http://lattice-preview.localhost",
      );
    } finally {
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });

  it("preserves a directory resource suffix so webview base URLs resolve relative assets", () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {
        convertFileSrc: (filePath: string, protocol: string) =>
          `http://${protocol}.localhost/${encodeURIComponent(filePath)}`,
      },
    });

    try {
      const rewritten = rewriteVSCodeWebviewHtmlResources(
        '<base href="lattice-webview-resource:C%3A%2Fext%2Fwebview%2F">',
      );

      expect(rewritten).toContain(
        'href="http://lattice-preview.localhost/C%3A/ext/webview/"',
      );
    } finally {
      Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
    }
  });
});

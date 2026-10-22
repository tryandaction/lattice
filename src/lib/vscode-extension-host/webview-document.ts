import { rewriteVSCodeWebviewHtmlResources } from "@/lib/vscode-extension-host/webview-html";
import type { VSCodeHostWebviewOptions } from "@/lib/vscode-extension-host/types";

export interface VSCodeWebviewDocumentInput {
  viewId: string;
  html: string;
  options?: VSCodeHostWebviewOptions;
  themeKind?: VSCodeWebviewThemeKind;
}

export type VSCodeWebviewThemeKind = "light" | "dark";

export interface VSCodeWebviewDocument {
  html: string;
  sandbox: string;
  retainContextWhenHidden: boolean;
}

function toScriptValue(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

const SHARED_THEME_VARIABLES = `
  --vscode-font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --vscode-font-size: 13px;
  --vscode-font-weight: 400;
  --vscode-editor-font-family: "Cascadia Code", Consolas, "Courier New", monospace;
`;

const LIGHT_THEME_VARIABLES = `
  color-scheme: light;
  --vscode-foreground: #3b3b3b;
  --vscode-descriptionForeground: #616161;
  --vscode-disabledForeground: #9d9d9d;
  --vscode-editor-background: #ffffff;
  --vscode-editor-foreground: #333333;
  --vscode-sideBar-background: #ffffff;
  --vscode-panel-background: #ffffff;
  --vscode-panel-border: #e5e5e5;
  --vscode-widget-border: #cecece;
  --vscode-editorWidget-background: #ffffff;
  --vscode-editorWidget-border: #cecece;
  --vscode-input-background: #ffffff;
  --vscode-input-foreground: #333333;
  --vscode-input-border: #cecece;
  --vscode-input-placeholderForeground: #767676;
  --vscode-dropdown-background: #ffffff;
  --vscode-dropdown-foreground: #333333;
  --vscode-dropdown-border: #cecece;
  --vscode-button-background: #007acc;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #0062a3;
  --vscode-button-border: transparent;
  --vscode-button-secondaryBackground: #e5e5e5;
  --vscode-button-secondaryForeground: #333333;
  --vscode-button-secondaryHoverBackground: #d7d7d7;
  --vscode-list-hoverBackground: #e8e8e8;
  --vscode-list-hoverForeground: #333333;
  --vscode-list-activeSelectionBackground: #0060c0;
  --vscode-list-activeSelectionForeground: #ffffff;
  --vscode-list-inactiveSelectionBackground: #e4e6f1;
  --vscode-focusBorder: #007fd4;
  --vscode-icon-foreground: #424242;
  --vscode-toolbar-hoverBackground: #e8e8e8;
  --vscode-toolbar-activeBackground: #d7d7d7;
  --vscode-textLink-foreground: #006ab1;
  --vscode-textLink-activeForeground: #0060a0;
  --vscode-errorForeground: #e51400;
  --vscode-charts-blue: #1a85ff;
  --vscode-charts-green: #388a34;
  --vscode-charts-yellow: #bf8803;
  --vscode-charts-orange: #d18616;
  --vscode-charts-red: #e51400;
  --vscode-charts-purple: #652d90;
  --vscode-scrollbarSlider-background: #64646433;
  --vscode-scrollbarSlider-hoverBackground: #64646459;
  --vscode-scrollbarSlider-activeBackground: #00000080;
`;

const DARK_THEME_VARIABLES = `
  color-scheme: dark;
  --vscode-foreground: #cccccc;
  --vscode-descriptionForeground: #a0a0a0;
  --vscode-disabledForeground: #858585;
  --vscode-editor-background: #1e1e1e;
  --vscode-editor-foreground: #d4d4d4;
  --vscode-sideBar-background: #1e1e1e;
  --vscode-panel-background: #1e1e1e;
  --vscode-panel-border: #454545;
  --vscode-widget-border: #454545;
  --vscode-editorWidget-background: #252526;
  --vscode-editorWidget-border: #454545;
  --vscode-input-background: #3c3c3c;
  --vscode-input-foreground: #cccccc;
  --vscode-input-border: #606060;
  --vscode-input-placeholderForeground: #a0a0a0;
  --vscode-dropdown-background: #3c3c3c;
  --vscode-dropdown-foreground: #f0f0f0;
  --vscode-dropdown-border: #3c3c3c;
  --vscode-button-background: #0e639c;
  --vscode-button-foreground: #ffffff;
  --vscode-button-hoverBackground: #1177bb;
  --vscode-button-border: transparent;
  --vscode-button-secondaryBackground: #3a3d41;
  --vscode-button-secondaryForeground: #ffffff;
  --vscode-button-secondaryHoverBackground: #45494e;
  --vscode-list-hoverBackground: #2a2d2e;
  --vscode-list-hoverForeground: #f0f0f0;
  --vscode-list-activeSelectionBackground: #04395e;
  --vscode-list-activeSelectionForeground: #ffffff;
  --vscode-list-inactiveSelectionBackground: #37373d;
  --vscode-focusBorder: #007fd4;
  --vscode-icon-foreground: #c5c5c5;
  --vscode-toolbar-hoverBackground: #2a2d2e;
  --vscode-toolbar-activeBackground: #3a3d41;
  --vscode-textLink-foreground: #3794ff;
  --vscode-textLink-activeForeground: #4daafc;
  --vscode-errorForeground: #f14c4c;
  --vscode-charts-blue: #3794ff;
  --vscode-charts-green: #89d185;
  --vscode-charts-yellow: #cca700;
  --vscode-charts-orange: #d18616;
  --vscode-charts-red: #f14c4c;
  --vscode-charts-purple: #b180d7;
  --vscode-scrollbarSlider-background: #79797966;
  --vscode-scrollbarSlider-hoverBackground: #646464b3;
  --vscode-scrollbarSlider-activeBackground: #bfbfbf66;
`;

function createVSCodeWebviewTheme(themeKind: VSCodeWebviewThemeKind): string {
  const themeClass = themeKind === "dark" ? "vscode-dark" : "vscode-light";
  return `<style data-lattice-vscode-webview-theme="${themeKind}">
:root, :root.vscode-light {
${SHARED_THEME_VARIABLES}${LIGHT_THEME_VARIABLES}}
:root.vscode-dark {
${SHARED_THEME_VARIABLES}${DARK_THEME_VARIABLES}}
html, body { height: 100%; min-height: 0; }
body {
  margin: 0;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  font-weight: var(--vscode-font-weight);
}
</style>
<script data-lattice-vscode-webview-theme-class="${themeKind}">
(() => {
  const themeClass = ${toScriptValue(themeClass)};
  const applyThemeClass = (element) => {
    if (!element) return;
    element.classList.remove("vscode-light", "vscode-dark", "vscode-high-contrast", "vscode-high-contrast-light");
    element.classList.add(themeClass);
    element.dataset.vscodeThemeKind = ${toScriptValue(themeKind)};
  };
  applyThemeClass(document.documentElement);
  if (document.body) applyThemeClass(document.body);
  else document.addEventListener("DOMContentLoaded", () => applyThemeClass(document.body), { once: true });
})();
</script>`;
}

function createVSCodeWebviewBridge(viewId: string, themeKind: VSCodeWebviewThemeKind): string {
  const serializedViewId = toScriptValue(viewId);
  return `${createVSCodeWebviewTheme(themeKind)}<script data-lattice-vscode-webview-bridge="true">
(() => {
  const viewId = ${serializedViewId};
  let state;
  const api = {
    postMessage(message) {
      window.parent?.postMessage({ type: "lattice-vscode-webview-message", viewId, message }, "*");
      return true;
    },
    getState() {
      return state;
    },
    setState(nextState) {
      state = nextState;
      return state;
    },
  };
  window.acquireVsCodeApi = () => api;
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (
      !data ||
      data.type !== "lattice-vscode-host-message" ||
      data.viewId !== viewId
    ) {
      return;
    }
    // Some contributed webviews validate the browser-level message origin before
    // accepting a host reply. Keep the event shaped like VS Code's same-origin
    // iframe delivery instead of emitting an origin-less synthetic event.
    window.dispatchEvent(new MessageEvent("message", {
      data: data.message,
      origin: window.location.origin,
      source: window.parent === window ? null : window.parent,
    }));
  });
})();
</script>`;
}

function injectVSCodeWebviewBridge(
  html: string,
  viewId: string,
  themeKind: VSCodeWebviewThemeKind,
): string {
  if (html.includes("data-lattice-vscode-webview-bridge=\"true\"")) {
    return html;
  }
  const bridge = createVSCodeWebviewBridge(viewId, themeKind);
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${bridge}`);
  }
  return `${bridge}${html}`;
}

function resolveSandbox(options?: VSCodeHostWebviewOptions): string {
  const permissions = ["allow-same-origin"];
  if (options?.enableScripts) {
    permissions.push("allow-scripts");
  }
  if (options?.enableForms) {
    permissions.push("allow-forms");
  }
  return permissions.join(" ");
}

export function buildVSCodeWebviewDocument(input: VSCodeWebviewDocumentInput): VSCodeWebviewDocument {
  const rewrittenHtml = rewriteVSCodeWebviewHtmlResources(input.html);
  return {
    html: injectVSCodeWebviewBridge(rewrittenHtml, input.viewId, input.themeKind ?? "light"),
    sandbox: resolveSandbox(input.options),
    retainContextWhenHidden: input.options?.retainContextWhenHidden === true,
  };
}

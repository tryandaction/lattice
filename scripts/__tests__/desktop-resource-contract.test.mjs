import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("desktop resource contract", () => {
  it("keeps a real-pointer PDF smoke mode for validated text selection", async () => {
    const [source, directSource] = await Promise.all([
      fs.readFile("scripts/desktop-pdf-product-smoke.mjs", "utf8"),
      fs.readFile("scripts/desktop-pdf-smoke.mjs", "utf8"),
    ]);

    expect(source).toContain("LATTICE_DESKTOP_PRODUCT_SMOKE_POINTER_TARGET");
    expect(source).toContain("LATTICE_DESKTOP_PRODUCT_SMOKE_POINTER_ONLY");
    expect(source).toContain("selectProductPdfTextRange(page, REAL_PDF_PAGE, POINTER_TARGET)");
    expect(source).toContain('new Set(["pdfjs-text-model", "pdfium-native"])');
    expect(source).toContain("acceptedPointerSources.has(pointerSelectionResult.source)");
    expect(source).toContain("pointerSelectionResult");
    expect(directSource).toContain("LATTICE_DESKTOP_SMOKE_POINTER_TARGET");
    expect(directSource).toContain("LATTICE_DESKTOP_SMOKE_POINTER_ONLY");
    expect(directSource).toContain("selectPdfTextRangeWithPointer");
    expect(directSource).toContain('nativeEndpointProbe?.source !== "pdfium"');
    expect(directSource).toContain('event.type === type && event.isTrusted');
    expect(directSource).toContain('assertPointerCopyAndPersistence(page, pointerSelectionBox, pointerSelectionResult)');
    const pointerFlow = directSource.slice(
      directSource.indexOf('async function selectPdfTextRangeWithPointer'),
      directSource.indexOf('async function waitForPointerSelection'),
    );
    expect(pointerFlow).toContain('page.mouse.down()');
    expect(pointerFlow).toContain('page.mouse.up()');
    expect(pointerFlow).not.toContain('addRange(');
    expect(pointerFlow).not.toContain('new PointerEvent(');
  });

  it("binds real desktop PDF diagnostics to the original native file handle", async () => {
    const source = await fs.readFile(
      "src/components/diagnostics/pdf-regression-diagnostics.tsx",
      "utf8",
    );

    expect(source).toContain("createDesktopFileHandle");
    expect(source).toContain("createDesktopFileHandle(realPdfDesktopPath)");
  });

  it("keeps desktop PDF search smoke on a visible page and the pointer action path", async () => {
    const source = await fs.readFile("scripts/desktop-pdf-smoke.mjs", "utf8");

    expect(source).toContain("waitForPdfPageVisible");
    expect(source).toContain('dispatchEvent("pointerdown"');
    expect(source).toContain("selectPdfAnnotationTool");
  });

  it("keeps the desktop code and VS Code tools smoke tied to product UI behavior", async () => {
    const source = await fs.readFile(
      "scripts/desktop-code-tools-smoke.mjs",
      "utf8",
    );

    expect(source).toContain(".code-editor");
    expect(source).toContain('getByTestId("code-minimap")');
    expect(source).toContain("minimapPresent,");
    expect(source).toContain("did not render its minimap");
    expect(source).toContain("native-vscode-workbench-pane");
    expect(source).toContain("desktop_read_text_file");
    expect(source).toContain("LATTICE_CODE_TOOLS_SMOKE");
    expect(source).toContain("vscode-activity-panel");
    expect(source).toContain("Claude Code: Show Logs");
    expect(source).toContain("data-explorer-node");
    expect(source).toContain("dispatchEvent");
    expect(source).toContain("dragstart");
    expect(source).toContain("drop");
    expect(source).toContain("Terminal");
    expect(source).toContain("child.stdout?.destroy()");
    expect(source).toContain("child.stderr?.destroy()");
    expect(source).not.toContain("Stop-Process");
    expect(source).not.toContain("CloseMainWindow");
    expect(source).toContain("runOutputVisible = true");
    expect(source).toContain("LATTICE_NOTE_SMOKE_SAVED");
    expect(source).toContain("noteSaved:");
    expect(source).toContain("Markdown note was not persisted");
    expect(source).toContain("workspaceName");
    expect(source).toContain("hasText: workspaceName");
    expect(source).toContain('button[data-explorer-node="true"]:visible');
    expect(source).toContain("workspaceTreeReadyMs,");
    expect(source).toContain("--vscode-font-family");
    expect(source).toContain("kiloThemeApplied");
    expect(source).toContain("kiloHostOverflow");
    expect(source).toContain("kilo-webview-themed.png");
    expect(source).toContain("isCodexExtension");
    expect(source).toContain("codexViewReady");
    expect(source).toContain("desktop_get_vscode_extension_host_snapshot");
    expect(source).toContain("codex-webview.png");
    expect(source).toContain("previewResourceFailures");
    expect(source).toContain("codexWebviewDocument");
    expect(source).toContain('candidate.url().startsWith("http://tauri.localhost")');
    expect(source).toContain('candidate.url().startsWith("http://localhost:3000")');
    expect(source).toContain('"set_last_workspace_path"');
    expect(source).toContain("Let the initial auto-restore finish");
    expect(source).toContain("settings?.lastWorkspacePath === rootPath");
    expect(source).toContain("originalSettings = await seedProductSession");
    expect(source.match(/page\.reload\(/g)).toHaveLength(1);
    expect(source).toContain('invoke("set_setting", { key: "lattice-settings", value: settings })');
    expect(source).toContain("desktop-profile-");
    expect(source).toContain("APPDATA: desktopProfilePath");
    expect(source).toContain("LOCALAPPDATA: desktopProfilePath");
    expect(source).toContain("WEBVIEW2_USER_DATA_FOLDER:");
    expect(source).toContain('name: "Source", exact: true');
    expect(source).toContain(".live-preview-editor .cm-content");
    expect(source).not.toContain("desktop-commandbar-workspace-recent-${workspacePath}");
    expect(source).toContain('sessionStorage.getItem("lattice-desktop-window-session-id")');
    expect(source).toContain('localStorage.setItem("lattice-desktop-window-sessions"');
    expect(source).not.toContain('localStorage.removeItem("lattice-desktop-window-sessions")');
    expect(source).not.toContain('sessionStorage.removeItem("lattice-desktop-window-session-id")');
    expect(source).toContain("LATTICE_EXTENSION_INTERACTION_SELECTED");
    expect(source).toContain("vscode.window.showQuickPick");
    expect(source).toContain('getByRole("dialog", { name: "Choose smoke mode" })');
    expect(source).toContain('getByRole("option", { name: /Real extension host/ })');
    expect(source).toContain('key.startsWith("__reactProps")');
    expect(source).toContain("VS Code command button is missing its React click handler.");
    expect(source).toContain("opening the real Claude Code contributed webview");
    expect(source).toContain("claudeWebviewRendered:");
    expect(source).toContain("resolveClaudeExtensionPath");
    expect(source).toContain("readdir(DEFAULT_VSCODE_EXTENSIONS_DIR");
    expect(source).toContain('toLowerCase() === "anthropic"');
    expect(source).not.toMatch(/anthropic\.claude-code-\d+\.\d+\.\d+/);
    expect(source).not.toContain('page.goto("http://tauri.localhost/"');
  });

  it("keeps the desktop package focused on the integrated editor and extension host", async () => {
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
    const tauriConfig = JSON.parse(
      await fs.readFile("src-tauri/tauri.conf.json", "utf8"),
    );

    expect(packageJson.scripts["prepare:desktop-resources"]).toBe(
      "npm run prepare:code-oss-runtime && npm run prepare:typescript-resources && npm run prepare:js-debug-resources",
    );
    expect(tauriConfig.bundle.resources).toContain("resources/vscode-typescript/**/*");
    expect(tauriConfig.bundle.resources).toContain("resources/vscode-js-debug/**/*");
    expect(tauriConfig.bundle.resources).toContain("code-oss-runtime/**/*");
    expect(tauriConfig.bundle.resources).not.toContain("resources/vscode-lattice-bridge/**/*");
    expect(tauriConfig.bundle.resources).not.toContain("resources/vscode-lattice-bridge.vsix");
  });

  it("imports VS Code extensions before starting the Workbench runtime", async () => {
    const source = await fs.readFile(
      "src-tauri/src/vscode_workbench.rs",
      "utf8",
    );
    const start = source.indexOf(
      "pub async fn desktop_start_vscode_workbench",
    );
    const stop = source.indexOf(
      "pub async fn desktop_get_vscode_workbench_status",
      start,
    );
    const command = source.slice(start, stop);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(stop).toBeGreaterThan(start);
    expect(command.indexOf("import_vscode_extensions")).toBeGreaterThanOrEqual(0);
    expect(command.indexOf("import_vscode_extensions")).toBeLessThan(
      command.indexOf("Command::new"),
    );
  });

  it("recovers extension entries after an installed extension version changes", async () => {
    const source = await fs.readFile("src-tauri/src/main.rs", "utf8");

    expect(source).toContain("function findCurrentExtensionPath(extension)");
    expect(source).toContain("function refreshExtensionMetadata(extension)");
    expect(source).toContain("packageJson.main");
    expect(source).toContain("extension = refreshExtensionMetadata(registeredExtension);");
  });

  it("keeps generated desktop runtimes out of the application typecheck", async () => {
    const tsconfig = JSON.parse(await fs.readFile("tsconfig.json", "utf8"));

    expect(tsconfig.exclude).toContain(".lattice-build");
    expect(tsconfig.exclude).toContain("src-tauri/code-oss-runtime");
  });
});

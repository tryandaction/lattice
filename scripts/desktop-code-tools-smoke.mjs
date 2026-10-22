import { spawn } from "node:child_process";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, "output", "desktop-smoke");
const DEFAULT_EXE = path.join(ROOT_DIR, "src-tauri", "target", "release", "lattice.exe");
const DEFAULT_VSCODE_EXTENSIONS_DIR = path.join(
  process.env.USERPROFILE ?? "",
  ".vscode",
  "extensions",
);
const ASSERT_TIMEOUT_MS = Number(process.env.LATTICE_CODE_TOOLS_SMOKE_TIMEOUT_MS ?? 180000);
const FIRST_LAUNCH_READY_LIMIT_MS = Number(process.env.LATTICE_FIRST_LAUNCH_READY_LIMIT_MS ?? 15000);
const RUN_MARKER = "LATTICE_CODE_TOOLS_SMOKE_SAVED";
const NOTE_MARKER = "LATTICE_NOTE_SMOKE_SAVED";
const EXTENSION_INTERACTION_MARKER = "LATTICE_EXTENSION_INTERACTION_SELECTED";
const STAGES = [];

function logStage(stage) {
  STAGES.push({ stage, at: new Date().toISOString() });
  console.log(`[desktop-code-tools-smoke] ${stage}`);
}

function normalizePath(value) {
  return path.resolve(value).replace(/\\/g, "/");
}

async function resolveClaudeExtensionPath() {
  const explicitPath = process.env.LATTICE_CODE_TOOLS_SMOKE_EXTENSION;
  if (explicitPath) {
    const normalized = normalizePath(explicitPath);
    await access(path.join(normalized, "package.json"));
    return normalized;
  }

  const candidates = await readdir(DEFAULT_VSCODE_EXTENSIONS_DIR, { withFileTypes: true });
  const manifests = await Promise.all(candidates
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("anthropic.claude-code-"))
    .map(async (entry) => {
      const extensionPath = path.join(DEFAULT_VSCODE_EXTENSIONS_DIR, entry.name);
      try {
        const packageJson = JSON.parse(await readFile(path.join(extensionPath, "package.json"), "utf8"));
        return String(packageJson.publisher ?? "").toLowerCase() === "anthropic"
          && String(packageJson.name ?? "").toLowerCase() === "claude-code"
          ? { extensionPath, version: String(packageJson.version ?? "0") }
          : null;
      } catch {
        return null;
      }
    }));
  const current = manifests
    .filter(Boolean)
    .sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }))[0];
  if (!current) {
    throw new Error(`Claude Code extension is not installed under ${DEFAULT_VSCODE_EXTENSIONS_DIR}`);
  }
  return normalizePath(current.extensionPath);
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to allocate a local CDP port."));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function waitForHttpOk(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const status = await new Promise((resolve, reject) => {
        const request = http.get(url, (response) => {
          response.resume();
          resolve(response.statusCode ?? 0);
        });
        request.once("error", reject);
        request.setTimeout(3000, () => request.destroy(new Error("HTTP probe timed out.")));
      });
      if (status >= 200 && status < 300) return;
      lastError = new Error(`Unexpected status ${status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function waitForDesktopPage(browser, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    for (const context of browser.contexts()) {
      const page = context.pages().find((candidate) => (
        candidate.url().startsWith("http://tauri.localhost")
        || candidate.url().startsWith("http://localhost:3000")
      ));
      if (page) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Timed out waiting for the Lattice desktop WebView page.");
}

function buildExtensionInventory(extensionPath, packageJson) {
  const commands = Array.isArray(packageJson.contributes?.commands)
    ? packageJson.contributes.commands.map((item) => ({
        command: item.command,
        title: item.title,
        ...(item.category ? { category: item.category } : {}),
      }))
    : [];
  const viewContainerItems = Object.entries(packageJson.contributes?.viewsContainers ?? {})
    .flatMap(([location, items]) => (Array.isArray(items) ? items.map((item) => ({
      id: item.id,
      title: item.title,
      location,
      ...(item.icon ? { icon: item.icon } : {}),
      ...(item.when ? { when: item.when } : {}),
    })) : []));
  const views = Object.entries(packageJson.contributes?.views ?? {})
    .flatMap(([container, items]) => (Array.isArray(items) ? items.map((item) => ({
      container,
      id: item.id,
      name: item.name || item.id,
      ...(item.when ? { when: item.when } : {}),
    })) : []));
  return {
    id: `${packageJson.publisher}.${packageJson.name}`.toLowerCase(),
    source: "installed",
    path: normalizePath(extensionPath),
    displayName: packageJson.displayName,
    version: packageJson.version,
    main: packageJson.main,
    activationEvents: packageJson.activationEvents,
    engines: packageJson.engines,
    contributes: {
      languages: [],
      snippets: [],
      commands: commands.length,
      commandItems: commands,
      debuggers: 0,
      configuration: Boolean(packageJson.contributes?.configuration),
      views,
      viewContainers: viewContainerItems.map((item) => item.id),
      viewContainerItems,
      menus: Object.keys(packageJson.contributes?.menus ?? {}).length,
      notebooks: [],
      notebookRenderers: [],
      grammars: [],
      themes: [],
    },
  };
}

async function seedProductSession(page, workspacePath, extensionInventories) {
  await page.waitForFunction(() => (
    typeof window.__TAURI__?.core?.invoke === "function" ||
    typeof window.__TAURI_INTERNALS__?.invoke === "function"
  ), null, { timeout: ASSERT_TIMEOUT_MS });
  await page.getByTestId("desktop-activity-rail").waitFor();
  await page.getByTestId("desktop-commandbar-workspace").waitFor();
  // Let the initial auto-restore finish before replacing its persisted workspace.
  await page.waitForTimeout(1_000);

  const originalSettings = await page.evaluate(async ({ rootPath, extensions }) => {
    const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    const settings = await invoke("get_setting", { key: "lattice-settings" }) ?? {};
    const originalSettings = structuredClone(settings);
    const workspaceKey = `desktop:${rootPath}`;
    await invoke("set_last_workspace_path", { path: rootPath });
    await invoke("set_setting", {
      key: "lattice-settings",
      value: {
        ...settings,
        language: "en-US",
        onboardingCompleted: true,
        lastWorkspacePath: rootPath,
        lastOpenedFolder: rootPath,
        lastWorkspaceKey: workspaceKey,
        recentWorkspacePaths: [rootPath],
        recentWorkspaceKeys: [workspaceKey],
        workspaceDisplayPaths: { ...(settings.workspaceDisplayPaths ?? {}), [workspaceKey]: rootPath },
        activityView: "files",
        sidePanelCollapsed: false,
        vscodeCompatEnabled: true,
      },
    });
    await invoke("set_setting", {
      key: `lattice-workbench-session:${workspaceKey}`,
      value: {
        version: 1,
        activePaneId: "pane-initial",
        sidebarCollapsed: false,
        root: { type: "pane", id: "pane-initial", tabs: [], activeTabIndex: 0 },
      },
    });
    window.localStorage.setItem("lattice-vscode-compat-workbench", JSON.stringify({
      settings: {
        tabSize: 2,
        insertSpaces: true,
        wordWrap: "off",
        fontFamily: null,
        fontSize: null,
        lineNumbers: "on",
        rulers: [],
        formatOnSave: false,
        formatOnType: false,
        minimapEnabled: true,
        quickSuggestions: true,
        suggestOnTriggerCharacters: true,
        autoClosingBrackets: true,
        autoClosingQuotes: true,
        autoIndent: "full",
        smoothScrolling: false,
        cursorBlinking: null,
        renderWhitespace: "none",
        snippetSuggestions: "inline",
        filesExclude: {},
        searchExclude: {},
        filesAssociations: {},
        defaultFormatter: null,
        colorTheme: null,
      },
      keybindings: [],
      snippets: [],
      tasks: [],
      launches: [],
      extensions,
      importedAt: Date.now(),
      sourceLabel: "Lattice desktop smoke",
      warnings: [],
    }));
    const desktopWindowSessionId = window.sessionStorage.getItem("lattice-desktop-window-session-id")
      ?? `desktop-smoke-${Date.now()}`;
    window.sessionStorage.setItem("lattice-desktop-window-session-id", desktopWindowSessionId);
    window.localStorage.setItem("lattice-desktop-window-sessions", JSON.stringify({
      [desktopWindowSessionId]: Date.now(),
    }));
    return originalSettings;
  }, { rootPath: workspacePath, extensions: extensionInventories });
  await page.waitForFunction(async (rootPath) => {
    const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    const settings = await invoke("get_setting", { key: "lattice-settings" });
    return settings?.lastWorkspacePath === rootPath
      && settings?.lastOpenedFolder === rootPath
      && settings?.lastWorkspaceKey === `desktop:${rootPath}`;
  }, workspacePath, { timeout: ASSERT_TIMEOUT_MS });
  await page.reload({ waitUntil: "domcontentloaded" });
  return originalSettings;
}

async function readDesktopText(page, filePath) {
  return page.evaluate(async (targetPath) => {
    const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    return invoke("desktop_read_text_file", { path: targetPath });
  }, filePath);
}

async function pathExistsThroughDesktop(page, filePath) {
  return page.evaluate(async (targetPath) => {
    const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
    try {
      await invoke("desktop_read_text_file", { path: targetPath });
      return true;
    } catch {
      return false;
    }
  }, filePath);
}

async function main() {
  const startedAt = Date.now();
  const runId = Date.now();
  const exePath = normalizePath(process.env.LATTICE_DESKTOP_EXE ?? DEFAULT_EXE);
  const extensionPath = await resolveClaudeExtensionPath();
  const workspacePath = normalizePath(path.join(OUTPUT_DIR, `code-tools-workspace-${runId}`));
  const desktopProfilePath = normalizePath(path.join(OUTPUT_DIR, `desktop-profile-${runId}`));
  const fixtureExtensionPath = `${desktopProfilePath}/fixture-extension`;
  const workspaceName = path.basename(workspacePath);
  const mainFilePath = `${workspacePath}/main.js`;
  const noteFilePath = `${workspacePath}/notes.md`;
  const moveFileName = `move-me-${runId}.txt`;
  const moveSourcePath = `${workspacePath}/${moveFileName}`;
  const targetDirectoryName = `target-${runId}`;
  const targetDirectoryPath = `${workspacePath}/${targetDirectoryName}`;
  const moveTargetPath = `${targetDirectoryPath}/${moveFileName}`;
  const extensionInteractionMarkerPath = `${workspacePath}/extension-interaction.txt`;

  await access(exePath);
  await access(path.join(extensionPath, "package.json"));
  await mkdir(workspacePath, { recursive: true });
  await mkdir(desktopProfilePath, { recursive: true });
  await mkdir(fixtureExtensionPath, { recursive: true });
  await mkdir(targetDirectoryPath, { recursive: true });
  await writeFile(mainFilePath, 'console.log("initial");\n', "utf8");
  await writeFile(moveSourcePath, "move-through-lattice-ui\n", "utf8");
  await writeFile(noteFilePath, "# Notes\n", "utf8");
  await mkdir(OUTPUT_DIR, { recursive: true });

  const fixturePackageJson = {
    publisher: "lattice",
    name: "desktop-smoke",
    displayName: "Lattice Desktop Smoke",
    version: "1.0.0",
    engines: { vscode: "^1.85.0" },
    main: "extension.js",
    activationEvents: ["onCommand:lattice.smoke.choose"],
    contributes: {
      commands: [{ command: "lattice.smoke.choose", title: "Lattice Smoke: Choose Mode" }],
    },
  };
  await writeFile(
    path.join(fixtureExtensionPath, "package.json"),
    `${JSON.stringify(fixturePackageJson, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(fixtureExtensionPath, "extension.js"),
    [
      'const fs = require("fs");',
      'const vscode = require("vscode");',
      "exports.activate = (context) => {",
      '  context.subscriptions.push(vscode.commands.registerCommand("lattice.smoke.choose", async () => {',
      "    const selected = await vscode.window.showQuickPick(",
      '      [{ label: "Real extension host" }, { label: "Cancel path" }],',
      '      { title: "Choose smoke mode", placeHolder: "Select the real host path" },',
      "    );",
      '    if (selected?.label === "Real extension host") {',
      `      fs.writeFileSync(${JSON.stringify(extensionInteractionMarkerPath)}, ${JSON.stringify(`${EXTENSION_INTERACTION_MARKER}\n`)}, "utf8");`,
      "    }",
      "  }));",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );

  const packageJson = JSON.parse(await readFile(path.join(extensionPath, "package.json"), "utf8"));
  const primaryExtensionId = `${packageJson.publisher}.${packageJson.name}`.toLowerCase();
  const isKiloExtension = primaryExtensionId === "kilocode.kilo-code";
  const isClaudeExtension = primaryExtensionId === "anthropic.claude-code";
  const isCodexExtension = primaryExtensionId === "openai.chatgpt";
  const extensionInventories = [
    buildExtensionInventory(extensionPath, packageJson),
    buildExtensionInventory(fixtureExtensionPath, fixturePackageJson),
  ];
  const cdpPort = await getAvailablePort();

  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    env: {
      ...process.env,
      APPDATA: desktopProfilePath,
      LOCALAPPDATA: desktopProfilePath,
      WEBVIEW2_USER_DATA_FOLDER: path.join(desktopProfilePath, "webview2"),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${cdpPort} --remote-allow-origins=*`,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: false,
  });
  const stdout = [];
  const stderr = [];
  const pageErrors = [];
  const consoleErrors = [];
  const previewResourceFailures = [];
  const httpFailures = [];
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk).toString("utf8")));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk).toString("utf8")));

  let browser;
  let page;
  let originalSettings;
  let runOutputVisible = false;
  try {
    logStage("waiting for desktop CDP");
    await waitForHttpOk(`http://127.0.0.1:${cdpPort}/json/version`, ASSERT_TIMEOUT_MS);
    const cdpReadyMs = Date.now() - startedAt;
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`);
    page = await waitForDesktopPage(browser, ASSERT_TIMEOUT_MS);
    page.setDefaultTimeout(ASSERT_TIMEOUT_MS);
    page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && httpFailures.length < 40) {
        httpFailures.push({ status: response.status(), url: response.url() });
      }
      if (response.status() >= 400 && response.url().includes("lattice-preview")) {
        previewResourceFailures.push({ status: response.status(), url: response.url() });
      }
    });
    await page.addInitScript(() => {
      const trace = [];
      Object.defineProperty(window, "__latticeSmokeWebviewMessageTrace", {
        configurable: true,
        value: trace,
      });
      window.addEventListener("message", (event) => {
        if (trace.length >= 80) return;
        const data = event.data;
        trace.push({
          direction: "received",
          origin: event.origin,
          sourceIsSelf: event.source === window,
          type: data && typeof data === "object" ? data.type ?? null : null,
          marker: data && typeof data === "object" ? data.marker ?? null : null,
        });
      }, true);
    });
    await page.evaluate(() => {
      const trace = [];
      Object.defineProperty(window, "__latticeSmokeHostMessageTrace", {
        configurable: true,
        value: trace,
      });
      window.addEventListener("message", (event) => {
        const data = event.data;
        if (
          trace.length >= 80 ||
          !data ||
          data.type !== "lattice-vscode-webview-message"
        ) {
          return;
        }
        trace.push({
          origin: event.origin,
          type: data.message && typeof data.message === "object" ? data.message.type ?? null : null,
          marker: data.message && typeof data.message === "object" ? data.message.marker ?? null : null,
        });
      }, true);
    });
    logStage("waiting for the first Lattice desktop surface before workspace restoration");
    await page.getByTestId("desktop-commandbar-workspace").waitFor({
      timeout: FIRST_LAUNCH_READY_LIMIT_MS,
    });
    const firstLaunchReadyMs = Date.now() - startedAt;
    logStage("seeding isolated workspace and extension profile");
    originalSettings = await seedProductSession(page, workspacePath, extensionInventories);

    logStage("waiting for Lattice workspace tree");
    await page.getByText("Lattice", { exact: true }).first().waitFor();
    const fileExplorerButton = page
      .getByTestId("desktop-activity-rail")
      .getByRole("button", { name: "File Explorer", exact: true });
    if (await fileExplorerButton.getAttribute("aria-pressed") !== "true") {
      await fileExplorerButton.click();
    }
    // The restored workspace is deliberately excluded from the recent-workspace menu.
    // Waiting for the visible root tests the product restore path without a false fallback.
    const workspaceRootNode = page
      .locator('button[data-explorer-node="true"]:visible', { hasText: workspaceName })
      .last();
    await workspaceRootNode.waitFor({ timeout: Math.min(30_000, ASSERT_TIMEOUT_MS) });
    const workspaceTreeReadyMs = Date.now() - startedAt;
    const mainFileNode = page.locator('button[data-explorer-node="true"]', { hasText: "main.js" }).first();
    if (!await mainFileNode.isVisible()) {
      await workspaceRootNode.click();
    }
    await mainFileNode.click();
    logStage("waiting for Lattice code editor");
    await page.locator(".code-editor .cm-editor").waitFor();
    const minimap = page.getByTestId("code-minimap");
    await minimap.waitFor();
    const minimapPresent = await minimap.count() > 0;
    const editorReadyMs = Date.now() - startedAt;
    if (await page.getByTestId("native-vscode-workbench-pane").count()) {
      throw new Error("Full VS Code Workbench pane rendered in the Lattice center area.");
    }

    const editor = page.locator(".code-editor .cm-content").first();
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(`console.log("${RUN_MARKER}");`);
    await page.locator('[data-testid="desktop-commandbar-actions"] button[aria-label="Save"]').click();
    await page.waitForFunction(async ({ targetPath, marker }) => {
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      const content = await invoke("desktop_read_text_file", { path: targetPath });
      return content.includes(marker);
    }, { targetPath: mainFilePath, marker: RUN_MARKER });

    logStage("running saved JavaScript through the Lattice runner");
    await page.locator('[data-testid="desktop-commandbar-actions"] button[aria-label="Run"]').click();
    await page.getByText(RUN_MARKER, { exact: false }).last().waitFor();
    runOutputVisible = true;
    const savedContent = await readDesktopText(page, mainFilePath);

    await page.locator('button[data-explorer-node="true"]', { hasText: moveFileName }).click();
    await page.locator(".code-editor .cm-editor").waitFor();
    const moveSource = page.locator('button[data-explorer-node="true"]', { hasText: moveFileName }).first();
    const moveTarget = page.locator('button[data-explorer-node="true"]', { hasText: targetDirectoryName }).first();
    logStage("moving the active text file through Explorer drag and drop");
    await moveSource.evaluate((source, target) => {
      const dataTransfer = new DataTransfer();
      source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer }));
      source.dispatchEvent(new DragEvent("dragend", { bubbles: true, cancelable: true, dataTransfer }));
    }, await moveTarget.elementHandle());
    await page.waitForFunction(async ({ sourcePath, targetPath }) => {
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      const exists = async (candidate) => {
        try { await invoke("desktop_read_text_file", { path: candidate }); return true; } catch { return false; }
      };
      return !await exists(sourcePath) && await exists(targetPath);
    }, { sourcePath: moveSourcePath, targetPath: moveTargetPath });
    await page.getByTestId("desktop-commandbar-breadcrumbs").getByText(targetDirectoryName, { exact: true }).waitFor();

    logStage("opening VS Code Tools and waiting for the real extension host command");
    await page.getByRole("button", { name: "VS Code", exact: true }).click();
    await page.getByTestId("vscode-activity-panel").waitFor();
    const toolLabels = ["Explorer", "Search", "Source Control", "Run and Debug", "Extensions", "Commands", "Terminal"];
    for (const label of toolLabels) {
      await page.getByTestId("vscode-activity-panel").getByRole("button", { name: label, exact: true }).waitFor();
    }
    await page.getByTestId("vscode-activity-panel").getByRole("button", { name: "Commands", exact: true }).click();
    if (isClaudeExtension) {
      const hostCommand = page.getByRole("button", { name: "Claude Code: Show Logs", exact: true });
      await hostCommand.waitFor();
    }
    if (await page.getByText(/Extension entry not found:/i).count()) {
      throw new Error("Extension entry path is stale in the desktop extension host.");
    }
    const toolsNavigation = page
      .getByTestId("vscode-activity-panel")
      .getByRole("navigation", { name: "VS Code Tools" });
    if (await toolsNavigation.getByRole("button", { name: packageJson.displayName, exact: true }).count()) {
      throw new Error("Contributed extensions must not be rendered in the fixed VS Code Tools navigation.");
    }
    await page.getByTestId("vscode-activity-panel").getByRole("button", { name: "Extensions", exact: true }).click();
    const primaryExtension = page
      .getByTestId("vscode-activity-panel")
      .getByRole("button", { name: packageJson.displayName, exact: true })
      .first();
    await primaryExtension.waitFor();
    logStage(isClaudeExtension
      ? "opening the real Claude Code contributed webview from the Extensions content panel"
      : `opening ${packageJson.displayName} contributed view from the Extensions content panel`);
    await primaryExtension.click();
    const primaryWebview = page.getByTestId("vscode-activity-panel").locator("iframe").first();
    await primaryWebview.waitFor();
    const primaryFrameHandle = await primaryWebview.elementHandle();
    const primaryFrame = await primaryFrameHandle?.contentFrame();
    if (!primaryFrame) {
      throw new Error(`${packageJson.displayName} contributed webview frame is unavailable.`);
    }
    await primaryFrame.locator("#root").waitFor();
    await primaryFrame.waitForFunction(
      () => (document.querySelector("#root")?.childElementCount ?? 0) > 0,
      null,
      { timeout: Math.min(30_000, ASSERT_TIMEOUT_MS) },
    );
    const extensionWebviewRootChildren = await primaryFrame.locator("#root").evaluate((element) => element.childElementCount);
    let kiloInitialized = null;
    let kiloInputVisible = null;
    let kiloInputRoundTrip = null;
    let kiloThemeApplied = null;
    let kiloThemeKind = null;
    let kiloFontFamily = null;
    let kiloFontSize = null;
    let kiloHostOverflow = null;
    let codexViewReady = null;
    let codexHostSnapshot = null;
    let codexWebviewDocument = null;
    let codexWebviewMessageTrace = null;
    let codexHostMessageTrace = null;
    if (isKiloExtension) {
      await primaryFrame.waitForFunction(
        () => !document.body.innerText.includes("Initializing..."),
        null,
        { timeout: Math.min(60_000, ASSERT_TIMEOUT_MS) },
      );
      const kiloInput = primaryFrame.locator('textarea, [contenteditable="true"]').last();
      await kiloInput.waitFor({ state: "visible", timeout: Math.min(30_000, ASSERT_TIMEOUT_MS) });
      kiloInitialized = true;
      kiloInputVisible = await kiloInput.isVisible();
      const kiloSmokeInput = `Lattice Kilo smoke ${Date.now()}`;
      await kiloInput.fill(kiloSmokeInput);
      kiloInputRoundTrip = (await kiloInput.inputValue().catch(() => kiloInput.textContent())) === kiloSmokeInput;
      const kiloVisualState = await primaryFrame.evaluate(() => {
        const rootStyle = getComputedStyle(document.documentElement);
        const bodyStyle = getComputedStyle(document.body);
        return {
          themeKind: document.documentElement.dataset.vscodeThemeKind ?? null,
          hasThemeClass: document.documentElement.classList.contains("vscode-light")
            || document.documentElement.classList.contains("vscode-dark"),
          themeFontFamily: rootStyle.getPropertyValue("--vscode-font-family").trim(),
          fontFamily: bodyStyle.fontFamily,
          fontSize: bodyStyle.fontSize,
        };
      });
      kiloThemeApplied = kiloVisualState.hasThemeClass && kiloVisualState.themeFontFamily.length > 0;
      kiloThemeKind = kiloVisualState.themeKind;
      kiloFontFamily = kiloVisualState.fontFamily;
      kiloFontSize = kiloVisualState.fontSize;
      kiloHostOverflow = await primaryWebview.evaluate((frame) => (
        frame.parentElement ? getComputedStyle(frame.parentElement).overflow : null
      ));
      if (!kiloThemeApplied) {
        throw new Error("Kilo Code webview is missing the VS Code theme contract.");
      }
      if (/times new roman|(?:^|,\s*)serif$/i.test(kiloFontFamily)) {
        throw new Error(`Kilo Code webview fell back to an unthemed serif font: ${kiloFontFamily}`);
      }
      if (Number.parseFloat(kiloFontSize) > 14) {
        throw new Error(`Kilo Code webview font is larger than the VS Code panel scale: ${kiloFontSize}`);
      }
      if (!kiloHostOverflow?.includes("hidden")) {
        throw new Error(`Kilo Code webview host must not create a second scroll container: ${kiloHostOverflow}`);
      }
      await kiloInput.fill("");
      await primaryWebview.screenshot({ path: path.join(OUTPUT_DIR, "kilo-webview-themed.png") });
    }
    if (isCodexExtension) {
      codexWebviewDocument = await primaryFrame.evaluate(() => ({
        baseHref: document.querySelector("base")?.getAttribute("href") ?? null,
        baseUri: document.baseURI,
        contentSecurityPolicy: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content") ?? null,
      }));
      codexViewReady = await primaryFrame.waitForFunction(() => {
        const isVisible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const interactive = Array.from(document.querySelectorAll(
          'button, input, textarea, a[href], [contenteditable="true"], [role="button"]',
        )).some(isVisible);
        const visibleText = document.body.innerText.replace(/\s+/g, " ").trim();
        return interactive || visibleText.length > 8;
      }, null, { timeout: Math.min(60_000, ASSERT_TIMEOUT_MS) }).then(() => true).catch(() => false);
      codexHostSnapshot = await page.evaluate(async () => {
        const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
        return invoke("desktop_get_vscode_extension_host_snapshot");
      });
      codexWebviewMessageTrace = await primaryFrame.evaluate(() => window.__latticeSmokeWebviewMessageTrace ?? []);
      codexHostMessageTrace = await page.evaluate(() => window.__latticeSmokeHostMessageTrace ?? []);
      await primaryWebview.screenshot({ path: path.join(OUTPUT_DIR, "codex-webview.png") });
      if (!codexViewReady) {
        const codexState = codexHostSnapshot.extensions?.find((extension) => extension.id === "openai.chatgpt");
        throw new Error(`Codex contributed view did not become interactive: ${JSON.stringify({
          status: codexHostSnapshot.status,
          runtime: codexHostSnapshot.runtime,
          extension: codexState,
          lastError: codexHostSnapshot.lastError,
          webviewDocument: codexWebviewDocument,
          webviewMessageTrace: codexWebviewMessageTrace,
          hostMessageTrace: codexHostMessageTrace,
          previewResourceFailures,
          httpFailures,
        })}`);
      }
    }
    if (await page.getByTestId("native-vscode-workbench-pane").count()) {
      throw new Error("Full VS Code Workbench pane rendered after opening VS Code Tools.");
    }
    await page.getByTestId("vscode-activity-panel").getByRole("button", { name: "Commands", exact: true }).click();
    const interactiveHostCommand = page.getByRole("button", { name: "Lattice Smoke: Choose Mode", exact: true });
    await interactiveHostCommand.waitFor();
    await interactiveHostCommand.evaluate((element) => {
      const reactPropsKey = Object.keys(element).find((key) => key.startsWith("__reactProps"));
      const onClick = reactPropsKey ? element[reactPropsKey]?.onClick : null;
      if (typeof onClick !== "function") {
        throw new Error("VS Code command button is missing its React click handler.");
      }
      onClick();
    });
    const interactionDialog = page.getByRole("dialog", { name: "Choose smoke mode" });
    await interactionDialog.waitFor();
    await interactionDialog.getByRole("option", { name: /Real extension host/ }).click();
    await page.waitForFunction(async ({ targetPath, marker }) => {
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      try {
        const content = await invoke("desktop_read_text_file", { path: targetPath });
        return content.includes(marker);
      } catch {
        return false;
      }
    }, { targetPath: extensionInteractionMarkerPath, marker: EXTENSION_INTERACTION_MARKER });
    const extensionInteractionContent = await readDesktopText(page, extensionInteractionMarkerPath);

    logStage("opening and saving a Markdown note through the Lattice editor");
    await fileExplorerButton.click();
    await page.locator('button[data-explorer-node="true"]', { hasText: "notes.md" }).click();
    await page.getByTestId("desktop-commandbar-breadcrumbs").getByText("notes.md", { exact: true }).waitFor();
    await page.getByTestId("desktop-commandbar-actions").getByRole("button", { name: "Source", exact: true }).click();
    const noteEditor = page.locator(".live-preview-editor .cm-content").first();
    await noteEditor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(`# Notes\n\n${NOTE_MARKER}`);
    await page.locator('[data-testid="desktop-commandbar-actions"] button[aria-label="Save"]').click();
    await page.waitForFunction(async ({ targetPath, marker }) => {
      const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
      const content = await invoke("desktop_read_text_file", { path: targetPath });
      return content.includes(marker);
    }, { targetPath: noteFilePath, marker: NOTE_MARKER });
    const noteContent = await readDesktopText(page, noteFilePath);

    const result = {
      generatedAt: new Date().toISOString(),
      exePath,
      workspacePath,
      activeUrl: page.url(),
      cdpReadyMs,
      firstLaunchReadyMs,
      editorReadyMs,
      workspaceTreeReadyMs,
      minimapPresent,
      totalMs: Date.now() - startedAt,
      saved: savedContent.includes(RUN_MARKER),
      ran: runOutputVisible,
      noteSaved: noteContent.includes(NOTE_MARKER),
      moved: !await pathExistsThroughDesktop(page, moveSourcePath) && await pathExistsThroughDesktop(page, moveTargetPath),
      tools: toolLabels,
      primaryExtensionId,
      extensionCommand: isClaudeExtension ? "Claude Code: Show Logs" : null,
      extensionWebviewRendered: extensionWebviewRootChildren > 0,
      claudeWebviewRendered: isClaudeExtension ? extensionWebviewRootChildren > 0 : null,
      kiloInitialized,
      kiloInputVisible,
      kiloInputRoundTrip,
      kiloThemeApplied,
      kiloThemeKind,
      kiloFontFamily,
      kiloFontSize,
      kiloHostOverflow,
      codexViewReady,
      codexHostSnapshot,
      codexWebviewDocument,
      codexWebviewMessageTrace,
      codexHostMessageTrace,
      previewResourceFailures,
      httpFailures,
      interactiveExtensionCommand: "Lattice Smoke: Choose Mode",
      interactiveExtensionSelected: extensionInteractionContent.includes(EXTENSION_INTERACTION_MARKER),
      fullWorkbenchPresent: await page.getByTestId("native-vscode-workbench-pane").count() > 0,
      pageErrors,
      consoleErrors,
    };
    await writeFile(path.join(OUTPUT_DIR, "desktop-code-tools-smoke.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    if (!result.noteSaved) {
      throw new Error("Markdown note was not persisted by the Lattice editor.");
    }
    if (!result.minimapPresent) {
      throw new Error("The Lattice code editor did not render its minimap.");
    }
    console.log(`[desktop-code-tools-smoke] passed ${JSON.stringify(result)}`);
  } catch (error) {
    if (page) {
      await page.screenshot({ path: path.join(OUTPUT_DIR, "desktop-code-tools-smoke-failure.png"), fullPage: true }).catch(() => {});
    }
    throw error;
  } finally {
    if (page && originalSettings) {
      await page.evaluate(async (settings) => {
        const invoke = window.__TAURI__?.core?.invoke ?? window.__TAURI_INTERNALS__?.invoke;
        await invoke("set_setting", { key: "lattice-settings", value: settings });
      }, originalSettings).catch(() => {});
    }
    if (!child.killed) child.kill();
    await browser?.close().catch(() => {});
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
    await writeFile(path.join(OUTPUT_DIR, "desktop-code-tools-smoke-process.log"), [
      "STAGES:",
      JSON.stringify(STAGES, null, 2),
      "",
      "STDOUT:",
      ...stdout,
      "",
      "STDERR:",
      ...stderr,
      "",
      "PAGE ERRORS:",
      ...pageErrors,
      "",
      "CONSOLE ERRORS:",
      ...consoleErrors,
      "",
      "PREVIEW RESOURCE FAILURES:",
      JSON.stringify(previewResourceFailures, null, 2),
    ].join("\n"), "utf8").catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});

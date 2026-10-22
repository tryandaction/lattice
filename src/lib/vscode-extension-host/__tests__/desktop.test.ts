import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeTauriCommand: vi.fn(),
  isTauriHost: vi.fn(() => true),
}));

vi.mock("@/lib/storage-adapter", () => ({
  invokeTauriCommand: mocks.invokeTauriCommand,
  isTauriHost: mocks.isTauriHost,
}));

import {
  activateVSCodeExtensionHostExtension,
  activateVSCodeExtensionHostView,
  canUseVSCodeExtensionHost,
  changeVSCodeExtensionHostDocument,
  drainVSCodeExtensionHostViewMessages,
  getVSCodeExtensionHostSnapshot,
  openVSCodeExtensionHostDocument,
  postVSCodeExtensionHostViewMessage,
  requestVSCodeExtensionHostLanguageFeature,
  resolveVSCodeExtensionHostTree,
  resolveVSCodeExtensionHostView,
  runVSCodeExtensionHostCommand,
  saveVSCodeExtensionHostDocument,
  startVSCodeExtensionHost,
  stopVSCodeExtensionHost,
} from "@/lib/vscode-extension-host/desktop";

describe("VS Code extension host desktop bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauriHost.mockReturnValue(true);
  });

  it("reflects desktop runtime availability", () => {
    expect(canUseVSCodeExtensionHost()).toBe(true);
    mocks.isTauriHost.mockReturnValue(false);
    expect(canUseVSCodeExtensionHost()).toBe(false);
  });

  it("starts the host through Tauri", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "ready", commands: [] });

    await startVSCodeExtensionHost({
      workspaceRootPath: "C:/vault",
      extensions: [
        {
          id: "publisher.demo",
          path: "C:/vault/.vscode/extensions/publisher.demo",
          main: "./extension.js",
          activationEvents: ["onCommand:publisher.demo.hello"],
        },
      ],
    });

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_start_vscode_extension_host",
      expect.objectContaining({
        request: expect.objectContaining({
          workspaceRootPath: "C:/vault",
          extensions: expect.arrayContaining([
            expect.objectContaining({
              id: "publisher.demo",
              main: "./extension.js",
            }),
          ]),
        }),
      }),
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("reads the current host snapshot", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "ready", commands: [] });

    await getVSCodeExtensionHostSnapshot();

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_get_vscode_extension_host_snapshot",
      undefined,
      expect.objectContaining({ timeoutMs: 4000 }),
    );
  });

  it("activates an imported extension through Tauri", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "ready", commands: [] });

    await activateVSCodeExtensionHostExtension("publisher.demo");

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_activate_vscode_extension",
      { request: { extensionId: "publisher.demo" } },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("activates a contributed view before resolving its content", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({
      status: "ready",
      commands: [],
      views: [{
        id: "publisher.demo.tree",
        title: "Demo Tree",
        extensionId: "publisher.demo",
        container: "publisher.demo",
        kind: "tree",
        source: "host",
      }],
    });

    await activateVSCodeExtensionHostView("publisher.demo.tree");

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_activate_vscode_extension_view",
      { request: { viewId: "publisher.demo.tree" } },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("runs host-backed commands", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "ready", commands: [] });

    await runVSCodeExtensionHostCommand("publisher.demo.hello");

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_run_vscode_extension_command",
      { request: { commandId: "publisher.demo.hello" } },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("runs host-backed commands with arguments", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "ready", commands: [] });

    await runVSCodeExtensionHostCommand("publisher.demo.open", ["item-1"]);

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_run_vscode_extension_command",
      { request: { commandId: "publisher.demo.open", args: ["item-1"] } },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("opens documents through the request wrapper", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "ready", commands: [] });

    await openVSCodeExtensionHostDocument({
      filePath: "C:/vault/demo.py",
      languageId: "python",
      content: "print('hello')",
      version: 1,
    });

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_open_vscode_extension_document",
      {
        request: {
          filePath: "C:/vault/demo.py",
          languageId: "python",
          content: "print('hello')",
          version: 1,
        },
      },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("synchronizes changed and saved documents through fixed Tauri commands", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "ready", commands: [] });

    const document = {
      filePath: "C:/vault/demo.ts",
      languageId: "typescript",
      content: "const answer = 42;",
      version: 2,
    };
    await changeVSCodeExtensionHostDocument(document);
    await saveVSCodeExtensionHostDocument(document);

    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(
      1,
      "desktop_change_vscode_extension_document",
      { request: document },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
    expect(mocks.invokeTauriCommand).toHaveBeenNthCalledWith(
      2,
      "desktop_save_vscode_extension_document",
      { request: document },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("requests a language feature through the extension host", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({
      ok: true,
      feature: "completion",
      documentVersion: 2,
      providers: [],
      results: [],
    });

    await requestVSCodeExtensionHostLanguageFeature({
      feature: "completion",
      filePath: "C:/vault/demo.ts",
      languageId: "typescript",
      version: 2,
      position: { line: 0, character: 12 },
      triggerCharacter: ".",
    });

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_request_vscode_extension_language_feature",
      {
        request: {
          feature: "completion",
          filePath: "C:/vault/demo.ts",
          languageId: "typescript",
          version: 2,
          position: { line: 0, character: 12 },
          triggerCharacter: ".",
        },
      },
      expect.objectContaining({ timeoutMs: 1800 }),
    );
  });

  it("resolves host-backed webview views", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({
      viewId: "claude-code.chat",
      title: "Claude Code",
      extensionId: "anthropic.claude-code",
      html: "<main>Claude</main>",
      options: { enableScripts: true, retainContextWhenHidden: true },
      source: "host",
    });

    const webview = await resolveVSCodeExtensionHostView("claude-code.chat");

    expect(webview.options).toEqual({ enableScripts: true, retainContextWhenHidden: true });

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_resolve_vscode_extension_view",
      { request: { viewId: "claude-code.chat" } },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("posts messages back to host-backed webview views", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "ready", commands: [], views: [] });

    await postVSCodeExtensionHostViewMessage("claude-code.chat", { action: "send", text: "hello" });

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_post_vscode_extension_view_message",
      { request: { viewId: "claude-code.chat", message: { action: "send", text: "hello" } } },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("drains asynchronous host-backed webview messages", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ viewId: "kilo-code.SidebarProvider", messages: [] });

    await drainVSCodeExtensionHostViewMessages("kilo-code.SidebarProvider");

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_post_vscode_extension_view_message",
      { request: { viewId: "kilo-code.SidebarProvider", drainOnly: true } },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("resolves host-backed tree views", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({
      viewId: "python.environments",
      title: "Python Environments",
      extensionId: "ms-python.python",
      items: [{ id: "item-0", label: ".venv", collapsibleState: "none" }],
      source: "host",
    });

    await resolveVSCodeExtensionHostTree("python.environments");

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_resolve_vscode_extension_tree",
      { request: { viewId: "python.environments" } },
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });

  it("stops the host through Tauri", async () => {
    mocks.invokeTauriCommand.mockResolvedValue({ status: "idle", commands: [] });

    await stopVSCodeExtensionHost();

    expect(mocks.invokeTauriCommand).toHaveBeenCalledWith(
      "desktop_stop_vscode_extension_host",
      undefined,
      expect.objectContaining({ timeoutMs: 15000 }),
    );
  });
});

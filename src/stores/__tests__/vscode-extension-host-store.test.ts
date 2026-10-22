import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVSCodeExtensionHostStore } from "@/stores/vscode-extension-host-store";
import { createDefaultVSCodeWorkbenchSettings } from "@/lib/vscode-compat/mapper";

const desktopMocks = vi.hoisted(() => ({
  activateVSCodeExtensionHostExtension: vi.fn(),
  activateVSCodeExtensionHostView: vi.fn(),
  canUseVSCodeExtensionHost: vi.fn(() => true),
  changeVSCodeExtensionHostDocument: vi.fn(),
  drainVSCodeExtensionHostViewMessages: vi.fn(),
  getVSCodeExtensionHostSnapshot: vi.fn(),
  openVSCodeExtensionHostDocument: vi.fn(),
  postVSCodeExtensionHostViewMessage: vi.fn(),
  requestVSCodeExtensionHostLanguageFeature: vi.fn(),
  resolveVSCodeExtensionHostTree: vi.fn(),
  resolveVSCodeExtensionHostInteraction: vi.fn(),
  resolveVSCodeExtensionHostView: vi.fn(),
  runVSCodeExtensionHostCommand: vi.fn(),
  saveVSCodeExtensionHostDocument: vi.fn(),
  startVSCodeExtensionHost: vi.fn(),
  stopVSCodeExtensionHost: vi.fn(),
}));

vi.mock("@/lib/vscode-extension-host/desktop", () => ({
  activateVSCodeExtensionHostExtension: desktopMocks.activateVSCodeExtensionHostExtension,
  activateVSCodeExtensionHostView: desktopMocks.activateVSCodeExtensionHostView,
  canUseVSCodeExtensionHost: desktopMocks.canUseVSCodeExtensionHost,
  changeVSCodeExtensionHostDocument: desktopMocks.changeVSCodeExtensionHostDocument,
  drainVSCodeExtensionHostViewMessages: desktopMocks.drainVSCodeExtensionHostViewMessages,
  getVSCodeExtensionHostSnapshot: desktopMocks.getVSCodeExtensionHostSnapshot,
  openVSCodeExtensionHostDocument: desktopMocks.openVSCodeExtensionHostDocument,
  postVSCodeExtensionHostViewMessage: desktopMocks.postVSCodeExtensionHostViewMessage,
  requestVSCodeExtensionHostLanguageFeature: desktopMocks.requestVSCodeExtensionHostLanguageFeature,
  resolveVSCodeExtensionHostTree: desktopMocks.resolveVSCodeExtensionHostTree,
  resolveVSCodeExtensionHostInteraction: desktopMocks.resolveVSCodeExtensionHostInteraction,
  resolveVSCodeExtensionHostView: desktopMocks.resolveVSCodeExtensionHostView,
  runVSCodeExtensionHostCommand: desktopMocks.runVSCodeExtensionHostCommand,
  saveVSCodeExtensionHostDocument: desktopMocks.saveVSCodeExtensionHostDocument,
  startVSCodeExtensionHost: desktopMocks.startVSCodeExtensionHost,
  stopVSCodeExtensionHost: desktopMocks.stopVSCodeExtensionHost,
}));

describe("vscode extension host store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    desktopMocks.canUseVSCodeExtensionHost.mockReturnValue(true);
    desktopMocks.stopVSCodeExtensionHost.mockResolvedValue({
      status: "idle",
      runtime: "none",
      commandCount: 0,
      activeExtensionCount: 0,
      commands: [],
      views: [],
      extensions: [],
      lastError: null,
    });
    useVSCodeExtensionHostStore.setState({
      snapshot: {
        status: "idle",
        runtime: "none",
        commandCount: 0,
        activeExtensionCount: 0,
        commands: [],
        views: [],
        extensions: [],
        lastError: null,
      },
      pendingInteraction: null,
      manifestCommands: [],
      hostExtensionCount: 0,
      lastSignature: null,
    });
  });

  it("starts the desktop host from imported compat extensions", async () => {
    desktopMocks.startVSCodeExtensionHost.mockResolvedValue({
      status: "ready",
      runtime: "node",
      commandCount: 2,
      activeExtensionCount: 1,
      commands: [],
      views: [],
      lastError: null,
    });

    await useVSCodeExtensionHostStore.getState().syncWithCompat({
      enabled: true,
      workspaceRootPath: "C:/vault",
      settings: createDefaultVSCodeWorkbenchSettings(),
      extensions: [
        {
          id: "publisher.demo",
          source: "installed",
          path: "C:/ext/demo",
          main: "./extension.js",
          activationEvents: ["onCommand:publisher.demo.hello"],
          contributes: {
            languages: [],
            snippets: [],
            commands: 1,
            commandItems: [
              { command: "publisher.demo.hello", title: "Hello Demo" },
            ],
            debuggers: 0,
            configuration: false,
            views: [],
            viewContainers: [],
            menus: 0,
            notebooks: [],
            notebookRenderers: [],
            grammars: [],
            themes: [],
          },
        },
      ],
    });

    expect(desktopMocks.startVSCodeExtensionHost).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceRootPath: "C:/vault",
        configuration: expect.objectContaining({
          "editor.tabSize": expect.any(Number),
        }),
        extensions: expect.arrayContaining([
          expect.objectContaining({
            id: "publisher.demo",
            main: "./extension.js",
            packageJSON: expect.objectContaining({
              name: "demo",
              publisher: "publisher",
              contributes: expect.objectContaining({
                commands: [{ command: "publisher.demo.hello", title: "Hello Demo" }],
              }),
            }),
          }),
        ]),
      }),
    );
    expect(useVSCodeExtensionHostStore.getState().manifestCommands).toEqual([
      expect.objectContaining({ id: "publisher.demo.hello", title: "Hello Demo" }),
    ]);
    expect(useVSCodeExtensionHostStore.getState().snapshot.commands).toEqual([]);
  });

  it("coalesces concurrent host starts for the same compatibility state", async () => {
    let resolveStart!: (snapshot: {
      status: "ready";
      runtime: "node";
      commandCount: number;
      activeExtensionCount: number;
      commands: never[];
      views: never[];
      extensions: never[];
      lastError: null;
    }) => void;
    desktopMocks.startVSCodeExtensionHost.mockImplementation(() => new Promise((resolve) => {
      resolveStart = resolve;
    }));
    const input = {
      enabled: true,
      workspaceRootPath: "C:/vault",
      settings: createDefaultVSCodeWorkbenchSettings(),
      extensions: [{
        id: "publisher.demo",
        source: "installed" as const,
        path: "C:/ext/demo",
        main: "./extension.js",
      }],
    };

    const first = useVSCodeExtensionHostStore.getState().syncWithCompat(input);
    const second = useVSCodeExtensionHostStore.getState().syncWithCompat(input);
    await Promise.resolve();
    expect(desktopMocks.startVSCodeExtensionHost).toHaveBeenCalledTimes(1);

    resolveStart({
      status: "ready",
      runtime: "node",
      commandCount: 0,
      activeExtensionCount: 1,
      commands: [],
      views: [],
      extensions: [],
      lastError: null,
    });
    await Promise.all([first, second]);
    expect(desktopMocks.startVSCodeExtensionHost).toHaveBeenCalledTimes(1);
  });

  it("waits for a starting host before activating a contributed view", async () => {
    let resolveStart!: (snapshot: {
      status: "ready";
      runtime: "node";
      commandCount: number;
      activeExtensionCount: number;
      commands: never[];
      views: never[];
      extensions: never[];
      lastError: null;
    }) => void;
    desktopMocks.startVSCodeExtensionHost.mockImplementation(() => new Promise((resolve) => {
      resolveStart = resolve;
    }));
    desktopMocks.activateVSCodeExtensionHostView.mockResolvedValue({
      status: "ready",
      runtime: "node",
      commandCount: 0,
      activeExtensionCount: 1,
      commands: [],
      views: [{
        id: "publisher.demo.view",
        title: "Demo View",
        extensionId: "publisher.demo",
        container: "publisher.demo",
        kind: "webview",
        source: "host",
      }],
      extensions: [],
      lastError: null,
    });
    const start = useVSCodeExtensionHostStore.getState().syncWithCompat({
      enabled: true,
      workspaceRootPath: "C:/vault",
      settings: createDefaultVSCodeWorkbenchSettings(),
      extensions: [{
        id: "publisher.demo",
        source: "installed",
        path: "C:/ext/demo",
        main: "./extension.js",
      }],
    });
    await Promise.resolve();

    const activate = useVSCodeExtensionHostStore.getState().activateView("publisher.demo.view");
    expect(desktopMocks.activateVSCodeExtensionHostView).not.toHaveBeenCalled();

    resolveStart({
      status: "ready",
      runtime: "node",
      commandCount: 0,
      activeExtensionCount: 1,
      commands: [],
      views: [],
      extensions: [],
      lastError: null,
    });
    await Promise.all([start, activate]);

    expect(desktopMocks.activateVSCodeExtensionHostView).toHaveBeenCalledWith("publisher.demo.view");
  });

  it("waits for a stale empty-state stop before starting the current host", async () => {
    let resolveStop!: (snapshot: {
      status: "idle";
      runtime: "none";
      commandCount: number;
      activeExtensionCount: number;
      commands: never[];
      views: never[];
      extensions: never[];
      lastError: null;
    }) => void;
    desktopMocks.stopVSCodeExtensionHost.mockImplementation(() => new Promise((resolve) => {
      resolveStop = resolve;
    }));
    desktopMocks.startVSCodeExtensionHost.mockResolvedValue({
      status: "ready",
      runtime: "node",
      commandCount: 0,
      activeExtensionCount: 1,
      commands: [],
      views: [],
      extensions: [],
      lastError: null,
    });

    const staleEmptySync = useVSCodeExtensionHostStore.getState().syncWithCompat({
      enabled: true,
      workspaceRootPath: "C:/vault",
      settings: createDefaultVSCodeWorkbenchSettings(),
      extensions: [],
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(desktopMocks.stopVSCodeExtensionHost).toHaveBeenCalledTimes(1);

    const currentExtensionSync = useVSCodeExtensionHostStore.getState().syncWithCompat({
      enabled: true,
      workspaceRootPath: "C:/vault",
      settings: createDefaultVSCodeWorkbenchSettings(),
      extensions: [{
        id: "publisher.demo",
        source: "installed",
        path: "C:/ext/demo",
        main: "./extension.js",
      }],
    });

    const startedBeforeStaleStopCompleted = desktopMocks.startVSCodeExtensionHost.mock.calls.length > 0;

    resolveStop({
      status: "idle",
      runtime: "none",
      commandCount: 0,
      activeExtensionCount: 0,
      commands: [],
      views: [],
      extensions: [],
      lastError: null,
    });
    await Promise.all([staleEmptySync, currentExtensionSync]);

    expect(startedBeforeStaleStopCompleted).toBe(false);
    expect(desktopMocks.startVSCodeExtensionHost).toHaveBeenCalledTimes(1);
    expect(useVSCodeExtensionHostStore.getState().snapshot.status).toBe("ready");
  });

  it("records desktop host startup failures in the snapshot", async () => {
    desktopMocks.startVSCodeExtensionHost.mockRejectedValue(new Error("extension host bridge failed"));

    await expect(useVSCodeExtensionHostStore.getState().syncWithCompat({
      enabled: true,
      workspaceRootPath: "C:/vault",
      settings: createDefaultVSCodeWorkbenchSettings(),
      extensions: [{
        id: "publisher.demo",
        source: "installed",
        path: "C:/ext/demo",
        main: "./extension.js",
      }],
    })).rejects.toThrow("extension host bridge failed");

    expect(useVSCodeExtensionHostStore.getState().snapshot).toMatchObject({
      status: "error",
      runtime: "node",
      lastError: "extension host bridge failed",
    });
  });

  it("becomes unavailable when no runnable extensions exist", async () => {
    await useVSCodeExtensionHostStore.getState().syncWithCompat({
      enabled: true,
      workspaceRootPath: "C:/vault",
      settings: createDefaultVSCodeWorkbenchSettings(),
      extensions: [
        { id: "publisher.demo", source: "installed" },
      ],
    });

    expect(desktopMocks.startVSCodeExtensionHost).not.toHaveBeenCalled();
    expect(useVSCodeExtensionHostStore.getState().snapshot.status).toBe("unavailable");
  });

  it("runs host commands through the desktop bridge", async () => {
    desktopMocks.runVSCodeExtensionHostCommand.mockResolvedValue({ snapshot: {
      status: "ready",
      runtime: "node",
      commandCount: 1,
      activeExtensionCount: 1,
      commands: [{ id: "publisher.demo.hello", title: "Hello Demo", extensionId: "publisher.demo", source: "host" }],
      views: [],
      lastError: null,
    } });

    await useVSCodeExtensionHostStore.getState().runCommand("publisher.demo.hello");

    expect(desktopMocks.runVSCodeExtensionHostCommand).toHaveBeenCalledWith("publisher.demo.hello", []);
    expect(useVSCodeExtensionHostStore.getState().snapshot.commandCount).toBe(1);
  });

  it("keeps a real extension quick pick pending until Lattice resolves it", async () => {
    const snapshot = {
      status: "ready" as const,
      runtime: "node" as const,
      commandCount: 1,
      activeExtensionCount: 1,
      commands: [],
      views: [],
      extensions: [],
      lastError: null,
    };
    const interaction = {
      id: "interaction-1",
      type: "quickPick" as const,
      title: "Choose a formatter",
      placeHolder: "Select one",
      canPickMany: false,
      items: [
        { id: "item-0", label: "Prettier", description: "Default formatter" },
        { id: "item-1", label: "Built-in" },
      ],
    };
    desktopMocks.runVSCodeExtensionHostCommand.mockResolvedValue({ snapshot, interaction });

    await useVSCodeExtensionHostStore.getState().runCommand("publisher.demo.chooseFormatter");

    expect(useVSCodeExtensionHostStore.getState().snapshot).toEqual(snapshot);
    expect(useVSCodeExtensionHostStore.getState().pendingInteraction).toEqual(interaction);
  });

  it("resumes the extension command and clears the completed interaction", async () => {
    const snapshot = {
      status: "ready" as const,
      runtime: "node" as const,
      commandCount: 2,
      activeExtensionCount: 1,
      commands: [],
      views: [],
      extensions: [],
      lastError: null,
    };
    useVSCodeExtensionHostStore.setState({
      pendingInteraction: {
        id: "interaction-1",
        type: "quickPick",
        items: [{ id: "item-0", label: "Prettier" }],
      },
    });
    desktopMocks.resolveVSCodeExtensionHostInteraction.mockResolvedValue({ snapshot });

    await useVSCodeExtensionHostStore.getState().resolveInteraction({
      interactionId: "interaction-1",
      cancelled: false,
      selectedIds: ["item-0"],
    });

    expect(desktopMocks.resolveVSCodeExtensionHostInteraction).toHaveBeenCalledWith({
      interactionId: "interaction-1",
      cancelled: false,
      selectedIds: ["item-0"],
    });
    expect(useVSCodeExtensionHostStore.getState().snapshot).toEqual(snapshot);
    expect(useVSCodeExtensionHostStore.getState().pendingInteraction).toBeNull();
  });

  it("activates an imported extension and stores its real host status", async () => {
    desktopMocks.activateVSCodeExtensionHostExtension.mockResolvedValue({
      status: "ready",
      runtime: "node",
      commandCount: 0,
      activeExtensionCount: 1,
      commands: [],
      views: [],
      extensions: [{
        id: "publisher.demo",
        status: "active",
        commandCount: 0,
        viewCount: 0,
      }],
      lastError: null,
    });

    await useVSCodeExtensionHostStore.getState().activateExtension("publisher.demo");

    expect(desktopMocks.activateVSCodeExtensionHostExtension).toHaveBeenCalledWith("publisher.demo");
    expect(useVSCodeExtensionHostStore.getState().snapshot.extensions[0]?.status).toBe("active");
  });

  it("activates manifest views and stores the registered container and kind", async () => {
    desktopMocks.activateVSCodeExtensionHostView.mockResolvedValue({
      status: "ready",
      runtime: "node",
      commandCount: 0,
      activeExtensionCount: 1,
      commands: [],
      views: [{
        id: "publisher.demo.tree",
        title: "Demo Tree",
        extensionId: "publisher.demo",
        container: "publisher.demo",
        kind: "tree",
        source: "host",
      }],
      extensions: [],
      lastError: null,
    });

    await useVSCodeExtensionHostStore.getState().activateView("publisher.demo.tree");

    expect(desktopMocks.activateVSCodeExtensionHostView).toHaveBeenCalledWith("publisher.demo.tree");
    expect(useVSCodeExtensionHostStore.getState().snapshot.views[0]).toMatchObject({
      id: "publisher.demo.tree",
      container: "publisher.demo",
      kind: "tree",
    });
  });

  it("notifies the host when a code document opens", async () => {
    useVSCodeExtensionHostStore.setState({
      snapshot: {
        status: "ready",
        runtime: "node",
        commandCount: 0,
        activeExtensionCount: 1,
        commands: [],
        views: [],
        extensions: [],
        lastError: null,
      },
    });
    desktopMocks.openVSCodeExtensionHostDocument.mockResolvedValue({
      status: "ready",
      runtime: "node",
      commandCount: 12,
      activeExtensionCount: 2,
      commands: [],
      views: [],
      lastError: null,
    });

    await useVSCodeExtensionHostStore.getState().openDocument({
      filePath: "C:/vault/app.py",
      languageId: "python",
      content: "print('hello')",
    });

    expect(desktopMocks.openVSCodeExtensionHostDocument).toHaveBeenCalledWith({
      filePath: "C:/vault/app.py",
      languageId: "python",
      content: "print('hello')",
      version: 1,
    });
    expect(useVSCodeExtensionHostStore.getState().snapshot.activeExtensionCount).toBe(2);
  });

  it("does not notify documents before the host is ready", async () => {
    await useVSCodeExtensionHostStore.getState().openDocument({
      filePath: "C:/vault/app.py",
      languageId: "python",
    });

    expect(desktopMocks.openVSCodeExtensionHostDocument).not.toHaveBeenCalled();
  });

  it("resolves host webview views through the desktop bridge", async () => {
    desktopMocks.resolveVSCodeExtensionHostView.mockResolvedValue({
      viewId: "claude-code.chat",
      title: "Claude Code",
      extensionId: "anthropic.claude-code",
      html: "<main>Claude</main>",
      source: "host",
    });

    const webview = await useVSCodeExtensionHostStore.getState().resolveView("claude-code.chat");

    expect(desktopMocks.resolveVSCodeExtensionHostView).toHaveBeenCalledWith("claude-code.chat");
    expect(webview.html).toContain("Claude");
  });

  it("posts host webview messages through the desktop bridge", async () => {
    desktopMocks.postVSCodeExtensionHostViewMessage.mockResolvedValue({
      viewId: "claude-code.chat",
      messages: [{ ready: true }],
      snapshot: {
        status: "ready",
        runtime: "node",
        commandCount: 0,
        activeExtensionCount: 1,
        commands: [],
        views: [],
        lastError: null,
      },
    });

    const messages = await useVSCodeExtensionHostStore.getState().postViewMessage("claude-code.chat", { text: "hello" });

    expect(desktopMocks.postVSCodeExtensionHostViewMessage).toHaveBeenCalledWith("claude-code.chat", { text: "hello" });
    expect(messages).toEqual([{ ready: true }]);
    expect(useVSCodeExtensionHostStore.getState().snapshot.status).toBe("ready");
  });

  it("drains asynchronous host webview messages without posting another webview event", async () => {
    desktopMocks.drainVSCodeExtensionHostViewMessages.mockResolvedValue({
      viewId: "kilo-code.SidebarProvider",
      messages: [{ type: "configLoaded" }],
      snapshot: {
        status: "ready",
        runtime: "node",
        commandCount: 0,
        activeExtensionCount: 1,
        commands: [],
        views: [],
        lastError: null,
      },
    });

    const messages = await useVSCodeExtensionHostStore.getState().drainViewMessages("kilo-code.SidebarProvider");

    expect(desktopMocks.drainVSCodeExtensionHostViewMessages).toHaveBeenCalledWith("kilo-code.SidebarProvider");
    expect(messages).toEqual([{ type: "configLoaded" }]);
  });

  it("resolves host tree views through the desktop bridge", async () => {
    desktopMocks.resolveVSCodeExtensionHostTree.mockResolvedValue({
      viewId: "python.environments",
      title: "Python Environments",
      extensionId: "ms-python.python",
      items: [{ id: "item-0", label: ".venv", collapsibleState: "none" }],
      source: "host",
    });

    const tree = await useVSCodeExtensionHostStore.getState().resolveTree("python.environments");

    expect(desktopMocks.resolveVSCodeExtensionHostTree).toHaveBeenCalledWith("python.environments");
    expect(tree.items[0]?.label).toBe(".venv");
  });
});

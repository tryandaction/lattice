/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { VSCodeActivityPanel } from "../vscode-activity-panel";
import { setLocale } from "@/lib/i18n";
import { DEFAULT_SETTINGS } from "@/types/settings";
import { readVSCodeConfigFromDetectedProfiles } from "@/lib/vscode-compat/auto-discovery";
import { readDesktopFileBytesRaw } from "@/lib/desktop-preview";
import { openDesktopTerminalAtPath } from "@/lib/desktop-openers";
import { createDefaultVSCodeWorkbenchSettings } from "@/lib/vscode-compat/mapper";
import { useSettingsStore } from "@/stores/settings-store";
import { useVSCodeCompatStore } from "@/stores/vscode-compat-store";
import { useVSCodeExtensionHostStore } from "@/stores/vscode-extension-host-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

vi.mock("@/lib/vscode-compat/source-control", () => ({
  EMPTY_VSCODE_SOURCE_CONTROL_SNAPSHOT: {
    available: false,
    repositoryRoot: null,
    branch: null,
    ahead: 0,
    behind: 0,
    changes: [],
    error: null,
  },
  getVSCodeSourceControlStatus: vi.fn(async () => ({
    available: true,
    repositoryRoot: "C:/workspace",
    branch: "main",
    ahead: 1,
    behind: 0,
    changes: [{
      path: "src/app.tsx",
      originalPath: null,
      index: "M",
      worktree: " ",
      status: "M ",
      staged: true,
      unstaged: false,
      conflict: false,
      untracked: false,
    }],
    error: null,
  })),
  getVSCodeSourceControlDiff: vi.fn(async () => ({
    path: "src/app.tsx",
    staged: true,
    content: "diff --git",
    binary: false,
    truncated: false,
    error: null,
  })),
  stageVSCodeSourceControlPaths: vi.fn(),
  unstageVSCodeSourceControlPaths: vi.fn(),
  stageAllVSCodeSourceControlChanges: vi.fn(),
  unstageAllVSCodeSourceControlChanges: vi.fn(),
  commitVSCodeSourceControlChanges: vi.fn(),
}));

vi.mock("@/lib/vscode-compat/auto-discovery", () => ({
  readVSCodeConfigFromDetectedProfiles: vi.fn(async () => ({
    config: { settings: { "editor.tabSize": 4 }, extensions: [] },
    sourceLabel: "VS Code (1 file, 0 extensions)",
    discoveredFiles: ["User/settings.json"],
    warnings: [],
  })),
}));

vi.mock("@/lib/desktop-preview", () => ({
  readDesktopFileBytesRaw: vi.fn(async () => new Uint8Array([1, 2, 3])),
  setDesktopPreviewRoot: vi.fn(async () => undefined),
}));

vi.mock("@/lib/desktop-openers", () => ({
  openDesktopTerminalAtPath: vi.fn(async () => undefined),
}));

vi.mock("../vscode-run-debug-panel", () => ({
  VSCodeRunDebugPanel: () => (
    <div data-testid="vscode-run-debug-panel">Run and Debug content</div>
  ),
}));

vi.mock("../vscode-webview-frame", () => ({
  VSCodeWebviewFrame: ({ content }: { content: { title: string } }) => (
    <div data-testid="host-webview">{content.title}</div>
  ),
}));

vi.mock("@/components/explorer/explorer-sidebar", () => ({
  ExplorerSidebar: () => <div data-testid="vscode-explorer-content">Explorer content</div>,
}));

vi.mock("@/components/layout/workspace-search-panel", () => ({
  WorkspaceSearchPanel: () => <div data-testid="vscode-search-content">Search content</div>,
}));

describe("VSCodeActivityPanel", () => {
  beforeEach(() => {
    setLocale("en-US");
    vi.clearAllMocks();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:lattice-extension-icon"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, language: 'en-US', vscodeCompatEnabled: true },
      isInitialized: true,
      isLoading: false,
      error: null,
    });
    useVSCodeCompatStore.setState({
      settings: createDefaultVSCodeWorkbenchSettings(),
      keybindings: [],
      snippets: [],
      tasks: [{ label: "build", type: "shell", command: "npm", args: ["run", "build"] }],
      launches: [{ name: "Python App", type: "python", request: "launch", program: "app.py", args: [] }],
      extensions: [{
        id: "publisher.demo",
        displayName: "Demo Extension",
        source: "installed",
        path: "C:/extensions/demo",
        icon: "C:/extensions/demo/icon.png",
        main: "./extension.js",
        contributes: {
          languages: [],
          snippets: [],
          commands: 1,
          commandItems: [{ command: "publisher.demo.hello", title: "Hello Demo" }],
          debuggers: 0,
          configuration: false,
          views: [
            { container: "publisher.demo", id: "publisher.demo.tree", name: "Demo Tree" },
            { container: "publisher.demo", id: "publisher.demo.webview", name: "Demo Webview" },
          ],
          viewContainers: ["publisher.demo"],
          viewContainerItems: [{
            id: "publisher.demo",
            title: "Demo Tools",
            location: "activitybar",
            icon: "C:/extensions/demo/activity.svg",
          }],
          menus: 0,
          notebooks: [],
          notebookRenderers: [],
          grammars: [],
          themes: [],
        },
      }],
      importedAt: Date.now(),
      sourceLabel: "VS Code",
      warnings: [],
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
      manifestCommands: [],
      hostExtensionCount: 0,
      lastSignature: null,
    });
    useWorkspaceStore.getState().setWorkspaceRootPath("C:/workspace");
    useVSCodeExtensionHostStore.setState({
      snapshot: {
        status: "ready",
        runtime: "node",
        commandCount: 1,
        activeExtensionCount: 1,
        commands: [{
          id: "publisher.demo.hello",
          title: "Hello Demo",
          extensionId: "publisher.demo",
          source: "host",
        }],
        views: [
          {
            id: "publisher.demo.tree",
            title: "Demo Tree",
            extensionId: "publisher.demo",
            container: "publisher.demo",
            kind: "tree",
            source: "host",
          },
          {
            id: "publisher.demo.webview",
            title: "Demo Webview",
            extensionId: "publisher.demo",
            container: "publisher.demo",
            kind: "webview",
            source: "host",
          },
        ],
        extensions: [{
          id: "publisher.demo",
          displayName: "Demo Extension",
          status: "active",
          commandCount: 1,
          viewCount: 2,
        }],
        lastError: null,
      },
      manifestCommands: [],
      hostExtensionCount: 1,
      lastSignature: "ready",
      syncWithCompat: vi.fn(async () => undefined),
      activateExtension: vi.fn(async () => useVSCodeExtensionHostStore.getState().snapshot),
      activateView: vi.fn(async () => useVSCodeExtensionHostStore.getState().snapshot),
      runCommand: vi.fn(async () => undefined),
      resolveTree: vi.fn(async () => ({
        viewId: "publisher.demo.tree",
        title: "Demo Tree",
        extensionId: "publisher.demo",
        items: [{ id: "root", label: "Workspace", collapsibleState: "expanded" as const, children: [
          { id: "child", label: "app.py", collapsibleState: "none" as const },
        ] }],
        source: "host" as const,
      })),
      resolveView: vi.fn(async () => ({
        viewId: "publisher.demo.webview",
        title: "Demo Webview",
        extensionId: "publisher.demo",
        html: "<main>Demo</main>",
        options: { enableScripts: true, retainContextWhenHidden: true },
        source: "host" as const,
      })),
      postViewMessage: vi.fn(async () => []),
    });
  });

  it("keeps VS Code tools in the left sidebar and switches built-in views", () => {
    render(<VSCodeActivityPanel />);

    const navigation = screen.getByRole("navigation", { name: "VS Code Tools" });
    expect(navigation.className).toContain("overflow-x-auto");
    expect(screen.getByRole("button", { name: "Explorer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Search" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Source Control" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Run and Debug" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Extensions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Commands" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Terminal" })).toBeTruthy();
    expect(screen.getByTestId("vscode-explorer-content")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(screen.getByTestId("vscode-search-content")).toBeTruthy();
    expect(screen.queryByTestId("vscode-explorer-content")).toBeNull();
  });

  it("opens a real terminal at the current Lattice workspace", async () => {
    render(<VSCodeActivityPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Terminal" }));

    await waitFor(() => {
      expect(openDesktopTerminalAtPath).toHaveBeenCalledWith("C:/workspace");
    });
  });

  it("shows the real terminal launch failure instead of reporting success", async () => {
    vi.mocked(openDesktopTerminalAtPath).mockRejectedValueOnce(new Error("Terminal unavailable"));
    render(<VSCodeActivityPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Terminal" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Terminal" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Terminal unavailable");
  });

  it("syncs the extension host and composes extensions, commands, and native debugging", async () => {
    render(<VSCodeActivityPanel />);

    await waitFor(() => {
      expect(useVSCodeExtensionHostStore.getState().syncWithCompat).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          workspaceRootPath: "C:/workspace",
          extensions: expect.arrayContaining([expect.objectContaining({ id: "publisher.demo" })]),
        }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));
    expect(screen.getByRole("button", { name: "Demo Extension" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Demo Tree" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Demo Extension" }));
    expect(await screen.findByText("Workspace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Demo Extension" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Demo Tree" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Demo Webview" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Commands" }));
    fireEvent.click(screen.getByRole("button", { name: "Hello Demo" }));
    expect(useVSCodeExtensionHostStore.getState().runCommand).toHaveBeenCalledWith("publisher.demo.hello");

    fireEvent.click(screen.getByRole("button", { name: "Run and Debug" }));
    expect(screen.getByTestId("vscode-run-debug-panel")).toBeTruthy();
  });

  it("exposes pending manifest commands so the host can activate extensions on command", () => {
    useVSCodeExtensionHostStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        commandCount: 0,
        commands: [],
      },
      manifestCommands: [{
        id: "publisher.demo.hello",
        title: "Hello Demo",
        extensionId: "publisher.demo",
        source: "host",
      }],
    }));

    render(<VSCodeActivityPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Commands" }));

    fireEvent.click(screen.getByRole("button", { name: "Hello Demo" }));
    expect(useVSCodeExtensionHostStore.getState().runCommand).toHaveBeenCalledWith("publisher.demo.hello");
  });

  it("activates a contributed extension when its single plugin row is opened", async () => {
    const activateExtension = vi.fn(async () => useVSCodeExtensionHostStore.getState().snapshot);
    useVSCodeExtensionHostStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        activeExtensionCount: 0,
        extensions: state.snapshot.extensions.map((extension) => ({
          ...extension,
          status: "pending" as const,
        })),
      },
      activateExtension,
    }));

    render(<VSCodeActivityPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Demo Extension" }));
    });
    await waitFor(() => expect(activateExtension).toHaveBeenCalledWith("publisher.demo"));
  });

  it("refreshes detected profiles once when an installed extension entry moved", async () => {
    const staleExtension = useVSCodeCompatStore.getState().extensions[0]!;
    vi.mocked(readVSCodeConfigFromDetectedProfiles).mockResolvedValueOnce({
      config: {
        extensions: [{
          ...staleExtension,
          path: "C:/extensions/demo-current",
          icon: "C:/extensions/demo-current/icon.svg",
        }],
      },
      sourceLabel: "VS Code (1 extension)",
      discoveredFiles: ["VS Code/extensions/*/package.json"],
      warnings: [],
    });
    useVSCodeExtensionHostStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        extensions: state.snapshot.extensions.map((extension) => ({
          ...extension,
          status: "failed" as const,
          error: "Extension entry not found: C:/extensions/demo-old/extension.js",
        })),
      },
    }));

    render(<VSCodeActivityPanel />);

    await waitFor(() => {
      expect(useVSCodeCompatStore.getState().extensions[0]?.path).toBe("C:/extensions/demo-current");
    });
    expect(readVSCodeConfigFromDetectedProfiles).toHaveBeenCalledTimes(1);
  });

  it("resolves contributed tree and webview tools lazily inside the sidebar", async () => {
    render(<VSCodeActivityPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));

    expect(useVSCodeExtensionHostStore.getState().resolveTree).not.toHaveBeenCalled();
    expect(useVSCodeExtensionHostStore.getState().resolveView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Demo Extension" }));
    expect(await screen.findByText("Workspace")).toBeTruthy();
    expect(screen.getByText("app.py")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hello Demo" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Demo Webview" }));
    });
    const webview = await screen.findByTestId("host-webview");
    expect(webview.parentElement?.classList.contains("overflow-hidden")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("button", { name: "Demo Extension" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Hello Demo" })).toBeNull();
  });

  it("loads real source control status instead of rendering an icon-only placeholder", async () => {
    render(<VSCodeActivityPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Source Control" }));

    expect(await screen.findByText("main")).toBeTruthy();
    expect(screen.getByText("src/app.tsx")).toBeTruthy();
  });

  it("provides an executable import action when no extension configuration is loaded", async () => {
    useVSCodeCompatStore.setState({
      extensions: [],
      tasks: [],
      launches: [],
      importedAt: null,
      sourceLabel: null,
      warnings: [],
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
      manifestCommands: [],
      hostExtensionCount: 0,
      lastSignature: null,
    });

    render(<VSCodeActivityPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));
    fireEvent.click(screen.getByRole("button", { name: "Import VS Code profile" }));

    await waitFor(() => {
      expect(useVSCodeCompatStore.getState().importedAt).not.toBeNull();
    });
  });

  it("keeps contributed extension containers out of the top tool bar", async () => {
    render(<VSCodeActivityPanel />);

    const navigation = screen.getByRole("navigation", { name: "VS Code Tools" });
    expect(within(navigation).queryByRole("button", { name: "Demo Tools" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));
    fireEvent.click(screen.getByRole("button", { name: "Demo Extension" }));

    expect(await screen.findByText("Workspace")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Demo Extension" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Demo Tree" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Demo Webview" })).toBeNull();
  });

  it("loads a contributed tool icon from its real extension resource", async () => {
    render(<VSCodeActivityPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));

    await waitFor(() => {
      expect(screen.getByTitle("Demo Extension").tagName).toBe("IMG");
    });
    expect(readDesktopFileBytesRaw).toHaveBeenCalledWith("C:/extensions/demo/icon.png");
  });

  it("activates an unresolved manifest view before resolving its registered kind", async () => {
    const activatedSnapshot = {
      ...useVSCodeExtensionHostStore.getState().snapshot,
      views: [{
        id: "publisher.demo.tree",
        title: "Demo Tree",
        extensionId: "publisher.demo",
        container: "publisher.demo",
        kind: "tree" as const,
        source: "host" as const,
      }],
      extensions: [{
        id: "publisher.demo",
        displayName: "Demo Extension",
        status: "active" as const,
        commandCount: 0,
        viewCount: 1,
      }],
    };
    useVSCodeExtensionHostStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        views: [],
        extensions: [{
          id: "publisher.demo",
          displayName: "Demo Extension",
          status: "skipped",
          commandCount: 0,
          viewCount: 0,
        }],
      },
      activateView: vi.fn(async () => activatedSnapshot),
    }));

    render(<VSCodeActivityPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));
    fireEvent.click(screen.getByRole("button", { name: "Demo Extension" }));

    await waitFor(() => {
      expect(useVSCodeExtensionHostStore.getState().activateExtension).toHaveBeenCalledWith("publisher.demo");
      expect(useVSCodeExtensionHostStore.getState().activateView).toHaveBeenCalledWith("publisher.demo.tree");
    });
    expect(await screen.findByText("Workspace")).toBeTruthy();
  });

  it("shows exact extension activation errors and missing APIs", () => {
    useVSCodeExtensionHostStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        views: [],
        extensions: [{
          id: "publisher.demo",
          displayName: "Demo Extension",
          status: "failed",
          commandCount: 0,
          viewCount: 0,
          error: "VS Code API shim missing: window.createQuickPick",
          missingApi: ["window.createQuickPick"],
        }],
      },
    }));

    render(<VSCodeActivityPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Extensions" }));

    expect(screen.getByText("VS Code API shim missing: window.createQuickPick")).toBeTruthy();
    expect(screen.getByText("window.createQuickPick")).toBeTruthy();
  });

  it("attaches views contributed to Explorer to the built-in tool", async () => {
    const imported = useVSCodeCompatStore.getState().extensions[0]!;
    useVSCodeCompatStore.setState({
      extensions: [{
        ...imported,
        contributes: {
          ...imported.contributes!,
          views: [{ container: "explorer", id: "publisher.demo.tree", name: "Explorer Demo" }],
          viewContainers: ["explorer"],
          viewContainerItems: [],
        },
      }],
    });
    useVSCodeExtensionHostStore.setState((state) => ({
      snapshot: {
        ...state.snapshot,
        views: state.snapshot.views.map((view) => view.id === "publisher.demo.tree"
          ? { ...view, title: "Explorer Demo", container: "explorer" }
          : view),
      },
    }));

    render(<VSCodeActivityPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Extension Views (1)" }));
    expect(await screen.findByText("Explorer Demo")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Demo Extension" })).toBeNull();
  });
});

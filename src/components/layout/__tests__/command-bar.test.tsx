/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandBar } from "../command-bar";
import { DesktopWindowFrame } from "../desktop-window-frame";

const workspaceState = {
  rootHandle: { name: "workspace" },
  workspaceRootPath: "C:/workspace",
  layout: {
    activePaneId: "pane-1",
  },
  commandBarByPane: {},
  getActiveTab: () => ({ id: "tab-1", filePath: "workspace/notes.md" }),
};

const desktopWindowMocks = vi.hoisted(() => {
  let stateListener: ((payload: { isMaximized: boolean }) => void) | null = null;
  return {
    isWindowsDesktopHost: vi.fn(() => true),
    isDesktopWindowMaximized: vi.fn(async () => false),
    toggleDesktopWindowMaximize: vi.fn(async () => true),
    minimizeDesktopWindow: vi.fn(async () => undefined),
    closeDesktopWindow: vi.fn(async () => undefined),
    startDesktopWindowDrag: vi.fn(async () => undefined),
    startDesktopWindowResize: vi.fn(async () => undefined),
    subscribeDesktopWindowState: vi.fn(async (listener: (payload: { isMaximized: boolean }) => void) => {
      stateListener = listener;
      return () => {
        stateListener = null;
      };
    }),
    emitWindowState(payload: { isMaximized: boolean }) {
      stateListener?.(payload);
    },
    reset() {
      stateListener = null;
    },
  };
});

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: typeof workspaceState) => unknown) => selector(workspaceState),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/lib/desktop-window", () => ({
  isWindowsDesktopHost: desktopWindowMocks.isWindowsDesktopHost,
  isDesktopWindowMaximized: desktopWindowMocks.isDesktopWindowMaximized,
  toggleDesktopWindowMaximize: desktopWindowMocks.toggleDesktopWindowMaximize,
  minimizeDesktopWindow: desktopWindowMocks.minimizeDesktopWindow,
  closeDesktopWindow: desktopWindowMocks.closeDesktopWindow,
  startDesktopWindowDrag: desktopWindowMocks.startDesktopWindowDrag,
  startDesktopWindowResize: desktopWindowMocks.startDesktopWindowResize,
  subscribeDesktopWindowState: desktopWindowMocks.subscribeDesktopWindowState,
}));

describe("CommandBar desktop interactions", () => {
  beforeEach(() => {
    desktopWindowMocks.reset();
    desktopWindowMocks.isDesktopWindowMaximized.mockClear();
    desktopWindowMocks.toggleDesktopWindowMaximize.mockClear();
    desktopWindowMocks.minimizeDesktopWindow.mockClear();
    desktopWindowMocks.closeDesktopWindow.mockClear();
    desktopWindowMocks.startDesktopWindowResize.mockClear();
    desktopWindowMocks.subscribeDesktopWindowState.mockClear();
    workspaceState.commandBarByPane = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("syncs maximized state from desktop window events and supports title double-click maximize", async () => {
    render(
      <CommandBar
        onOpenWorkspace={() => {}}
      />,
    );

    await waitFor(() => {
      expect(desktopWindowMocks.subscribeDesktopWindowState).toHaveBeenCalledTimes(1);
    });

    fireEvent.doubleClick(screen.getByTestId("desktop-commandbar-title"));
    expect(desktopWindowMocks.toggleDesktopWindowMaximize).toHaveBeenCalledTimes(1);

    await act(async () => {
      desktopWindowMocks.emitWindowState({ isMaximized: true });
    });

    await waitFor(() => {
      expect(screen.getByLabelText("workbench.window.restore")).not.toBeNull();
    });
  });

  it("keeps title mouse down out of the JS dragging path", async () => {
    render(
      <CommandBar
        onOpenWorkspace={() => {}}
      />,
    );

    fireEvent.mouseDown(screen.getByTestId("desktop-commandbar-title"));

    await waitFor(() => {
      expect(desktopWindowMocks.startDesktopWindowDrag).not.toHaveBeenCalled();
    });
  });

  it("does not route window button clicks into the dragging path", async () => {
    render(
      <CommandBar
        onOpenWorkspace={() => {}}
      />,
    );

    fireEvent.mouseDown(screen.getByTestId("desktop-window-control-minimize"));
    fireEvent.click(screen.getByTestId("desktop-window-control-minimize"));

    await waitFor(() => {
      expect(desktopWindowMocks.minimizeDesktopWindow).toHaveBeenCalledTimes(1);
      expect(desktopWindowMocks.startDesktopWindowDrag).not.toHaveBeenCalled();
    });
  });

  it("starts resize dragging from desktop resize handles", async () => {
    render(<DesktopWindowFrame />);

    fireEvent.mouseDown(screen.getByTestId("desktop-resize-east"));

    await waitFor(() => {
      expect(desktopWindowMocks.startDesktopWindowResize).toHaveBeenCalledWith("east");
    });
  });

  it("keeps the window controls in a dedicated non-drag hitbox", () => {
    render(
      <>
        <DesktopWindowFrame />
        <CommandBar
          onOpenWorkspace={() => {}}
        />
      </>,
    );

    expect(screen.getByTestId("desktop-window-controls").getAttribute("data-tauri-drag-region")).toBe("false");
    expect(screen.getByTestId("desktop-window-control-minimize").getAttribute("data-tauri-drag-region")).toBe("false");
    expect(screen.getByTestId("desktop-window-control-maximize").getAttribute("data-tauri-drag-region")).toBe("false");
    expect(screen.getByTestId("desktop-window-control-close").getAttribute("data-tauri-drag-region")).toBe("false");
    expect(screen.getByTestId("desktop-window-controls").closest('[data-desktop-webview-safe-zone="true"]')).not.toBeNull();
  });

  it("opens the workspace switcher from the workspace chip", async () => {
    const onOpenWorkspace = vi.fn();
    const onOpenRecentWorkspace = vi.fn();

    render(
      <CommandBar
        onOpenWorkspace={onOpenWorkspace}
        recentWorkspaces={["C:/workspace", "C:/archive"]}
        onOpenRecentWorkspace={onOpenRecentWorkspace}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("desktop-commandbar-workspace"));
    });
    expect(screen.getByTestId("desktop-commandbar-workspace-menu")).not.toBeNull();
    expect(onOpenWorkspace).not.toHaveBeenCalled();
    expect(screen.getByTestId("desktop-commandbar-workspace").textContent).toContain("workspace");

    await act(async () => {
      fireEvent.click(screen.getByText("C:/archive"));
    });
    expect(onOpenRecentWorkspace).toHaveBeenCalledWith("C:/archive");
  });

  it("opens the system folder picker from the workspace menu", async () => {
    const onOpenWorkspace = vi.fn();

    render(
      <CommandBar
        onOpenWorkspace={onOpenWorkspace}
        recentWorkspaces={["C:/workspace"]}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("desktop-commandbar-workspace"));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("desktop-commandbar-workspace-open-folder"));
    });

    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
  });

  it("shows breadcrumbs relative to the workspace root", () => {
    render(
      <CommandBar
        onOpenWorkspace={() => {}}
      />,
    );

    expect(screen.getByTestId("desktop-commandbar-breadcrumbs").textContent).toBe("notes.md");
  });

  it("renders distinct icons and active state for command bar actions", () => {
    const commandBarByPane = workspaceState.commandBarByPane as Record<string, unknown>;
    commandBarByPane["pane-1"] = {
      breadcrumbs: [],
      actions: [
        { id: "fit-width", label: "Fit width", icon: "arrow-left-right", active: true, group: "secondary", onTrigger: () => {} },
        { id: "fit-page", label: "Fit page", icon: "maximize-2", group: "secondary", onTrigger: () => {} },
      ],
    };

    render(
      <CommandBar
        onOpenWorkspace={() => {}}
      />,
    );

    const fitWidthButton = screen.getByLabelText("Fit width");
    const fitPageButton = screen.getByLabelText("Fit page");

    expect(fitWidthButton.getAttribute("aria-pressed")).toBe("true");
    expect(fitPageButton.getAttribute("aria-pressed")).toBeNull();
    expect(fitWidthButton.innerHTML).not.toBe(fitPageButton.innerHTML);
  });

  it("renders distinct icons for Word search and import actions", () => {
    const commandBarByPane = workspaceState.commandBarByPane as Record<string, unknown>;
    commandBarByPane["pane-1"] = {
      breadcrumbs: [],
      actions: [
        { id: "search", label: "Search", icon: "search", group: "secondary", onTrigger: () => {} },
        { id: "import-as-note", label: "Import", icon: "file-output", group: "primary", onTrigger: () => {} },
      ],
    };

    render(
      <CommandBar
        onOpenWorkspace={() => {}}
      />,
    );

    expect(screen.getByLabelText("Search").innerHTML).not.toBe(screen.getByLabelText("Import").innerHTML);
  });

  it("renders distinct browser-style icons for web navigation actions", () => {
    const commandBarByPane = workspaceState.commandBarByPane as Record<string, unknown>;
    commandBarByPane["pane-1"] = {
      breadcrumbs: [{ label: "example.com" }],
      actions: [
        { id: "back", label: "后退", icon: "arrow-left", group: "primary", onTrigger: () => {} },
        { id: "forward", label: "前进", icon: "arrow-right", group: "primary", onTrigger: () => {} },
        { id: "reload", label: "刷新网页", icon: "rotate-cw", group: "primary", onTrigger: () => {} },
        { id: "open-external", label: "浏览器打开", icon: "external-link", group: "secondary", onTrigger: () => {} },
      ],
    };

    render(
      <CommandBar
        onOpenWorkspace={() => {}}
      />,
    );

    const backButton = screen.getByLabelText("后退");
    const forwardButton = screen.getByLabelText("前进");
    const reloadButton = screen.getByLabelText("刷新网页");
    const externalButton = screen.getByLabelText("浏览器打开");

    expect(backButton.innerHTML).not.toBe(forwardButton.innerHTML);
    expect(backButton.innerHTML).not.toBe(reloadButton.innerHTML);
    expect(reloadButton.innerHTML).not.toBe(externalButton.innerHTML);
  });

  it("uses tooltip text for icon-only web actions", () => {
    const commandBarByPane = workspaceState.commandBarByPane as Record<string, unknown>;
    commandBarByPane["pane-1"] = {
      breadcrumbs: [{ label: "example.com" }],
      actions: [
        {
          id: "copy-url",
          label: "复制网址",
          tooltip: "复制网址：https://example.com/paper",
          icon: "globe",
          group: "utility",
          onTrigger: () => {},
        },
      ],
    };

    render(
      <CommandBar
        onOpenWorkspace={() => {}}
      />,
    );

    const button = screen.getByLabelText("复制网址：https://example.com/paper");
    expect(button.getAttribute("title")).toBe("复制网址：https://example.com/paper");
  });

  it("passes command bar action context menu positions to the active pane", () => {
    const onContextMenu = vi.fn();
    const commandBarByPane = workspaceState.commandBarByPane as Record<string, unknown>;
    commandBarByPane["pane-1"] = {
      breadcrumbs: [],
      actions: [
        { id: "tool-highlight", label: "Highlight", group: "primary", onContextMenu },
      ],
    };

    render(
      <CommandBar
        onOpenWorkspace={() => {}}
      />,
    );

    fireEvent.contextMenu(screen.getByLabelText("Highlight"), { clientX: 42, clientY: 64 });

    expect(onContextMenu).toHaveBeenCalledWith({ x: 42, y: 64 });
  });

  it("忽略不属于当前 active scope 的旧 command bar 动作", () => {
    const commandBarByPane = workspaceState.commandBarByPane as Record<string, unknown>;
    commandBarByPane["pane-1"] = {
      scopeId: "pane-1::tab-stale",
      breadcrumbs: [],
      actions: [
        { id: "run", label: "Run", group: "primary", onTrigger: () => {} },
      ],
    };

    render(
      <CommandBar
        onOpenWorkspace={() => {}}
      />,
    );

    expect(screen.queryByLabelText("Run")).toBeNull();
  });
});

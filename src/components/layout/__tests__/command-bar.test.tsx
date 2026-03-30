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
  getActiveTab: () => ({ filePath: "workspace/notes.md" }),
};

const desktopWindowMocks = vi.hoisted(() => {
  let stateListener: ((payload: { isMaximized: boolean }) => void) | null = null;
  return {
    isWindowsDesktopHost: vi.fn(() => true),
    isDesktopWindowMaximized: vi.fn(async () => false),
    toggleDesktopWindowMaximize: vi.fn(async () => true),
    minimizeDesktopWindow: vi.fn(async () => undefined),
    closeDesktopWindow: vi.fn(async () => undefined),
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
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("syncs maximized state from desktop window events and supports title double-click maximize", async () => {
    render(
      <CommandBar
        onOpenWorkspace={() => {}}
        onOpenCommands={() => {}}
        onTogglePluginPanels={() => {}}
        onOpenSettings={() => {}}
        onOpenGuide={() => {}}
        pluginPanelsOpen={false}
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
          onOpenCommands={() => {}}
          onTogglePluginPanels={() => {}}
          onOpenSettings={() => {}}
          onOpenGuide={() => {}}
          pluginPanelsOpen={false}
        />
      </>,
    );

    expect(screen.getByTestId("desktop-window-controls").getAttribute("data-tauri-drag-region")).toBe("false");
    expect(screen.getByTestId("desktop-window-control-minimize").getAttribute("data-tauri-drag-region")).toBe("false");
    expect(screen.getByTestId("desktop-window-control-maximize").getAttribute("data-tauri-drag-region")).toBe("false");
    expect(screen.getByTestId("desktop-window-control-close").getAttribute("data-tauri-drag-region")).toBe("false");
  });

  it("opens the workspace switcher from the workspace chip", async () => {
    const onOpenWorkspace = vi.fn();

    render(
      <CommandBar
        onOpenWorkspace={onOpenWorkspace}
        onOpenCommands={() => {}}
        onTogglePluginPanels={() => {}}
        onOpenSettings={() => {}}
        onOpenGuide={() => {}}
        pluginPanelsOpen={false}
      />,
    );

    fireEvent.click(screen.getByTestId("desktop-commandbar-workspace"));
    expect(onOpenWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("desktop-commandbar-workspace").textContent).toContain("workspace");
  });

  it("shows breadcrumbs relative to the workspace root", () => {
    render(
      <CommandBar
        onOpenWorkspace={() => {}}
        onOpenCommands={() => {}}
        onTogglePluginPanels={() => {}}
        onOpenSettings={() => {}}
        onOpenGuide={() => {}}
        pluginPanelsOpen={false}
      />,
    );

    expect(screen.getByTestId("desktop-commandbar-breadcrumbs").textContent).toBe("notes.md");
  });
});

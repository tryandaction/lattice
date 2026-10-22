/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MainArea } from "../main-area";

const openDirectory = vi.fn();
const openWorkspacePath = vi.fn();
const closeRetainedLocalTab = vi.fn();
const getWorkspaceState = vi.fn(() => ({
  layout: { activePaneId: "pane-1", root: { id: "pane-1", type: "pane", tabs: [{ id: "retained-local-tab" }], activeTabIndex: 0 } },
  closeTab: closeRetainedLocalTab,
}));

const workspaceState = {
  rootHandle: null,
  layout: {
    root: {
      id: "pane-1",
      type: "pane",
      tabs: [],
      activeTabIndex: -1,
    },
    activePaneId: "pane-1",
  },
  setTabDirty: vi.fn(),
};

vi.mock("@/stores/workspace-store", () => {
  const useWorkspaceStore = (selector: (state: typeof workspaceState) => unknown) => selector(workspaceState);
  useWorkspaceStore.getState = () => getWorkspaceState();
  return { useWorkspaceStore };
});

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (selector: (state: { settings: { recentWorkspacePaths: string[] } }) => unknown) => selector({
    settings: {
      recentWorkspacePaths: ["C:/research", "C:/archive"],
    },
  }),
}));

vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({
    openDirectory,
    openWorkspacePath,
    refreshDirectory: vi.fn(),
    isLoading: false,
  }),
}));

vi.mock("@/hooks/use-workspace-runner-preferences", () => ({
  useWorkspaceRunnerPreferencesPersistence: () => undefined,
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../layout-renderer", () => ({
  LayoutRenderer: () => <div>layout-renderer</div>,
}));

describe("MainArea welcome workspace entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the welcome CTA as the primary workspace opener and shows recent workspaces", () => {
    render(<MainArea />);

    fireEvent.click(screen.getByTestId("main-welcome-open-workspace"));
    expect(openDirectory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("C:/research"));
    expect(openWorkspacePath).toHaveBeenCalledWith("C:/research");
  });

  it("does not close a retained local tab while a cloud workspace is active", () => {
    const view = render(<MainArea active={false} />);
    const cloudClose = new KeyboardEvent("keydown", { key: "w", ctrlKey: true, cancelable: true });
    window.dispatchEvent(cloudClose);
    expect(closeRetainedLocalTab).not.toHaveBeenCalled();
    expect(cloudClose.defaultPrevented).toBe(false);

    view.rerender(<MainArea active />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true, cancelable: true }));
    expect(closeRetainedLocalTab).toHaveBeenCalledWith("pane-1", 0);
  });
});

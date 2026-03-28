/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MainArea } from "../main-area";

const openDirectory = vi.fn();
const openWorkspacePath = vi.fn();

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

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: typeof workspaceState) => unknown) => selector(workspaceState),
}));

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
});

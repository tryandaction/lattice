/**
 * @vitest-environment jsdom
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FolderSelector } from "../folder-selector";

const hoisted = vi.hoisted(() => ({
  setDefaultFolder: vi.fn(async () => undefined),
  openWorkspacePath: vi.fn(async () => undefined),
  removeRecentWorkspacePath: vi.fn(async () => undefined),
  isExistingDesktopDirectory: vi.fn(async () => true),
  openDesktopDirectoryDialog: vi.fn(async () => "C:/vault"),
}));

const settingsState = {
  settings: {
    defaultFolder: "C:/default",
    recentWorkspacePaths: ["C:/recent"],
  },
  setDefaultFolder: hoisted.setDefaultFolder,
  removeRecentWorkspacePath: hoisted.removeRecentWorkspacePath,
};

const workspaceState = {
  workspaceRootPath: "C:/workspace",
};

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: typeof workspaceState) => unknown) => selector(workspaceState),
}));

vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({
    openWorkspacePath: hoisted.openWorkspacePath,
  }),
}));

vi.mock("@/lib/storage-adapter", () => ({
  isTauri: () => true,
}));

vi.mock("@/lib/desktop-folder", () => ({
  isExistingDesktopDirectory: hoisted.isExistingDesktopDirectory,
  openDesktopDirectoryDialog: hoisted.openDesktopDirectoryDialog,
}));

describe("FolderSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.settings.defaultFolder = "C:/default";
    settingsState.settings.recentWorkspacePaths = ["C:/recent"];
  });

  it("updates the default folder without auto-opening the selected workspace", async () => {
    render(<FolderSelector />);

    fireEvent.click(screen.getByText("settings.defaultFolder.select"));

    await waitFor(() => {
      expect(hoisted.openDesktopDirectoryDialog).toHaveBeenCalledTimes(1);
    });

    expect(hoisted.setDefaultFolder).toHaveBeenCalledWith("C:/vault");
    expect(hoisted.openWorkspacePath).not.toHaveBeenCalled();
  });

  it("renders safely when recent workspace history is missing", () => {
    settingsState.settings.recentWorkspacePaths = undefined as unknown as string[];

    render(<FolderSelector />);

    expect(screen.getByText("settings.recentWorkspaces.empty")).toBeTruthy();
  });
});

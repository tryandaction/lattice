/**
 * @vitest-environment jsdom
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExplorerSidebar } from "../explorer-sidebar";

const openDirectory = vi.fn();
const openWorkspacePath = vi.fn();
const removeRecentWorkspacePath = vi.fn();
const mockFileTree: {
  root: {
    name: string;
    kind: "directory";
    path: string;
    isExpanded: boolean;
    children: never[];
  } | null;
} = {
  root: {
    name: "workspace",
    kind: "directory" as const,
    path: "workspace",
    isExpanded: true,
    children: [],
  },
};

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: () => null,
  }),
}));

vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({
    fileTree: mockFileTree,
    isLoading: false,
    error: null,
    openDirectory,
    openWorkspacePath,
    openQaWorkspace: undefined,
    isSupported: true,
    isCheckingSupport: false,
    createFile: vi.fn(),
    createDirectory: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@/stores/settings-store", () => ({
  useSettingsStore: (selector: (state: {
    settings: { recentWorkspacePaths: string[] };
    removeRecentWorkspacePath: typeof removeRecentWorkspacePath;
  }) => unknown) => selector({
    settings: {
      recentWorkspacePaths: ["C:/workspace", "C:/other-vault"],
    },
    removeRecentWorkspacePath,
  }),
}));

vi.mock("@/stores/workspace-store", () => ({
  useWorkspaceStore: (selector: (state: {
    openFileInActivePane: () => void;
    setSelectedDirectoryPath: () => void;
    workspaceRootPath: string | null;
  }) => unknown) => selector({
    openFileInActivePane: () => {},
    setSelectedDirectoryPath: () => {},
    workspaceRootPath: "C:/workspace",
  }),
}));

vi.mock("@/stores/explorer-store", () => ({
  useExplorerStore: (selector: (state: {
    selectedPath: string | null;
    selectedKind: "file" | "directory" | null;
    setSelection: () => void;
    startRenaming: () => void;
  }) => unknown) => selector({
    selectedPath: null,
    selectedKind: null,
    setSelection: () => {},
    startRenaming: () => {},
  }),
}));

vi.mock("../tree-view", () => ({
  TreeView: () => <div>tree-view</div>,
}));

vi.mock("../new-file-buttons", () => ({
  NewFileButtons: () => <div>new-file-buttons</div>,
}));

vi.mock("@/components/ui/plugin-sidebar-slot", () => ({
  PluginSidebarSlot: () => null,
}));

describe("ExplorerSidebar", () => {
  it("renders explorer header without duplicating recent workspace actions", () => {
    render(<ExplorerSidebar />);

    expect(screen.getByText("explorer.title")).not.toBeNull();
    expect(screen.getByText("workspace")).not.toBeNull();
    expect(screen.queryByTitle("shell.workspace.switch")).toBeNull();
    expect(screen.queryByText("other-vault")).toBeNull();
  });

  it("keeps empty explorer state secondary and does not render recent workspaces", () => {
    mockFileTree.root = null;
    render(<ExplorerSidebar />);

    expect(screen.queryByText("C:/other-vault")).toBeNull();
    expect(screen.queryByTitle("explorer.empty.removeRecent")).toBeNull();
    expect(openWorkspacePath).not.toHaveBeenCalled();
    expect(removeRecentWorkspacePath).not.toHaveBeenCalled();

    mockFileTree.root = {
      name: "workspace",
      kind: "directory",
      path: "workspace",
      isExpanded: true,
      children: [],
    };
  });
});

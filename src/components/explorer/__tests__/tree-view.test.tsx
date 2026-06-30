/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeView } from "../tree-view";
import { useExplorerStore } from "@/stores/explorer-store";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
const originalConsoleError = console.error;
const copyEntry = vi.fn();
const moveEntry = vi.fn();
const moveEntryIntoPdfItemWorkspace = vi.fn();
const hydratePdfVirtualChildren = vi.fn();
const workspaceMocks = vi.hoisted(() => ({
  setSelectedDirectoryPath: vi.fn(),
  updateTabPath: vi.fn(),
  updateTabFile: vi.fn(),
  updateTabPathPrefix: vi.fn(),
  openFileInPane: vi.fn(),
  splitPane: vi.fn(),
}));
const {
  setSelectedDirectoryPath,
  updateTabPath,
  updateTabFile,
  updateTabPathPrefix,
  openFileInPane,
  splitPane,
} = workspaceMocks;
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: toastMocks.success,
    error: toastMocks.error,
  },
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboard: clipboardMocks.copyToClipboard,
}));

vi.mock("@/lib/desktop-file-system", () => ({
  getDesktopHandlePath: () => null,
}));

vi.mock("@/lib/desktop-openers", () => ({
  canUseDesktopOpeners: () => false,
  openDesktopPath: vi.fn(),
  openDesktopTerminalAtPath: vi.fn(),
  revealDesktopPath: vi.fn(),
}));

vi.mock("@/hooks/use-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

function createTextFileHandle(name: string, text: string): FileSystemFileHandle {
  return {
    name,
    kind: "file",
    getFile: vi.fn(async () => new File([text], name)),
  } as unknown as FileSystemFileHandle;
}

function createDataTransfer(data: Map<string, string>) {
  return {
    effectAllowed: "move",
    dropEffect: "none",
    setData: vi.fn((key: string, value: string) => data.set(key, value)),
    getData: vi.fn((key: string) => data.get(key) ?? ""),
  };
}

vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({
    copyEntry,
    moveEntry,
    moveEntryIntoPdfItemWorkspace,
    hydratePdfVirtualChildren,
    deleteFile: vi.fn(),
    renameFile: vi.fn(),
    refreshDirectory: vi.fn(),
    rootHandle: { name: "workspace" },
    createFile: vi.fn(),
    createDirectory: vi.fn(),
    openDirectoryAsWorkspace: vi.fn(),
  }),
}));

vi.mock("@/stores/workspace-store", () => {
  type WorkspaceStateMock = {
    setSelectedDirectoryPath: typeof workspaceMocks.setSelectedDirectoryPath;
    updateTabPath: typeof workspaceMocks.updateTabPath;
    updateTabFile: typeof workspaceMocks.updateTabFile;
    updateTabPathPrefix: typeof workspaceMocks.updateTabPathPrefix;
    openFileInPane: typeof workspaceMocks.openFileInPane;
    splitPane: typeof workspaceMocks.splitPane;
    fileTree: {
      root: null;
    };
    layout: {
      activePaneId: string;
      root: any;
    };
  };

  const workspaceState: WorkspaceStateMock = {
    setSelectedDirectoryPath: workspaceMocks.setSelectedDirectoryPath,
    updateTabPath: workspaceMocks.updateTabPath,
    updateTabFile: workspaceMocks.updateTabFile,
    updateTabPathPrefix: workspaceMocks.updateTabPathPrefix,
    openFileInPane: workspaceMocks.openFileInPane,
    splitPane: workspaceMocks.splitPane,
    fileTree: {
      root: null,
    },
    layout: {
      activePaneId: "pane-1",
      root: {
        type: "pane",
        id: "pane-1",
        tabs: [],
        activeTabIndex: -1,
      },
    },
  };
  const useWorkspaceStoreMock = ((selector: (state: typeof workspaceState) => unknown) => selector(workspaceState)) as
    ((selector: (state: typeof workspaceState) => unknown) => unknown) & { getState: () => typeof workspaceState };
  useWorkspaceStoreMock.getState = () => workspaceState;
  return { useWorkspaceStore: useWorkspaceStoreMock };
});

describe("TreeView rename keyboard handling", () => {
  beforeAll(() => {
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      const message = args.map((value) => String(value ?? "")).join(" ");
      if (message.includes("not wrapped in act")) {
        return;
      }
      originalConsoleError(...args);
    });
  });

  afterAll(() => {
    consoleErrorSpy?.mockRestore();
  });

  beforeEach(() => {
    copyEntry.mockReset();
    moveEntry.mockReset();
    moveEntryIntoPdfItemWorkspace.mockReset();
    hydratePdfVirtualChildren.mockReset();
    setSelectedDirectoryPath.mockReset();
    updateTabPath.mockReset();
    updateTabFile.mockReset();
    updateTabPathPrefix.mockReset();
    openFileInPane.mockReset();
    splitPane.mockReset();
    splitPane.mockReturnValue("pane-2");
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(true);
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
    useExplorerStore.setState({
      selectedPath: "workspace/file.md",
      selectedKind: "file",
      renamingPath: "workspace/file.md",
      clipboard: { mode: "copy", path: "workspace/other.md", kind: "file" },
      compareSelection: null,
      dragOverPath: null,
    });
  });

  afterEach(() => {
    useExplorerStore.setState({
      selectedPath: null,
      selectedKind: null,
      renamingPath: null,
      clipboard: null,
      compareSelection: null,
      dragOverPath: null,
    });
  });

  it("重命名输入框内按 Ctrl/Cmd+V 不应触发 Explorer 粘贴", () => {
    act(() => {
      render(
        <TreeView
          root={{
            name: "workspace",
            kind: "directory",
            path: "workspace",
            isExpanded: true,
            children: [
              {
                name: "file.md",
                kind: "file",
                handle: {} as FileSystemFileHandle,
                extension: "md",
                path: "workspace/file.md",
              },
            ],
            handle: {} as FileSystemDirectoryHandle,
          }}
        />
      );
    });

    const input = screen.getByDisplayValue("file.md");
    act(() => {
      fireEvent.keyDown(input, { key: "v", ctrlKey: true });
    });

    expect(copyEntry).not.toHaveBeenCalled();
    expect(moveEntry).not.toHaveBeenCalled();
  });

  it("does not crash when an expanded PDF node is still hydrating virtual children", () => {
    expect(() => {
      act(() => {
        render(
          <TreeView
            root={{
              name: "workspace",
              kind: "directory",
              path: "workspace",
              isExpanded: true,
              children: [
                {
                  name: "paper.pdf",
                  kind: "file",
                  handle: {} as FileSystemFileHandle,
                  extension: "pdf",
                  path: "workspace/paper.pdf",
                  canExpandVirtualChildren: true,
                  isExpanded: true,
                  virtualChildrenState: "loading",
                },
              ],
              handle: {} as FileSystemDirectoryHandle,
            }}
          />
        );
      });
    }).not.toThrow();

    expect(screen.getByText("paper.pdf")).toBeTruthy();
    expect(hydratePdfVirtualChildren).not.toHaveBeenCalled();
  });

  it("uses file icons instead of rendering redundant file type badges", () => {
    render(
      <TreeView
        root={{
          name: "workspace",
          kind: "directory",
          path: "workspace",
          isExpanded: true,
          children: [
            {
              name: "note.md",
              kind: "file",
              handle: {} as FileSystemFileHandle,
              extension: "md",
              path: "workspace/note.md",
              badgeLabel: "Markdown",
            },
            {
              name: "_annotations.md",
              kind: "file",
              handle: {} as FileSystemFileHandle,
              extension: "md",
              path: "workspace/_annotations.md",
              badgeLabel: "批注",
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    expect(screen.getByText("note.md")).toBeTruthy();
    expect(screen.getByText("_annotations.md")).toBeTruthy();
    expect(screen.queryByText("Markdown")).toBeNull();
    expect(screen.queryByText("批注")).toBeNull();
  });

  it("shows VS Code-style core file context actions", () => {
    render(
      <TreeView
        root={{
          name: "workspace",
          kind: "directory",
          path: "workspace",
          isExpanded: true,
          children: [
            {
              name: "file.py",
              kind: "file",
              handle: { name: "file.py" } as FileSystemFileHandle,
              extension: "py",
              path: "workspace/src/file.py",
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    fireEvent.contextMenu(screen.getByText("file.py"));

    expect(screen.getByText("explorer.context.openToSide")).toBeTruthy();
    expect(screen.getByText("explorer.context.openWith")).toBeTruthy();
    expect(screen.getByText("explorer.context.revealInFileExplorer")).toBeTruthy();
    expect(screen.getByText("explorer.context.openInIntegratedTerminal")).toBeTruthy();
    expect(screen.getByText("explorer.context.selectForCompare")).toBeTruthy();
    expect(screen.getByText("explorer.context.copyPath")).toBeTruthy();
    expect(screen.getByText("explorer.context.copyRelativePath")).toBeTruthy();
  });

  it("opens a file to the side by splitting when no side pane exists", () => {
    const handle = { name: "file.py" } as FileSystemFileHandle;
    render(
      <TreeView
        root={{
          name: "workspace",
          kind: "directory",
          path: "workspace",
          isExpanded: true,
          children: [
            {
              name: "file.py",
              kind: "file",
              handle,
              extension: "py",
              path: "workspace/src/file.py",
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    fireEvent.contextMenu(screen.getByText("file.py"));
    fireEvent.click(screen.getByText("explorer.context.openToSide"));

    expect(splitPane).toHaveBeenCalledWith("pane-1", "horizontal");
    expect(openFileInPane).toHaveBeenCalledWith("pane-2", handle, "workspace/src/file.py");
  });

  it("copies a workspace-relative file path from the context menu", async () => {
    render(
      <TreeView
        root={{
          name: "workspace",
          kind: "directory",
          path: "workspace",
          isExpanded: true,
          children: [
            {
              name: "file.py",
              kind: "file",
              handle: { name: "file.py" } as FileSystemFileHandle,
              extension: "py",
              path: "workspace/src/file.py",
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    fireEvent.contextMenu(screen.getByText("file.py"));
    fireEvent.click(screen.getByText("explorer.context.copyRelativePath"));

    await vi.waitFor(() => {
      expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith("src/file.py");
    });
  });

  it("moves a dragged file into a PDF item workspace when dropped on a PDF", async () => {
    moveEntryIntoPdfItemWorkspace.mockResolvedValue({
      success: true,
      path: ".lattice/items/workspace-paper.pdf/notes.md",
      handle: { kind: "file", name: "notes.md" },
      kind: "file",
    });

    render(
      <TreeView
        root={{
          name: "workspace",
          kind: "directory",
          path: "workspace",
          isExpanded: true,
          children: [
            {
              name: "notes.md",
              kind: "file",
              handle: { name: "notes.md" } as FileSystemFileHandle,
              extension: "md",
              path: "workspace/notes.md",
            },
            {
              name: "paper.pdf",
              kind: "file",
              handle: { name: "paper.pdf" } as FileSystemFileHandle,
              extension: "pdf",
              path: "workspace/paper.pdf",
              canExpandVirtualChildren: true,
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    const source = screen.getByText("notes.md").closest("button");
    const target = screen.getByText("paper.pdf").closest("div[data-explorer-node='true']");
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();

    const data = new Map<string, string>();
    const dataTransfer = createDataTransfer(data);
    fireEvent.dragStart(source!, { dataTransfer });
    fireEvent.dragOver(target!, { dataTransfer });
    fireEvent.drop(target!, { dataTransfer });

    await vi.waitFor(() => {
      expect(moveEntryIntoPdfItemWorkspace).toHaveBeenCalledWith("workspace/notes.md", "workspace/paper.pdf");
    });
    expect(updateTabFile).toHaveBeenCalledWith(
      "workspace/notes.md",
      ".lattice/items/workspace-paper.pdf/notes.md",
      { kind: "file", name: "notes.md" },
    );
    expect(updateTabPath).not.toHaveBeenCalled();
    expect(updateTabPathPrefix).not.toHaveBeenCalled();
  });

  it("moves a dragged folder into a PDF item workspace when dropped on a PDF", async () => {
    moveEntryIntoPdfItemWorkspace.mockResolvedValue({
      success: true,
      path: ".lattice/items/workspace-paper.pdf/assets",
      handle: { kind: "directory", name: "assets" },
      kind: "directory",
    });

    render(
      <TreeView
        root={{
          name: "workspace",
          kind: "directory",
          path: "workspace",
          isExpanded: true,
          children: [
            {
              name: "assets",
              kind: "directory",
              handle: { name: "assets" } as FileSystemDirectoryHandle,
              path: "workspace/assets",
              isExpanded: false,
              children: [],
            },
            {
              name: "paper.pdf",
              kind: "file",
              handle: { name: "paper.pdf" } as FileSystemFileHandle,
              extension: "pdf",
              path: "workspace/paper.pdf",
              canExpandVirtualChildren: true,
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    const source = screen.getByText("assets").closest("button");
    const target = screen.getByText("paper.pdf").closest("div[data-explorer-node='true']");
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();

    const data = new Map<string, string>();
    const dataTransfer = createDataTransfer(data);
    fireEvent.dragStart(source!, { dataTransfer });
    fireEvent.drop(target!, { dataTransfer });

    await vi.waitFor(() => {
      expect(moveEntryIntoPdfItemWorkspace).toHaveBeenCalledWith("workspace/assets", "workspace/paper.pdf");
    });
    expect(updateTabPathPrefix).toHaveBeenCalledWith("workspace/assets", ".lattice/items/workspace-paper.pdf/assets");
    expect(setSelectedDirectoryPath).toHaveBeenCalledWith(".lattice/items/workspace-paper.pdf/assets");
  });

  it("does not move a PDF when it is dropped onto itself", () => {
    render(
      <TreeView
        root={{
          name: "workspace",
          kind: "directory",
          path: "workspace",
          isExpanded: true,
          children: [
            {
              name: "paper.pdf",
              kind: "file",
              handle: { name: "paper.pdf" } as FileSystemFileHandle,
              extension: "pdf",
              path: "workspace/paper.pdf",
              canExpandVirtualChildren: true,
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    const target = screen.getByText("paper.pdf");
    const dropTarget = target.closest("div[data-explorer-node='true']");
    expect(dropTarget).toBeTruthy();

    const data = new Map<string, string>();
    const dataTransfer = createDataTransfer(data);
    fireEvent.dragStart(target, { dataTransfer });
    fireEvent.drop(dropTarget!, { dataTransfer });

    expect(moveEntryIntoPdfItemWorkspace).not.toHaveBeenCalled();
  });

  it("opens a real line diff when comparing with the selected file", async () => {
    const leftHandle = createTextFileHandle("left.py", "print('old')\nshared\n");
    const rightHandle = createTextFileHandle("right.py", "print('new')\nshared\n");

    render(
      <TreeView
        root={{
          name: "workspace",
          kind: "directory",
          path: "workspace",
          isExpanded: true,
          children: [
            {
              name: "left.py",
              kind: "file",
              handle: leftHandle,
              extension: "py",
              path: "workspace/left.py",
            },
            {
              name: "right.py",
              kind: "file",
              handle: rightHandle,
              extension: "py",
              path: "workspace/right.py",
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    fireEvent.contextMenu(screen.getByText("left.py"));
    fireEvent.click(screen.getByText("explorer.context.selectForCompare"));

    fireEvent.contextMenu(screen.getByText("right.py"));
    fireEvent.click(screen.getByText("explorer.context.compareWithSelected"));

    expect(await screen.findByText("explorer.compare.title")).toBeTruthy();
    expect(screen.getByText("print('old')")).toBeTruthy();
    expect(screen.getByText("print('new')")).toBeTruthy();
    expect(openFileInPane).toHaveBeenCalledWith("pane-1", leftHandle, "workspace/left.py");
    expect(openFileInPane).toHaveBeenCalledWith("pane-2", rightHandle, "workspace/right.py");
  });
});

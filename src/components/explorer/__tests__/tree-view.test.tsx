/**
 * @vitest-environment jsdom
 */

import { act, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TreeView } from "../tree-view";
import { useExplorerStore } from "@/stores/explorer-store";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
const originalConsoleError = console.error;
const copyEntry = vi.fn();
const moveEntry = vi.fn();
const moveEntryIntoPdfItemWorkspace = vi.fn();
const hydratePdfVirtualChildren = vi.fn();
const fileSystemMocks = vi.hoisted(() => ({
  renderConsumer: vi.fn(),
  resolvePathFromLatticeRoot: vi.fn((path: string) => (
    path === "nested/paper.pdf" ? "ancestor/nested/paper.pdf" : path
  )),
}));
const pdfItemMocks = vi.hoisted(() => ({
  createPdfItemNote: vi.fn(),
  ensurePdfItemWorkspace: vi.fn(),
}));
const workspaceMocks = vi.hoisted(() => ({
  setSelectedDirectoryPath: vi.fn(),
  updateTabPath: vi.fn(),
  updateTabFile: vi.fn(),
  updateTabPathPrefix: vi.fn(),
  openFileInPane: vi.fn(),
  openFileInLatticePane: vi.fn(),
  splitPane: vi.fn(),
}));
const {
  setSelectedDirectoryPath,
  updateTabPath,
  updateTabFile,
  updateTabPathPrefix,
  openFileInPane,
  openFileInLatticePane,
  splitPane,
} = workspaceMocks;
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));
const cloudUpload = vi.hoisted(() => vi.fn());
vi.mock("@/stores/cloud-workbench-store", () => ({ useCloudWorkbenchStore: { getState: () => ({ requestLocalUpload: cloudUpload }) } }));
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
  resolvePathFromLatticeRoot: fileSystemMocks.resolvePathFromLatticeRoot,
  useFileSystem: () => { fileSystemMocks.renderConsumer(); return ({
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
  }); },
}));

vi.mock("@/stores/workspace-store", () => {
  type WorkspaceStateMock = {
    setSelectedDirectoryPath: typeof workspaceMocks.setSelectedDirectoryPath;
    updateTabPath: typeof workspaceMocks.updateTabPath;
    updateTabFile: typeof workspaceMocks.updateTabFile;
    updateTabPathPrefix: typeof workspaceMocks.updateTabPathPrefix;
    openFileInPane: typeof workspaceMocks.openFileInPane;
    openFileInLatticePane: typeof workspaceMocks.openFileInLatticePane;
    splitPane: typeof workspaceMocks.splitPane;
    workspaceRootHandle: FileSystemDirectoryHandle | null;
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
    openFileInLatticePane: workspaceMocks.openFileInLatticePane,
    splitPane: workspaceMocks.splitPane,
    workspaceRootHandle: { name: "ancestor" } as FileSystemDirectoryHandle,
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

vi.mock("@/lib/pdf-item", () => ({
  createPdfItemNote: pdfItemMocks.createPdfItemNote,
  ensurePdfItemWorkspace: pdfItemMocks.ensurePdfItemWorkspace,
}));

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
    fileSystemMocks.resolvePathFromLatticeRoot.mockClear();
    pdfItemMocks.createPdfItemNote.mockReset();
    pdfItemMocks.ensurePdfItemWorkspace.mockReset();
    setSelectedDirectoryPath.mockReset();
    updateTabPath.mockReset();
    updateTabFile.mockReset();
    updateTabPathPrefix.mockReset();
    openFileInPane.mockReset();
    openFileInLatticePane.mockReset();
    splitPane.mockReset();
    splitPane.mockReturnValue("pane-2");
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(true);
    toastMocks.success.mockReset();
    toastMocks.error.mockReset();
    cloudUpload.mockReset();
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

  it("updates only the selected row when moving focus through a large tree", () => {
    useExplorerStore.setState({ selectedPath: null, selectedKind: null, renamingPath: null, clipboard: null });
    render(<TreeView root={{
      name: "workspace", kind: "directory", path: "workspace", isExpanded: true,
      handle: { name: "workspace" } as FileSystemDirectoryHandle,
      children: Array.from({ length: 120 }, (_, index) => ({
        name: `note-${index}.md`, kind: "file" as const, extension: "md",
        path: `workspace/note-${index}.md`, handle: createTextFileHandle(`note-${index}.md`, "note"),
      })),
    }} />);
    fileSystemMocks.renderConsumer.mockClear();
    act(() => useExplorerStore.getState().setSelection("workspace/note-60.md", "file"));
    expect(fileSystemMocks.renderConsumer.mock.calls.length).toBeLessThanOrEqual(2);
    expect(screen.getByRole("button", { name: "note-60.md" }).parentElement?.className).toContain("bg-accent");
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
    expect(screen.queryByText("explorer.context.openInVSCodeWorkbench")).toBeNull();
    expect(screen.getByText("explorer.context.openInLattice")).toBeTruthy();
    expect(screen.getByText("explorer.context.openWith")).toBeTruthy();
    expect(screen.getByText("explorer.context.revealInFileExplorer")).toBeTruthy();
    expect(screen.getByText("explorer.context.openInIntegratedTerminal")).toBeTruthy();
    expect(screen.getByText("explorer.context.selectForCompare")).toBeTruthy();
    expect(screen.getByText("explorer.context.copyPath")).toBeTruthy();
    expect(screen.getByText("explorer.context.copyRelativePath")).toBeTruthy();
  });

  it("creates a nested PDF note in the ancestor lattice root", async () => {
    const pdfHandle = createTextFileHandle("paper.pdf", "%PDF-test");
    const noteHandle = createTextFileHandle("Untitled.md", "# Note");
    pdfItemMocks.ensurePdfItemWorkspace.mockResolvedValue({
      itemId: "stable-item",
      itemFolderPath: ".lattice/items/stable-item",
    });
    pdfItemMocks.createPdfItemNote.mockResolvedValue({
      handle: noteHandle,
      path: ".lattice/items/stable-item/Untitled.md",
    });

    render(
      <TreeView
        root={{
          name: "nested",
          kind: "directory",
          path: "nested",
          isExpanded: true,
          children: [{
            name: "paper.pdf",
            kind: "file",
            handle: pdfHandle,
            extension: "pdf",
            path: "nested/paper.pdf",
            canExpandVirtualChildren: true,
            virtualChildrenState: "idle",
          }],
          handle: { name: "nested" } as FileSystemDirectoryHandle,
        }}
      />
    );

    fireEvent.contextMenu(screen.getByText("paper.pdf"));
    fireEvent.click(screen.getByText("explorer.pdf.newNote"));

    await vi.waitFor(() => {
      expect(pdfItemMocks.ensurePdfItemWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({ name: "ancestor" }),
        "ancestor-nested-paper.pdf",
        "ancestor/nested/paper.pdf",
        expect.any(Object),
      );
    });
    expect(pdfItemMocks.createPdfItemNote).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ancestor" }),
      expect.objectContaining({ itemId: "stable-item" }),
      "note",
      "Untitled",
    );
  });
  it("offers local PDF upload with the real root and storage path for annotation migration", async () => {
    const handle = createTextFileHandle("paper.pdf", "%PDF-synthetic");
    render(<TreeView root={{ name: "nested", path: "nested", kind: "directory", isExpanded: true, handle: { name: "nested" } as FileSystemDirectoryHandle,
      children: [{ name: "paper.pdf", path: "nested/paper.pdf", kind: "file", extension: "pdf", handle }] }} />);
    fireEvent.contextMenu(screen.getByText("paper.pdf"));
    fireEvent.click(screen.getByText("上传到云端库…"));
    await vi.waitFor(() => expect(cloudUpload).toHaveBeenCalledWith(expect.objectContaining({ kind: "file", path: "nested/paper.pdf", storagePath: "ancestor/nested/paper.pdf", handle, rootHandle: expect.objectContaining({ name: "ancestor" }) })));
  });
  it("offers a directory upload as one explicit recursive entry", async () => {
    const handle = { name: "papers", kind: "directory" } as FileSystemDirectoryHandle;
    render(<TreeView root={{ name: "papers", path: "workspace/papers", kind: "directory", handle, isExpanded: true, children: [] }} />);
    fireEvent.contextMenu(screen.getByText("papers"));
    fireEvent.click(screen.getByText("上传到云端库…"));
    await vi.waitFor(() => expect(cloudUpload).toHaveBeenCalledWith(expect.objectContaining({ kind: "directory", path: "workspace/papers", handle })));
    expect(copyEntry).not.toHaveBeenCalled();
    expect(moveEntry).not.toHaveBeenCalled();
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

  it("accepts the text drag fallback when WebView2 omits the custom MIME payload", async () => {
    moveEntry.mockResolvedValue({
      success: true,
      path: "workspace/archive/notes.md",
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
              name: "archive",
              kind: "directory",
              handle: { name: "archive" } as FileSystemDirectoryHandle,
              path: "workspace/archive",
              isExpanded: true,
              children: [],
            },
            {
              name: "notes.md",
              kind: "file",
              handle: { name: "notes.md" } as FileSystemFileHandle,
              extension: "md",
              path: "workspace/notes.md",
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    const target = screen.getByText("archive").closest("button");
    expect(target).toBeTruthy();
    const dataTransfer = createDataTransfer(new Map([
      ["text/plain", JSON.stringify({ path: "workspace/notes.md", kind: "file" })],
    ]));

    fireEvent.dragOver(target!, { dataTransfer });
    fireEvent.drop(target!, { dataTransfer });

    await vi.waitFor(() => {
      expect(moveEntry).toHaveBeenCalledWith("workspace/notes.md", "workspace/archive");
    });
  });

  it('accepts protected internal drag-over data and copies with Ctrl without rebinding the source tab', async () => {
    useExplorerStore.setState({ selectedPath: null, selectedKind: null, renamingPath: null, clipboard: null });
    copyEntry.mockResolvedValue({ success: true, path: 'workspace/archive/notes.md', kind: 'file', handle: { name: 'notes.md', kind: 'file' } });
    render(<TreeView root={{ name: 'workspace', kind: 'directory', path: 'workspace', isExpanded: true, handle: { name: 'workspace' } as FileSystemDirectoryHandle, children: [
      { name: 'archive', kind: 'directory', path: 'workspace/archive', isExpanded: true, children: [], handle: { name: 'archive' } as FileSystemDirectoryHandle },
      { name: 'notes.md', kind: 'file', path: 'workspace/notes.md', extension: 'md', handle: { name: 'notes.md' } as FileSystemFileHandle },
    ] }} />);
    const target = screen.getByText('archive').closest('button')!;
    const protectedData = { ...createDataTransfer(new Map()), types: ['application/x-lattice-explorer-entry'] };
    const over = createEvent.dragOver(target, { dataTransfer: protectedData });
    Object.defineProperty(over, 'ctrlKey', { value: true });
    expect(fireEvent(target, over)).toBe(false);
    expect(protectedData.dropEffect).toBe('copy');
    const dataTransfer = createDataTransfer(new Map([['application/x-lattice-explorer-entry', JSON.stringify({ path: 'workspace/notes.md', kind: 'file' })]]));
    const drop = createEvent.drop(target, { dataTransfer });
    Object.defineProperty(drop, 'ctrlKey', { value: true });
    fireEvent(target, drop);
    await vi.waitFor(() => expect(copyEntry).toHaveBeenCalledWith('workspace/notes.md', 'workspace/archive'));
    expect(copyEntry).toHaveBeenCalledTimes(1);
    expect(moveEntry).not.toHaveBeenCalled();
    expect(updateTabFile).not.toHaveBeenCalled();
    expect(updateTabPathPrefix).not.toHaveBeenCalled();
  });

  it("keeps the drop target visibly busy until the filesystem move finishes", async () => {
    let resolveMove: ((result: {
      success: boolean;
      path: string;
      handle: FileSystemFileHandle;
      kind: "file";
    }) => void) | null = null;
    moveEntry.mockImplementation(() => new Promise((resolve) => {
      resolveMove = resolve;
    }));

    render(
      <TreeView
        root={{
          name: "workspace",
          kind: "directory",
          path: "workspace",
          isExpanded: true,
          children: [
            {
              name: "archive",
              kind: "directory",
              handle: { name: "archive" } as FileSystemDirectoryHandle,
              path: "workspace/archive",
              isExpanded: true,
              children: [],
            },
            {
              name: "notes.md",
              kind: "file",
              handle: { name: "notes.md" } as FileSystemFileHandle,
              extension: "md",
              path: "workspace/notes.md",
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    const source = screen.getByText("notes.md").closest("button");
    const target = screen.getByText("archive").closest("button");
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    const dataTransfer = createDataTransfer(new Map());

    fireEvent.dragStart(source!, { dataTransfer });
    fireEvent.dragOver(target!, { dataTransfer });
    fireEvent.drop(target!, { dataTransfer });

    await vi.waitFor(() => expect(moveEntry).toHaveBeenCalled());
    expect(target?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      resolveMove?.({
        success: true,
        path: "workspace/archive/notes.md",
        handle: { kind: "file", name: "notes.md" } as FileSystemFileHandle,
        kind: "file",
      });
    });
    expect(target?.getAttribute("aria-busy")).toBe("false");
  });

  it("shows a visible error when a drag move fails", async () => {
    moveEntry.mockResolvedValue({ success: false, error: "Disk denied" });

    render(
      <TreeView
        root={{
          name: "workspace",
          kind: "directory",
          path: "workspace",
          isExpanded: true,
          children: [
            {
              name: "archive",
              kind: "directory",
              handle: { name: "archive" } as FileSystemDirectoryHandle,
              path: "workspace/archive",
              isExpanded: true,
              children: [],
            },
            {
              name: "notes.md",
              kind: "file",
              handle: { name: "notes.md" } as FileSystemFileHandle,
              extension: "md",
              path: "workspace/notes.md",
            },
          ],
          handle: {} as FileSystemDirectoryHandle,
        }}
      />
    );

    const source = screen.getByText("notes.md").closest("button");
    const target = screen.getByText("archive").closest("button");
    expect(source).toBeTruthy();
    expect(target).toBeTruthy();
    const dataTransfer = createDataTransfer(new Map());

    fireEvent.dragStart(source!, { dataTransfer });
    fireEvent.drop(target!, { dataTransfer });

    await vi.waitFor(() => {
      expect(toastMocks.error).toHaveBeenCalledWith("Disk denied");
    });
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

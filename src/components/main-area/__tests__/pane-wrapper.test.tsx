/**
 * @vitest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaneWrapper } from "../pane-wrapper";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";

const refreshDirectoryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const desktopPreviewMocks = vi.hoisted(() => ({
  getDesktopPreviewPath: vi.fn((_handle?: unknown) => null as string | null),
  resolveDesktopPreviewUrl: vi.fn((path: string) => `http://lattice-preview.localhost/${path}`),
}));
const universalViewerMock = vi.hoisted(() => vi.fn<(props?: unknown) => React.ReactNode>((_props?: unknown) => null));

vi.mock("@dnd-kit/core", () => ({
  useDndMonitor: () => undefined,
}));

vi.mock("../tab-bar", () => ({
  TabBar: () => <div data-testid="mock-tab-bar" />,
}));

vi.mock("../drop-zone", () => ({
  DropZones: () => null,
}));

vi.mock("@/components/ui/save-reminder-dialog", () => ({
  SaveReminderDialog: () => null,
}));

vi.mock("@/hooks/use-file-system", () => ({
  useFileSystem: () => ({
    refreshDirectory: refreshDirectoryMock,
  }),
}));

vi.mock("@/lib/desktop-preview", () => ({
  getDesktopPreviewPath: desktopPreviewMocks.getDesktopPreviewPath,
  resolveDesktopPreviewUrl: desktopPreviewMocks.resolveDesktopPreviewUrl,
}));

vi.mock("@/lib/storage-adapter", () => ({
  isTauriHost: vi.fn(() => true),
}));

vi.mock("@/lib/fast-save", () => ({
  fastSaveFile: vi.fn(async (handle: FileSystemFileHandle, content: string) => {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }),
}));

vi.mock("@/lib/plugins/runtime", () => ({
  emitVaultChange: vi.fn(),
  emitVaultRename: vi.fn(),
}));

vi.mock("../universal-file-viewer", () => ({
  UniversalFileViewer: universalViewerMock,
}));

class FakeWritable {
  private chunks: string[] = [];

  constructor(private readonly file: FakeFileHandle) {}

  async write(content: string | Blob | Uint8Array) {
    if (typeof content === "string") {
      this.chunks.push(content);
      return;
    }

    if (content instanceof Blob) {
      this.chunks.push(await content.text());
      return;
    }

    this.chunks.push(new TextDecoder().decode(content));
  }

  async close() {
    this.file.setContent(this.chunks.join(""));
  }
}

class FakeFileHandle {
  kind = "file" as const;

  constructor(public name: string, private content: string) {}

  async getFile() {
    return new File([this.content], this.name);
  }

  async createWritable() {
    return new FakeWritable(this) as unknown as FileSystemWritableFileStream;
  }

  setContent(content: string) {
    this.content = content;
  }

  async isSameEntry(other: FileSystemHandle) {
    return other === (this as unknown as FileSystemHandle);
  }
}

class FakeDirectoryHandle {
  kind = "directory" as const;
  private readonly files = new Map<string, FakeFileHandle>();

  constructor(public name: string) {}

  addFile(file: FakeFileHandle) {
    this.files.set(file.name, file);
    return file;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name);
    if (existing) {
      return existing as unknown as FileSystemFileHandle;
    }

    if (options?.create) {
      const created = new FakeFileHandle(name, "");
      this.files.set(name, created);
      return created as unknown as FileSystemFileHandle;
    }

    throw new DOMException(`File not found: ${name}`, "NotFoundError");
  }

  async getDirectoryHandle(name: string) {
    throw new DOMException(`Directory not found: ${name}`, "NotFoundError");
  }

  async removeEntry(name: string) {
    this.files.delete(name);
  }

  async *values() {
    for (const file of this.files.values()) {
      yield file as unknown as FileSystemFileHandle;
    }
  }

  async isSameEntry(other: FileSystemHandle) {
    return other === (this as unknown as FileSystemHandle);
  }
}

describe("PaneWrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    universalViewerMock.mockImplementation((props: unknown) => {
      const {
        onContentChange,
        onSave,
      } = props as {
        onContentChange?: (content: string) => void;
        onSave?: () => Promise<void>;
      };

      return (
        <div>
          <button type="button" onClick={() => onContentChange?.("# My Title\n\nBody")}>
            编辑
          </button>
          <button type="button" onClick={() => void onSave?.()}>
            保存
          </button>
        </div>
      );
    });

    useContentCacheStore.getState().clearCache();
    useExplorerStore.setState({
      selectedPath: "workspace/Untitled.md",
      selectedKind: "file",
      renamingPath: null,
      clipboard: null,
      dragOverPath: null,
    });

    const rootHandle = new FakeDirectoryHandle("workspace");
    const untitledHandle = rootHandle.addFile(new FakeFileHandle("Untitled.md", "Old content"));
    rootHandle.addFile(new FakeFileHandle("My Title.md", "Existing"));

    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: rootHandle as unknown as FileSystemDirectoryHandle,
      fileTree: { root: null },
      layout: {
        activePaneId: "pane-left",
        root: {
          type: "pane",
          id: "pane-left",
          activeTabIndex: 0,
          tabs: [
            {
              id: "tab-1",
              fileHandle: untitledHandle as unknown as FileSystemFileHandle,
              fileName: "Untitled.md",
              filePath: "workspace/Untitled.md",
              isDirty: false,
              scrollPosition: 0,
            },
          ],
        },
      },
    }));

    desktopPreviewMocks.getDesktopPreviewPath.mockReturnValue(null);
  });

  it("renames untitled markdown files from the first H1 on save and syncs explorer selection", async () => {
    render(
      <PaneWrapper
        paneId="pane-left"
        isActive={true}
        onActivate={vi.fn()}
        onSplitRight={vi.fn()}
        onSplitDown={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      const pane = useWorkspaceStore.getState().layout.root;
      if (pane.type !== "pane") {
        throw new Error("Expected pane layout");
      }
      expect(pane.tabs[0]?.fileName).toBe("My Title-1.md");
      expect(pane.tabs[0]?.filePath).toBe("workspace/My Title-1.md");
    });

    expect(useExplorerStore.getState().selectedPath).toBe("workspace/My Title-1.md");
    expect(refreshDirectoryMock).toHaveBeenCalled();
  });

  it("uses desktop preview urls for desktop pdf tabs without calling getFile or caching binary content", async () => {
    const getFileSpy = vi.fn(async () => new File(["%PDF"], "paper.pdf"));
    const desktopHandle = {
      name: "paper.pdf",
      kind: "file" as const,
      fullPath: "C:/workspace/paper.pdf",
      __latticeDesktopHandle: true as const,
      getFile: getFileSpy,
      createWritable: vi.fn(),
      isSameEntry: vi.fn(),
    } as unknown as FileSystemFileHandle;

    desktopPreviewMocks.getDesktopPreviewPath.mockReturnValue("C:/workspace/paper.pdf");
    useWorkspaceStore.setState((state) => ({
      ...state,
      layout: {
        activePaneId: "pane-left",
        root: {
          type: "pane",
          id: "pane-left",
          activeTabIndex: 0,
          tabs: [
            {
              id: "tab-pdf",
              fileHandle: desktopHandle,
              fileName: "paper.pdf",
              filePath: "workspace/paper.pdf",
              isDirty: false,
              scrollPosition: 0,
            },
          ],
        },
      },
    }));

    render(
      <PaneWrapper
        paneId="pane-left"
        isActive={true}
        onActivate={vi.fn()}
        onSplitRight={vi.fn()}
        onSplitDown={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(universalViewerMock).toHaveBeenCalled();
    });

    const latestProps = universalViewerMock.mock.calls.at(-1)?.[0] as unknown as { content?: { kind: string; url?: string } };
    expect(latestProps.content).toEqual({
      kind: "desktop-url",
      url: "http://lattice-preview.localhost/C:/workspace/paper.pdf",
    });
    expect(getFileSpy).not.toHaveBeenCalled();
    expect(useContentCacheStore.getState().getContent("tab-pdf")).toBeUndefined();
  });
});

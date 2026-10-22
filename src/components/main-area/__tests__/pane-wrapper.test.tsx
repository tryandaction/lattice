/**
 * @vitest-environment jsdom
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaneWrapper } from "../pane-wrapper";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useExplorerStore } from "@/stores/explorer-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { setLocale } from "@/lib/i18n";
import { useCloudWorkbenchStore } from "@/stores/cloud-workbench-store";
import { getCloudWorkspaceSnapshot } from "@/lib/cloud-workspace-host";
import { createCloudFileTab } from "@/lib/shared-library/workbench-source";
import { refreshCleanWorkspaceFile } from '@/lib/workspace-live-content';
import { isFileTabState } from '@/types/layout';
import type { CloudLibraryWorkspaceController, CloudWorkspaceSnapshot } from "@/lib/shared-library/cloud-workspace";

const refreshDirectoryMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const desktopPreviewMocks = vi.hoisted(() => ({
  getDesktopPreviewPath: vi.fn((_handle?: unknown) => null as string | null),
  resolveDesktopPreviewUrl: vi.fn((path: string) => `http://lattice-preview.localhost/${path}`),
}));
const desktopFileSystemMocks = vi.hoisted(() => ({
  readDesktopTextFile: vi.fn(async (_path: string) => "full text"),
  readDesktopTextFileChunk: vi.fn(async (_path: string, _maxBytes: number) => ({
    text: "preview text\n",
    bytesRead: 13,
    totalBytes: 24,
    hasMore: true,
  })),
}));
const universalViewerMock = vi.hoisted(() => vi.fn<(props?: unknown) => React.ReactNode>((_props?: unknown) => null));
const nativeWorkbenchMock = vi.hoisted(() => vi.fn(() => <div data-testid="legacy-native-workbench" />));

vi.mock("@dnd-kit/core", () => ({
  useDndMonitor: () => undefined,
}));

vi.mock("../tab-bar", () => ({
  TabBar: ({
    tabs,
    tabIndexMap,
    onTabClick,
    onTabClose,
  }: {
    tabs?: Array<{ id: string; fileName: string }>;
    tabIndexMap?: number[];
    onTabClick?: (index: number) => void;
    onTabClose?: (index: number) => void;
  }) => (
    <div data-testid="mock-tab-bar">
      {(tabs ?? []).map((tab, displayIndex) => {
        const originalIndex = tabIndexMap?.[displayIndex] ?? displayIndex;
        return (
          <div key={tab.id} data-testid={`mock-tab-${tab.id}`} data-original-index={originalIndex}>
            <button type="button" onClick={() => onTabClick?.(originalIndex)}>
              {tab.fileName}
            </button>
            <button type="button" onClick={() => onTabClose?.(originalIndex)}>
              close tab
            </button>
          </div>
        );
      })}
    </div>
  ),
}));

vi.mock("../drop-zone", () => ({
  DropZones: () => null,
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

vi.mock("@/lib/desktop-file-system", () => ({
  readDesktopTextFile: desktopFileSystemMocks.readDesktopTextFile,
  readDesktopTextFileChunk: desktopFileSystemMocks.readDesktopTextFileChunk,
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
  emitActiveFileChange: vi.fn(),
  emitFileClose: vi.fn(),
  emitFileOpen: vi.fn(),
  emitVaultChange: vi.fn(),
  emitVaultRename: vi.fn(),
  emitWorkspaceOpen: vi.fn(),
}));

vi.mock("../universal-file-viewer", () => ({
  UniversalFileViewer: universalViewerMock,
}));

vi.mock("@/components/vscode-compat/native-vscode-workbench-pane", () => ({
  NativeVSCodeWorkbenchPane: nativeWorkbenchMock,
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
  it('passes the revision of the exact PDF File snapshot with its buffer and ignores unversioned cached PDF bytes', async () => {
    const file = new File(['fresh PDF'], 'paper.pdf', { lastModified: 12345 });
    const getFile = vi.fn(async () => file);
    const handle = { kind: 'file', name: 'paper.pdf', getFile } as unknown as FileSystemFileHandle;
    useWorkspaceStore.setState({ layout: { activePaneId: 'pane-left', root: { type: 'pane', id: 'pane-left', activeTabIndex: 0,
      tabs: [{ id: 'versioned-pdf', fileHandle: handle, fileName: 'paper.pdf', filePath: 'paper.pdf', isDirty: false, scrollPosition: 0 }] } } });
    const oldCache = new ArrayBuffer(9);
    useContentCacheStore.getState().setContent('versioned-pdf', oldCache, oldCache);
    render(<PaneWrapper paneId="pane-left" isActive onActivate={() => {}} onSplitRight={() => {}} onSplitDown={() => {}} onClose={() => {}} />);
    await waitFor(() => {
      const props = universalViewerMock.mock.calls.at(-1)?.[0] as { content?: { kind: string; data?: ArrayBuffer; sourceRevision?: string } };
      expect(props.content?.sourceRevision).toBe('9:12345');
      expect(new TextDecoder().decode(props.content?.data)).toBe('fresh PDF');
    });
    expect(getFile).toHaveBeenCalledTimes(1);
  });
  it('refreshes an editor that latches its initial document after a verified external file change', async () => {
    function LatchedEditor({ text }: { text: string }) {
      const [initialText] = React.useState(text);
      return <div data-testid="latched-editor">{initialText}</div>;
    }
    universalViewerMock.mockImplementation((props: unknown) => {
      const { content, isLoading } = props as { content?: { kind: string; text?: string }; isLoading: boolean };
      return isLoading || content?.kind !== 'text' ? null : <LatchedEditor text={content.text ?? ''} />;
    });
    render(<PaneWrapper paneId="pane-left" isActive onActivate={() => {}} onSplitRight={() => {}} onSplitDown={() => {}} onClose={() => {}} />);
    await screen.findByText('Old content');
    const pane = useWorkspaceStore.getState().layout.root;
    if (pane.type !== 'pane') throw new Error('Expected test pane');
    const tab = pane.tabs[0];
    if (!isFileTabState(tab)) throw new Error('Expected local test file');
    (tab.fileHandle as unknown as FakeFileHandle).setContent('New external text');
    await act(async () => { await refreshCleanWorkspaceFile(tab, () => true); });
    await waitFor(() => expect(screen.getByTestId('latched-editor').textContent).toBe('New external text'));
  });
  afterEach(() => { useCloudWorkbenchStore.getState().bindController(null); });
  beforeEach(() => {
    vi.clearAllMocks();
    setLocale("en-US");
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
          <button type="button" data-testid="mock-edit-button" aria-label="缂栬緫" onClick={() => onContentChange?.("# My Title\n\nBody")}>
            编辑
          </button>
          <button type="button" data-testid="mock-save-button" aria-label="淇濆瓨" onClick={() => void onSave?.()}>
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
      paneTabFilterRequests: {},
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
    desktopFileSystemMocks.readDesktopTextFile.mockResolvedValue("full text");
    desktopFileSystemMocks.readDesktopTextFileChunk.mockResolvedValue({
      text: "preview text\n",
      bytesRead: 13,
      totalBytes: 24,
      hasMore: true,
    });
  });

  it.each(["viewer", "revoked"] as const)("reacts to a %s permission update without replacing the cloud provider or deleting the draft", async (nextAccess) => {
    const item: CloudWorkspaceSnapshot["items"][number] = {
      id: "cloud-item", libraryId: "cloud-library", kind: "markdown", canonicalName: "cloud-note.md", title: "Cloud note",
      metadata: {}, currentVersionId: "v1", status: "active", createdBy: "synthetic-user", createdAt: "2026-10-12", updatedAt: "2026-10-12",
    };
    let snapshot: CloudWorkspaceSnapshot = { schema: 1, revision: 0, libraries: [], items: [item], versions: [], annotations: [], comments: [], outbox: [],
      roles: { "cloud-library": { role: "editor", verifiedAt: Date.now() } }, revoked: [], cursors: {} };
    const listeners = new Set<() => void>();
    const readResource = vi.fn(async () => ({ item, role: snapshot.roles["cloud-library"]?.role ?? "viewer", content: { kind: "text" as const, text: "Original cloud text", mimeType: "text/markdown", updatedAt: "2026-10-12" } }));
    const controller = {
      connection: { id: "synthetic-connection", name: "Synthetic", apiUrl: "https://example.invalid", supabaseUrl: "https://example.invalid", publicKey: "synthetic-public", maxFileBytes: 1024 }, userId: "synthetic-user",
      getSnapshot: () => snapshot, getStatus: () => ({ status: "synced", error: null, pending: 0 }), readResource,
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    } as unknown as CloudLibraryWorkspaceController;
    useCloudWorkbenchStore.getState().bindController(controller);
    const provider = useCloudWorkbenchStore.getState().provider!;
    const resource = await provider.read("cloud-library", "cloud-item");
    const tab = createCloudFileTab(resource, provider.scope!);
    useWorkspaceStore.setState({ rootHandle: null, layout: { activePaneId: "pane-left", root: { type: "pane", id: "pane-left", activeTabIndex: 0, tabs: [tab] } } });
    useContentCacheStore.getState().setContent(tab.id, "Unsaved cloud draft", "Original cloud text");
    render(<PaneWrapper paneId="pane-left" isActive onActivate={vi.fn()} onSplitRight={vi.fn()} onSplitDown={vi.fn()} onClose={vi.fn()} />);
    const viewer = () => universalViewerMock.mock.calls.at(-1)?.[0] as {
      content: { kind: string; text?: string } | null; error: string | null;
      onContentChange?: (text: string) => void; onSave?: () => Promise<void>;
    };
    await waitFor(() => {
      expect(viewer().content).toEqual({ kind: "text", text: "Unsaved cloud draft" });
      expect(viewer().onContentChange).toEqual(expect.any(Function));
    });
    const previousRevision = useCloudWorkbenchStore.getState().revision;
    act(() => {
      snapshot = { ...snapshot, revision: 1,
        roles: nextAccess === "viewer" ? { "cloud-library": { role: "viewer", verifiedAt: Date.now() } } : {},
        revoked: nextAccess === "revoked" ? ["cloud-library"] : [],
      };
      for (const listener of listeners) listener();
    });
    await waitFor(() => {
      expect(viewer().onContentChange).toBeUndefined();
      expect(viewer().onSave).toBeUndefined();
      if (nextAccess === "revoked") {
        expect(viewer().content).toBeNull();
        expect(viewer().error).toContain("不可访问");
      } else {
        expect(viewer().content).toEqual({ kind: "text", text: "Unsaved cloud draft" });
      }
    });
    expect(useCloudWorkbenchStore.getState().revision).toBeGreaterThan(previousRevision);
    expect(getCloudWorkspaceSnapshot().provider).toBe(provider);
    expect(useContentCacheStore.getState().getContent(tab.id)?.content).toBe("Unsaved cloud draft");
    expect(useContentCacheStore.getState().hasUnsavedChanges(tab.id)).toBe(true);
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

    fireEvent.click(screen.getByTestId("mock-edit-button"));
    fireEvent.click(screen.getByTestId("mock-save-button"));

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

  it("keeps pane focus styling inside the pane so split handles remain the only divider line", () => {
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

    const pane = screen.getByTestId("pane-wrapper-pane-left");
    expect(pane.className).toContain("shadow-[inset_0_2px_0_0_var(--workbench-focus)]");
    expect(pane.className).not.toContain("border-blue");
    expect(pane.className).not.toContain("ring-2");
  });

  it("never mounts the legacy full VS Code Workbench in the Lattice main pane", () => {
    useWorkspaceStore.setState((state) => ({
      ...state,
      layout: {
        activePaneId: "pane-left",
        root: {
          type: "pane",
          id: "pane-left",
          activeTabIndex: 0,
          tabs: [{
            id: "vscode-workbench",
            kind: "vscode-workbench",
            fileName: "VS Code",
            filePath: "vscode-workbench:C:/workspace",
            workspacePath: "C:/workspace",
            isDirty: false,
            scrollPosition: 0,
          } as never],
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

    expect(screen.queryByTestId("legacy-native-workbench")).toBeNull();
    expect(nativeWorkbenchMock).not.toHaveBeenCalled();
  });

  it("keeps URLs outside file filters and opens web tabs without changing the selected extension filter", async () => {
    const rootHandle = new FakeDirectoryHandle("workspace");
    const markdownHandle = rootHandle.addFile(new FakeFileHandle("Notes.md", "# Notes"));
    const pdfHandle = rootHandle.addFile(new FakeFileHandle("Paper.pdf", "%PDF"));
    const codeHandle = rootHandle.addFile(new FakeFileHandle("main.ts", "export {};"));
    const notebookHandle = rootHandle.addFile(new FakeFileHandle("analysis.ipynb", "{}"));
    const htmlHandle = rootHandle.addFile(new FakeFileHandle("local.html", "<h1>Local file</h1>"));

    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: rootHandle as unknown as FileSystemDirectoryHandle,
      layout: {
        activePaneId: "pane-left",
        root: {
          type: "pane",
          id: "pane-left",
          activeTabIndex: 0,
          tabs: [
            {
              kind: "web",
              id: "tab-web",
              fileName: "example.com",
              filePath: "https://example.com",
              url: "https://example.com",
              isDirty: false,
              scrollPosition: 0,
            },
            {
              id: "tab-pdf",
              fileHandle: pdfHandle as unknown as FileSystemFileHandle,
              fileName: "Paper.pdf",
              filePath: "workspace/Paper.pdf",
              isDirty: false,
              scrollPosition: 0,
            },
            {
              id: "tab-md",
              fileHandle: markdownHandle as unknown as FileSystemFileHandle,
              fileName: "Notes.md",
              filePath: "workspace/Notes.md",
              isDirty: false,
              scrollPosition: 0,
            },
            {
              id: "tab-code",
              fileHandle: codeHandle as unknown as FileSystemFileHandle,
              fileName: "main.ts",
              filePath: "workspace/main.ts",
              isDirty: false,
              scrollPosition: 0,
            },
            {
              id: "tab-notebook",
              fileHandle: notebookHandle as unknown as FileSystemFileHandle,
              fileName: "analysis.ipynb",
              filePath: "workspace/analysis.ipynb",
              isDirty: false,
              scrollPosition: 0,
            },
            { id: "tab-html", fileHandle: htmlHandle as unknown as FileSystemFileHandle, fileName: "local.html", filePath: "workspace/local.html", isDirty: false, scrollPosition: 0 },
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
      expect(screen.getByTestId("mock-tab-tab-web")).toBeTruthy();
      expect(screen.getByTestId("mock-tab-tab-pdf")).toBeTruthy();
      expect(screen.getByTestId("mock-tab-tab-md")).toBeTruthy();
      expect(screen.getByTestId("mock-tab-tab-code")).toBeTruthy();
      expect(screen.getByTestId("mock-tab-tab-notebook")).toBeTruthy();
      expect(screen.getByTestId("mock-tab-tab-html")).toBeTruthy();
      expect(screen.getByTitle("Filter open files: View all")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle(/Filter open files/));
    expect(screen.queryByText("Web only")).toBeNull();
    fireEvent.click(screen.getByText("Code only"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-tab-tab-web")).toBeTruthy();
      expect(screen.queryByTestId("mock-tab-tab-pdf")).toBeNull();
      expect(screen.queryByTestId("mock-tab-tab-md")).toBeNull();
      expect(screen.getByTestId("mock-tab-tab-code")).toBeTruthy();
      expect(screen.getByTestId("mock-tab-tab-notebook")).toBeTruthy();
      expect(screen.getByTestId("mock-tab-tab-html")).toBeTruthy();
      expect(screen.getByTitle("Clear file filter: CODE")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle(/Clear file filter/));

    await waitFor(() => {
      expect(screen.getByTitle("Filter open files: View all")).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle(/Filter open files/));
    fireEvent.click(screen.getByText("PDF only"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-tab-tab-web")).toBeTruthy();
      expect(screen.getByTestId("mock-tab-tab-pdf")).toBeTruthy();
      expect(screen.queryByTestId("mock-tab-tab-md")).toBeNull();
      expect(screen.queryByTestId("mock-tab-tab-code")).toBeNull();
      expect(screen.queryByTestId("mock-tab-tab-notebook")).toBeNull();
      expect(screen.queryByTestId("mock-tab-tab-html")).toBeNull();
      expect(screen.getByTitle("Clear file filter: PDF")).toBeTruthy();
    });

    let pane = useWorkspaceStore.getState().layout.root;
    if (pane.type !== "pane") {
      throw new Error("Expected pane layout");
    }
    expect(pane.activeTabIndex).toBe(1);

    act(() => {
      useWorkspaceStore.getState().openWebUrlInPane("pane-left", "https://example.org/new");
    });

    await waitFor(() => {
      expect(screen.getByTestId("mock-tab-tab-web")).toBeTruthy();
      expect(screen.getByText("new")).toBeTruthy();
      expect(screen.getByTestId("mock-tab-tab-pdf")).toBeTruthy();
      expect(screen.getByTitle("Clear file filter: PDF")).toBeTruthy();
    });

    pane = useWorkspaceStore.getState().layout.root;
    if (pane.type !== "pane") {
      throw new Error("Expected pane layout");
    }
    expect(pane.tabs[pane.activeTabIndex]?.filePath).toBe("https://example.org/new");
  });

  it("keeps close operations on the original tab index when the tab strip is filtered", async () => {
    const rootHandle = new FakeDirectoryHandle("workspace");
    const markdownHandle = rootHandle.addFile(new FakeFileHandle("Notes.md", "# Notes"));
    const pdfHandle = rootHandle.addFile(new FakeFileHandle("Paper.pdf", "%PDF"));
    const codeHandle = rootHandle.addFile(new FakeFileHandle("main.ts", "export {};"));

    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: rootHandle as unknown as FileSystemDirectoryHandle,
      layout: {
        activePaneId: "pane-left",
        root: {
          type: "pane",
          id: "pane-left",
          activeTabIndex: 0,
          tabs: [
            {
              id: "tab-md",
              fileHandle: markdownHandle as unknown as FileSystemFileHandle,
              fileName: "Notes.md",
              filePath: "workspace/Notes.md",
              isDirty: false,
              scrollPosition: 0,
            },
            {
              id: "tab-pdf",
              fileHandle: pdfHandle as unknown as FileSystemFileHandle,
              fileName: "Paper.pdf",
              filePath: "workspace/Paper.pdf",
              isDirty: false,
              scrollPosition: 0,
            },
            {
              id: "tab-code",
              fileHandle: codeHandle as unknown as FileSystemFileHandle,
              fileName: "main.ts",
              filePath: "workspace/main.ts",
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

    fireEvent.click(screen.getByTitle(/Filter open files/));
    fireEvent.click(screen.getByText("Code only"));

    await waitFor(() => {
      expect(screen.getByTestId("mock-tab-tab-code").getAttribute("data-original-index")).toBe("2");
      expect(screen.queryByTestId("mock-tab-tab-md")).toBeNull();
      expect(screen.queryByTestId("mock-tab-tab-pdf")).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "close tab" }));

    await waitFor(() => {
      const pane = useWorkspaceStore.getState().layout.root;
      if (pane.type !== "pane") {
        throw new Error("Expected pane layout");
      }
      expect(pane.tabs.map((tab) => tab.fileName)).toEqual(["Notes.md", "Paper.pdf"]);
    });
  });

  it("shows a save reminder dialog before closing a dirty markdown tab", async () => {
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
      const latestProps = universalViewerMock.mock.calls.at(-1)?.[0] as unknown as {
        content?: { kind: string; text?: string };
      };
      expect(latestProps.content).toEqual({ kind: "text", text: "Old content" });
    });
    fireEvent.click(screen.getByTestId("mock-edit-button"));
    await waitFor(() => {
      const pane = useWorkspaceStore.getState().layout.root;
      if (pane.type !== "pane") {
        throw new Error("Expected pane layout");
      }
      expect(pane.tabs[0]?.isDirty).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "close tab" }));

    expect(await screen.findByRole("dialog", { name: "Save changes?" })).toBeTruthy();
    expect(screen.getByText('File "Untitled.md" has unsaved changes.')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Don't Save" })).toBeTruthy();
  });

  it("restores PDF bytes after a Markdown round trip even when PDF view state was saved", async () => {
    const bytes = new ArrayBuffer(24);
    const readPdf = vi.fn(async () => ({ name: 'paper.pdf', size: bytes.byteLength, lastModified: 1, arrayBuffer: async () => bytes }));
    const pdfHandle = { kind: 'file', name: 'paper.pdf', getFile: readPdf } as unknown as FileSystemFileHandle;
    useWorkspaceStore.setState((state) => {
      const pane = state.layout.root;
      if (pane.type !== 'pane') throw new Error('Expected pane');
      return { layout: { ...state.layout, root: { ...pane, tabs: [
        { id: 'tab-pdf', fileHandle: pdfHandle, fileName: 'paper.pdf', filePath: 'workspace/paper.pdf', isDirty: false, scrollPosition: 0 },
        ...pane.tabs,
      ] } } };
    });
    render(<PaneWrapper paneId="pane-left" isActive onActivate={vi.fn()} onSplitRight={vi.fn()} onSplitDown={vi.fn()} onClose={vi.fn()} />);
    const latest = () => universalViewerMock.mock.calls.at(-1)?.[0] as { content?: { kind: string; data?: ArrayBuffer }; onContentChange?: (content: string) => void };
    await waitFor(() => expect(latest().content).toEqual({ kind: 'buffer', data: bytes, sourceRevision: '24:1' }));
    act(() => useContentCacheStore.getState().saveEditorState('tab-pdf', { cursorPosition: 0, scrollTop: 720 }));
    act(() => useWorkspaceStore.getState().setActiveTab('pane-left', 1));
    await waitFor(() => expect(latest().content).toEqual({ kind: 'text', text: 'Old content' }));
    act(() => useWorkspaceStore.getState().setActiveTab('pane-left', 0));
    await waitFor(() => expect(latest().content).toEqual({ kind: 'buffer', data: bytes, sourceRevision: '24:1' }));
    expect(readPdf).toHaveBeenCalledTimes(2);
    expect(useContentCacheStore.getState().getEditorState('tab-pdf')?.scrollTop).toBe(720);
  });

  it("rejects a retiring editor change immediately after the store switches tabs", async () => {
    const bytes = new ArrayBuffer(24);
    const pdfHandle = { kind: 'file', name: 'paper.pdf', getFile: async () => ({ name: 'paper.pdf', size: bytes.byteLength, lastModified: 1, arrayBuffer: async () => bytes }) } as unknown as FileSystemFileHandle;
    useWorkspaceStore.setState((state) => {
      const pane = state.layout.root;
      if (pane.type !== 'pane') throw new Error('Expected pane');
      return { layout: { ...state.layout, root: { ...pane, tabs: [...pane.tabs,
        { id: 'tab-pdf', fileHandle: pdfHandle, fileName: 'paper.pdf', filePath: 'workspace/paper.pdf', isDirty: false, scrollPosition: 0 },
      ] } } };
    });
    render(<PaneWrapper paneId="pane-left" isActive onActivate={vi.fn()} onSplitRight={vi.fn()} onSplitDown={vi.fn()} onClose={vi.fn()} />);
    const latest = () => universalViewerMock.mock.calls.at(-1)?.[0] as { content?: { kind: string; data?: ArrayBuffer }; onContentChange?: (content: string) => void };
    await waitFor(() => expect(latest().content).toEqual({ kind: 'text', text: 'Old content' }));
    const retiringChange = latest().onContentChange!;
    act(() => {
      useWorkspaceStore.getState().setActiveTab('pane-left', 1);
      retiringChange('Late update from the previous editor');
    });
    await waitFor(() => expect(latest().content).toEqual({ kind: 'buffer', data: bytes, sourceRevision: '24:1' }));
    expect(useContentCacheStore.getState().getContent('tab-1')?.content).toBe('Old content');
    expect(useContentCacheStore.getState().hasUnsavedChanges('tab-1')).toBe(false);
  });

  it("shares an unfinished read across rapid A-B-A tab switches without showing stale content", async () => {
    let complete!: (file: File) => void;
    const pending = new Promise<File>((resolve) => { complete = resolve; });
    const getFile = vi.fn(() => pending);
    const a = { kind: "file", name: "a.md", getFile } as unknown as FileSystemFileHandle;
    const b = new FakeFileHandle("b.md", "B document") as unknown as FileSystemFileHandle;
    useWorkspaceStore.setState((state) => ({ layout: { ...state.layout, root: {
      type: "pane", id: "pane-left", activeTabIndex: 0, tabs: [
        { id: "a", fileName: "a.md", filePath: "workspace/a.md", fileHandle: a, isDirty: false, scrollPosition: 0 },
        { id: "b", fileName: "b.md", filePath: "workspace/b.md", fileHandle: b, isDirty: false, scrollPosition: 0 },
      ],
    } } }));
    render(<PaneWrapper paneId="pane-left" isActive onActivate={vi.fn()} onSplitRight={vi.fn()} onSplitDown={vi.fn()} onClose={vi.fn()} />);
    const latest = () => universalViewerMock.mock.calls.at(-1)?.[0] as { content?: { text?: string } };
    await waitFor(() => expect(getFile).toHaveBeenCalledTimes(1));
    act(() => useWorkspaceStore.getState().setActiveTab("pane-left", 1));
    await waitFor(() => expect(latest().content?.text).toBe("B document"));
    act(() => useWorkspaceStore.getState().setActiveTab("pane-left", 0));
    await act(async () => { complete(new File(["A document"], "a.md")); });
    await waitFor(() => expect(latest().content?.text).toBe("A document"));
    expect(getFile).toHaveBeenCalledTimes(1);
    expect(useContentCacheStore.getState().getContent("b")?.content).toBe("B document");
  });

  it("opens dirty annotation-index cache before starting progressive disk reads", async () => {
    desktopPreviewMocks.getDesktopPreviewPath.mockReturnValue("C:/workspace/_annotations.md");
    useContentCacheStore.getState().setContent("tab-1", "Unsaved annotation notes", "Original notes");
    useWorkspaceStore.setState((state) => {
      const pane = state.layout.root;
      if (pane.type !== "pane") throw new Error("Expected pane");
      return { layout: { ...state.layout, root: { ...pane, tabs: pane.tabs.map((tab) => ({
        ...tab, fileName: "_annotations.md", filePath: "workspace/_annotations.md", isDirty: true,
      })) } } };
    });
    render(<PaneWrapper paneId="pane-left" isActive onActivate={vi.fn()} onSplitRight={vi.fn()} onSplitDown={vi.fn()} onClose={vi.fn()} />);
    await waitFor(() => expect((universalViewerMock.mock.calls.at(-1)?.[0] as { content?: { text?: string } }).content?.text)
      .toBe("Unsaved annotation notes"));
    expect(desktopFileSystemMocks.readDesktopTextFileChunk).not.toHaveBeenCalled();
    expect(desktopFileSystemMocks.readDesktopTextFile).not.toHaveBeenCalled();
    expect(useContentCacheStore.getState().hasUnsavedChanges("tab-1")).toBe(true);
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

  it("renders desktop annotation index preview before the full file finishes loading", async () => {
    let resolveFullText!: (value: string) => void;
    const fullTextPromise = new Promise<string>((resolve) => {
      resolveFullText = resolve;
    });
    desktopFileSystemMocks.readDesktopTextFileChunk.mockResolvedValue({
      text: "# Preview\n\nFirst annotation\n",
      bytesRead: 28,
      totalBytes: 80,
      hasMore: true,
    });
    desktopFileSystemMocks.readDesktopTextFile.mockReturnValue(fullTextPromise);

    const getFileSpy = vi.fn(async () => new File(["# Full"], "_annotations.md"));
    const desktopHandle = {
      name: "_annotations.md",
      kind: "file" as const,
      fullPath: "C:/workspace/.lattice/items/paper/_annotations.md",
      __latticeDesktopHandle: true as const,
      getFile: getFileSpy,
      createWritable: vi.fn(),
      isSameEntry: vi.fn(),
    } as unknown as FileSystemFileHandle;

    desktopPreviewMocks.getDesktopPreviewPath.mockReturnValue("C:/workspace/.lattice/items/paper/_annotations.md");
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
              id: "tab-annotations",
              fileHandle: desktopHandle,
              fileName: "_annotations.md",
              filePath: "workspace/.lattice/items/paper/_annotations.md",
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
      const latestProps = universalViewerMock.mock.calls.at(-1)?.[0] as unknown as {
        content?: { kind: string; text?: string };
        isLoading?: boolean;
      };
      expect(latestProps.isLoading).toBe(false);
      expect(latestProps.content).toEqual({
        kind: "text",
        text: "# Preview\n\nFirst annotation",
      });
    });

    expect(getFileSpy).not.toHaveBeenCalled();
    expect(desktopFileSystemMocks.readDesktopTextFileChunk).toHaveBeenCalledWith(
      "C:/workspace/.lattice/items/paper/_annotations.md",
      128 * 1024,
    );
    expect(desktopFileSystemMocks.readDesktopTextFileChunk).toHaveBeenCalledTimes(1);
    expect(desktopFileSystemMocks.readDesktopTextFile).toHaveBeenCalledTimes(1);

    resolveFullText("# Full\n\nAll annotations");

    await waitFor(() => {
      const latestProps = universalViewerMock.mock.calls.at(-1)?.[0] as unknown as {
        content?: { kind: string; text?: string };
      };
      expect(latestProps.content).toEqual({
        kind: "text",
        text: "# Full\n\nAll annotations",
      });
    });
  });
});

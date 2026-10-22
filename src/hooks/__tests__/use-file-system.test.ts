/**
 * @vitest-environment jsdom
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyWorkspaceHandleToStores, readDirectoryChildren, readDirectoryRecursive, resolvePathFromLatticeRoot, useFileSystem } from "@/hooks/use-file-system";
import { useSettingsStore } from "@/stores/settings-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { isFileNode, type DirectoryNode, type TreeNode } from "@/types/file-system";
import { getWorkspaceStartupSnapshot } from "@/lib/workspace-startup-performance";
import { saveWorkspaceUiState } from "@/lib/workspace-ui-state";

const pdfItemLocationMocks = vi.hoisted(() => ({
  registerPdfItemLocation: vi.fn(),
  registerPdfItemLocationForRoot: vi.fn(async () => undefined),
  resolvePdfItemLocation: vi.fn(),
  resolvePdfItemLocationRoot: vi.fn(),
}));
const workspaceRegistrationMocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/lib/workspace-identity", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/workspace-identity")>(),
  loadWorkspaceHandleRegistration: workspaceRegistrationMocks.load,
}));

vi.mock("@/lib/pdf-item-location-registry", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/pdf-item-location-registry")>(),
  ...pdfItemLocationMocks,
}));

class FakeFileHandle {
  kind = "file" as const;
  private bytes: Uint8Array;

  constructor(public name: string, content = "") {
    this.bytes = new TextEncoder().encode(content);
  }

  async getFile() {
    const bytes = this.bytes;
    return {
      name: this.name,
      type: "text/plain",
      lastModified: 0,
      size: bytes.byteLength,
      text: async () => new TextDecoder().decode(bytes),
      arrayBuffer: async () => bytes.slice().buffer,
      slice: (start = 0, end = bytes.byteLength) => ({
        arrayBuffer: async () => bytes.slice(start, end).buffer,
      }),
    };
  }

  async createWritable() {
    return {
      write: async (value: FileSystemWriteChunkType) => {
        if (typeof value === "string") {
          this.bytes = new TextEncoder().encode(value);
          return;
        }
        if (value instanceof ArrayBuffer) {
          this.bytes = new Uint8Array(value.slice(0));
          return;
        }
        if (ArrayBuffer.isView(value)) {
          this.bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        }
      },
      close: async () => undefined,
    };
  }

  async isSameEntry(other: FileSystemHandle) {
    return other === (this as unknown as FileSystemHandle);
  }
}

class FakeDirectoryHandle {
  kind = "directory" as const;
  private readonly directories = new Map<string, FakeDirectoryHandle>();
  private readonly files = new Map<string, FakeFileHandle>();
  valuesCallCount = 0;

  constructor(public name: string) {}

  addDirectory(dir: FakeDirectoryHandle) {
    this.directories.set(dir.name, dir);
    return dir;
  }

  addFile(file: FakeFileHandle) {
    this.files.set(file.name, file);
    return file;
  }

  async *values(): AsyncGenerator<FakeDirectoryHandle | FakeFileHandle> {
    this.valuesCallCount += 1;
    for (const dir of this.directories.values()) {
      yield dir;
    }
    for (const file of this.files.values()) {
      yield file;
    }
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const existing = this.directories.get(name);
    if (existing) {
      return existing;
    }

    if (options?.create) {
      const created = new FakeDirectoryHandle(name);
      this.directories.set(name, created);
      return created;
    }

    throw new DOMException(`Directory not found: ${name}`, "NotFoundError");
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const existing = this.files.get(name);
    if (existing) {
      return existing;
    }

    if (options?.create) {
      const created = new FakeFileHandle(name, "");
      this.files.set(name, created);
      return created;
    }

    throw new DOMException(`File not found: ${name}`, "NotFoundError");
  }

  async removeEntry(name: string, options?: { recursive?: boolean }) {
    if (this.files.delete(name)) {
      return;
    }
    const directory = this.directories.get(name);
    if (!directory) {
      throw new DOMException(`Entry not found: ${name}`, "NotFoundError");
    }
    if (!options?.recursive && (directory.files.size > 0 || directory.directories.size > 0)) {
      throw new DOMException(`Directory is not empty: ${name}`, "InvalidModificationError");
    }
    this.directories.delete(name);
  }

  async isSameEntry(other: FileSystemHandle) {
    return other === (this as unknown as FileSystemHandle);
  }
}

describe("readDirectoryRecursive", () => {
  beforeEach(() => {
    workspaceRegistrationMocks.load.mockReset();
    localStorage.clear();
    useContentCacheStore.getState().clearCache();
    pdfItemLocationMocks.registerPdfItemLocationForRoot.mockClear();
    pdfItemLocationMocks.resolvePdfItemLocation.mockReset();
    pdfItemLocationMocks.resolvePdfItemLocationRoot.mockReset();
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        lastOpenedFolder: null,
        lastWorkspacePath: null,
        lastWorkspaceKey: null,
        recentWorkspacePaths: [],
      },
    }));
    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: null,
      workspaceRootHandle: null,
      workspaceRootPath: null,
      fileTree: { root: null },
      isLoading: false,
      error: null,
    }));
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
  });

  it("marks pdf nodes as lazily expandable and hides the raw hidden companion directory", async () => {
    const root = new FakeDirectoryHandle("workspace");
    root.addFile(new FakeFileHandle("paper.pdf"));
    root.addFile(new FakeFileHandle("notes.md"));

    const latticeDir = root.addDirectory(new FakeDirectoryHandle(".lattice"));
    const itemsDir = latticeDir.addDirectory(new FakeDirectoryHandle("items"));
    const itemDir = itemsDir.addDirectory(new FakeDirectoryHandle("workspace-paper.pdf"));
    itemDir.addFile(new FakeFileHandle("manifest.json", JSON.stringify({
      version: 2,
      itemId: "workspace-paper.pdf",
      pdfPath: "workspace/paper.pdf",
      itemFolderPath: ".lattice/items/workspace-paper.pdf",
      annotationIndexPath: ".lattice/items/workspace-paper.pdf/_annotations.md",
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
    })));
    itemDir.addFile(new FakeFileHandle("Reading Note.md"));
    itemDir.addFile(new FakeFileHandle("Lab Notebook.ipynb"));
    itemDir.addFile(new FakeFileHandle("_annotations.md"));

    const nodes = await readDirectoryRecursive(root as unknown as FileSystemDirectoryHandle);
    const pdfNode = nodes.find((node) => isFileNode(node) && node.name === "paper.pdf");
    const hiddenItemDir = nodes.find((node) => !isFileNode(node) && node.name === ".lattice");

    expect(hiddenItemDir).toBeUndefined();
    expect(pdfNode && isFileNode(pdfNode)).toBe(true);
    if (!pdfNode || !isFileNode(pdfNode)) {
      throw new Error("Expected pdf node");
    }
    expect(pdfNode.children).toBeUndefined();
    expect(pdfNode.canExpandVirtualChildren).toBe(true);
    expect(pdfNode.virtualChildrenState).toBe("idle");
  });

  it("does not rerender file-system consumers for unrelated layout updates", () => {
    let renderCount = 0;
    renderHook(() => {
      renderCount += 1;
      return useFileSystem();
    });
    const settledRenderCount = renderCount;
    act(() => {
      for (let i = 0; i < 100; i += 1) {
        useWorkspaceStore.setState((state) => ({ layout: { ...state.layout } }));
      }
    });
    expect(renderCount).toBe(settledRenderCount);
  });

  it("can skip file-tree subscriptions for action-only Explorer consumers", () => {
    let renderCount = 0;
    renderHook(() => {
      renderCount += 1;
      return useFileSystem({ subscribeToTree: false });
    });
    const settledRenderCount = renderCount;
    act(() => {
      useWorkspaceStore.getState().setFileTree({
        root: {
          name: "workspace",
          kind: "directory",
          handle: new FakeDirectoryHandle("workspace") as unknown as FileSystemDirectoryHandle,
          children: [],
          path: "workspace",
          isExpanded: true,
        },
      });
    });
    expect(renderCount).toBe(settledRenderCount);
  });

  it("reopens a registered recent browser workspace with granted access", async () => {
    const root = new FakeDirectoryHandle("browser-workspace");
    root.addFile(new FakeFileHandle("notes.md", "synthetic"));
    const queryPermission = vi.fn(async () => "granted");
    const requestPermission = vi.fn(async () => "granted");
    const handle = Object.assign(root, { queryPermission, requestPermission });
    workspaceRegistrationMocks.load.mockResolvedValue({ workspaceKey: "web:recent", displayPath: root.name, handle });
    useSettingsStore.setState((state) => ({ settings: { ...state.settings,
      recentWorkspaceKeys: ["web:recent"], workspaceDisplayPaths: { "web:recent": root.name },
    } }));
    const { result } = renderHook(() => useFileSystem());
    await act(async () => result.current.openWorkspacePath(root.name));
    expect(useWorkspaceStore.getState().rootHandle).toBe(handle);
    expect(queryPermission).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().error).toBeNull();
  });

  it("keeps the existing workspace when a recent browser folder denies access", async () => {
    const current = new FakeDirectoryHandle("current");
    useWorkspaceStore.setState({ rootHandle: current as unknown as FileSystemDirectoryHandle });
    const requestPermission = vi.fn(async () => "denied");
    workspaceRegistrationMocks.load.mockResolvedValue({
      handle: { queryPermission: vi.fn(async () => "prompt"), requestPermission },
    });
    useSettingsStore.setState((state) => ({ settings: { ...state.settings,
      recentWorkspaceKeys: ["web:blocked"], workspaceDisplayPaths: { "web:blocked": "blocked" },
    } }));
    const { result } = renderHook(() => useFileSystem());
    await act(async () => result.current.openWorkspacePath("blocked"));
    expect(requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(useWorkspaceStore.getState().rootHandle).toBe(current);
    expect(useWorkspaceStore.getState().error).toBeTruthy();
    expect(useWorkspaceStore.getState().isLoading).toBe(false);
  });

  it("does not let a slow workspace open replace a more recently selected folder", async () => {
    const slow = new FakeDirectoryHandle("slow");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const read = slow.values.bind(slow);
    slow.values = async function* () { await blocked; yield* read(); };
    const fast = new FakeDirectoryHandle("fast");
    const pending = applyWorkspaceHandleToStores(slow as unknown as FileSystemDirectoryHandle, "slow");
    await applyWorkspaceHandleToStores(fast as unknown as FileSystemDirectoryHandle, "fast");
    release();
    await pending;
    expect(useWorkspaceStore.getState().rootHandle).toBe(fast);
    expect(useWorkspaceStore.getState().fileTree.root?.name).toBe("fast");
  });

  it("restores expanded directories without scanning collapsed branches", async () => {
    const root = new FakeDirectoryHandle("restore");
    const docs = root.addDirectory(new FakeDirectoryHandle("docs"));
    docs.addFile(new FakeFileHandle("guide.md", "guide"));
    const archive = root.addDirectory(new FakeDirectoryHandle("archive"));
    archive.addFile(new FakeFileHandle("hidden.md", "not scanned"));
    await saveWorkspaceUiState("web:restore", "restore", { version: 1, explorer: {
      expandedPaths: ["restore", "restore/docs"], selectedPath: "restore/docs/guide.md", selectedKind: "file",
    } });
    await applyWorkspaceHandleToStores(root as unknown as FileSystemDirectoryHandle, "restore", "web:restore");
    const tree = useWorkspaceStore.getState().fileTree.root;
    const restored = tree?.children.find((node) => node.name === "docs") as DirectoryNode;
    expect(restored.isExpanded).toBe(true);
    expect(restored.childrenState).toBe("ready");
    expect(restored.children[0]?.name).toBe("guide.md");
    expect(archive.valuesCallCount).toBe(0);
  });

  it("retains the existing editor and dirty cache when a new folder cannot be read", async () => {
    const current = useWorkspaceStore.getState().layout;
    useContentCacheStore.getState().setContent("unsaved", "draft", "original");
    const broken = new FakeDirectoryHandle("broken");
    broken.values = async function* () { throw new Error("permission denied"); };
    await expect(applyWorkspaceHandleToStores(broken as unknown as FileSystemDirectoryHandle, "broken"))
      .rejects.toThrow("permission denied");
    expect(useWorkspaceStore.getState().layout).toBe(current);
    expect(useContentCacheStore.getState().getContent("unsaved")?.content).toBe("draft");
  });

  it("refuses a readable local folder switch while preserving the current cloud draft", async () => {
    useWorkspaceStore.setState({ rootHandle: null, workspaceRootHandle: null, workspaceRootPath: null,
      layout: { activePaneId: "pane-cloud", root: { type: "pane", id: "pane-cloud", activeTabIndex: 0, tabs: [{
        id: "cloud-draft", kind: "cloud-file", fileName: "draft.md", filePath: "cloud://synthetic-resource", isDirty: true, scrollPosition: 0,
        cloud: { scope: "account-a", resourceId: "synthetic-resource", libraryId: "library", itemId: "item", versionId: "v1", role: "editor" },
      }] } } });
    const current = useWorkspaceStore.getState().layout;
    useContentCacheStore.getState().setContent("cloud-draft", "unsaved cloud draft", "original cloud text");
    const target = new FakeDirectoryHandle("readable-local-folder");
    target.addFile(new FakeFileHandle("local.md", "local content"));
    await expect(applyWorkspaceHandleToStores(target as unknown as FileSystemDirectoryHandle, "readable-local-folder"))
      .rejects.toThrow("当前有尚未保存");
    expect(useWorkspaceStore.getState().layout).toBe(current);
    expect(useWorkspaceStore.getState().rootHandle).toBeNull();
    expect(useContentCacheStore.getState().getContent("cloud-draft")?.content).toBe("unsaved cloud draft");
    expect(useContentCacheStore.getState().hasUnsavedChanges("cloud-draft")).toBe(true);
  });

  it("does not publish a stale refresh over a newly opened folder", async () => {
    const old = new FakeDirectoryHandle("old");
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const read = old.values.bind(old);
    old.values = async function* () { await blocked; yield* read(); };
    useWorkspaceStore.setState({ rootHandle: old as unknown as FileSystemDirectoryHandle });
    const { result } = renderHook(() => useFileSystem());
    let refresh!: Promise<void>;
    act(() => { refresh = result.current.refreshDirectory({ silent: true }); });
    const current = new FakeDirectoryHandle("current");
    await act(async () => {
      await applyWorkspaceHandleToStores(current as unknown as FileSystemDirectoryHandle, "current");
      release();
      await refresh;
    });
    expect(useWorkspaceStore.getState().fileTree.root?.name).toBe("current");
  });

  it("preserves the visible tree after a failed refresh and clears the error after a successful retry", async () => {
    const root = new FakeDirectoryHandle("workspace");
    root.addFile(new FakeFileHandle("kept.md", "saved"));
    await applyWorkspaceHandleToStores(root as unknown as FileSystemDirectoryHandle, root.name);
    const previousTree = useWorkspaceStore.getState().fileTree.root;
    const read = root.values.bind(root);
    root.values = async function* () { throw new Error("Folder access lost"); };
    const { result } = renderHook(() => useFileSystem());
    await act(async () => result.current.refreshDirectory());
    expect(useWorkspaceStore.getState().fileTree.root).toBe(previousTree);
    expect(useWorkspaceStore.getState().error).toBe("Folder access lost");
    root.values = read;
    await act(async () => result.current.refreshDirectory());
    expect(useWorkspaceStore.getState().fileTree.root?.children.some((node) => node.name === "kept.md")).toBe(true);
    expect(useWorkspaceStore.getState().error).toBeNull();
  });

  it("keeps empty directories visible as valid move targets", async () => {
    const root = new FakeDirectoryHandle("workspace");
    root.addDirectory(new FakeDirectoryHandle("PDF"));

    const nodes = await readDirectoryRecursive(root as unknown as FileSystemDirectoryHandle);

    expect(nodes.map((node) => node.name)).toEqual(["PDF"]);
    expect(nodes[0]?.kind).toBe("directory");
  });

  it("reads only direct children for staged workspace startup", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const nested = root.addDirectory(new FakeDirectoryHandle("docs"));
    nested.addFile(new FakeFileHandle("deep.md"));
    root.addFile(new FakeFileHandle("notes.md"));

    const nodes = await readDirectoryChildren(
      root as unknown as FileSystemDirectoryHandle,
      "workspace",
    );

    expect(nodes.map((node) => node.name)).toEqual(["docs", "notes.md"]);
    expect(nodes.find((node) => node.name === "deep.md")).toBeUndefined();
    expect(root.valuesCallCount).toBe(1);
    expect(nested.valuesCallCount).toBe(0);
    expect(nodes[0]?.kind === "directory" ? nodes[0].childrenState : null).toBe("idle");
  });

  it("publishes the root tree without reading nested directories", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const docs = root.addDirectory(new FakeDirectoryHandle("docs"));
    docs.addFile(new FakeFileHandle("deep.md"));

    await applyWorkspaceHandleToStores(
      root as unknown as FileSystemDirectoryHandle,
      "workspace",
    );

    const rootNode = useWorkspaceStore.getState().fileTree.root;
    expect(rootNode?.children.map((node) => node.name)).toEqual(["docs"]);
    expect(docs.valuesCallCount).toBe(0);
    expect(rootNode?.children[0]?.kind === "directory" ? rootNode.children[0].childrenState : null).toBe("idle");
    expect(getWorkspaceStartupSnapshot()["root-tree-ready"]).not.toBeNull();
  });

  it("opens a desktop workspace in Tauri mode and rebuilds the file tree", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "get_setting") {
        return null;
      }

      if (command === "set_setting" || command === "remove_setting" || command === "clear_settings") {
        return null;
      }

      if (command === "plugin:dialog|open") {
        expect(args).toEqual({
          options: {
            directory: true,
            multiple: false,
            title: "Open Folder",
          },
        });
        return "C:/vault";
      }

      if (command === "desktop_read_dir") {
        const path = String(args?.path ?? "");
        if (path === "C:/vault") {
          return [
            { name: "docs", isDirectory: true, isFile: false, isSymlink: false },
            { name: "notes.md", isDirectory: false, isFile: true, isSymlink: false },
          ];
        }

        if (path === "C:/vault/docs") {
          return [
            { name: "paper.pdf", isDirectory: false, isFile: true, isSymlink: false },
          ];
        }
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    (window as Window & {
      __TAURI__?: { core: { invoke: typeof window.__TAURI__ extends { core: { invoke: infer U } } ? U : never } };
    }).__TAURI__ = {
      core: { invoke: invoke as never },
    };

    const { result } = renderHook(() => useFileSystem());

    await waitFor(() => {
      expect(result.current.isSupported).toBe(true);
    });

    await act(async () => {
      await result.current.openDirectory();
    });

    const workspace = useWorkspaceStore.getState();
    expect(workspace.workspaceRootPath).toBe("C:/vault");
    expect(workspace.rootHandle?.name).toBe("vault");
    expect(workspace.fileTree.root?.children.map((node) => node.name)).toEqual(["docs", "notes.md"]);
    expect(useSettingsStore.getState().settings.lastOpenedFolder).toBe("C:/vault");
  });

  it("keeps the current workspace visible when desktop dialog opening times out", async () => {
    const root = new FakeDirectoryHandle("existing");
    root.addFile(new FakeFileHandle("notes.md"));

    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: root as unknown as FileSystemDirectoryHandle,
      workspaceRootPath: "C:/existing",
      fileTree: {
        root: {
          name: "existing",
          kind: "directory",
          handle: root as unknown as FileSystemDirectoryHandle,
          path: "existing",
          isExpanded: true,
          children: [],
        },
      },
      error: null,
    }));

    const invoke = vi.fn(async (command: string) => {
      if (command === "plugin:dialog|open") {
        throw new Error("Tauri command plugin:dialog|open timed out after 30000ms");
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    (window as Window & {
      __TAURI__?: { core: { invoke: typeof window.__TAURI__ extends { core: { invoke: infer U } } ? U : never } };
    }).__TAURI__ = {
      core: { invoke: invoke as never },
    };

    const { result } = renderHook(() => useFileSystem());

    await waitFor(() => {
      expect(result.current.isSupported).toBe(true);
    });

    await act(async () => {
      await result.current.openDirectory();
    });

    expect(useWorkspaceStore.getState().workspaceRootPath).toBe("C:/existing");
    expect(useWorkspaceStore.getState().error).toBeNull();
  });

  it("drops a missing recent desktop workspace before reopening", async () => {
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        lastOpenedFolder: "C:/missing",
        lastWorkspacePath: "C:/missing",
        recentWorkspacePaths: ["C:/missing"],
      },
    }));

    const invoke = vi.fn(async (command: string) => {
      if (command === "get_setting") {
        return null;
      }

      if (command === "set_setting" || command === "remove_setting" || command === "clear_settings") {
        return null;
      }

      if (command === "desktop_is_directory") {
        return false;
      }

      throw new Error(`Unexpected invoke: ${command}`);
    });

    (window as Window & {
      __TAURI__?: { core: { invoke: typeof window.__TAURI__ extends { core: { invoke: infer U } } ? U : never } };
    }).__TAURI__ = {
      core: { invoke: invoke as never },
    };

    const { result } = renderHook(() => useFileSystem());

    await waitFor(() => {
      expect(result.current.isSupported).toBe(true);
    });

    await act(async () => {
      await result.current.openWorkspacePath("C:/missing");
    });

    expect(useSettingsStore.getState().settings.recentWorkspacePaths).toEqual([]);
    expect(useSettingsStore.getState().settings.lastWorkspacePath).toBeNull();
    expect(useWorkspaceStore.getState().workspaceRootPath).toBeNull();
    expect(useWorkspaceStore.getState().error).toContain("Workspace path no longer exists");
  });

  it("opens a selected child directory as a new workspace", async () => {
    const root = new FakeDirectoryHandle("Course");
    const elective = root.addDirectory(new FakeDirectoryHandle("选修"));
    const stats = elective.addDirectory(new FakeDirectoryHandle("概统"));
    stats.addFile(new FakeFileHandle("讲义.pdf"));

    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: root as unknown as FileSystemDirectoryHandle,
      workspaceRootHandle: root as unknown as FileSystemDirectoryHandle, // Required for .lattice access
      workspaceRootPath: "Course",
      fileTree: { root: null },
    }));

    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      await result.current.openDirectoryAsWorkspace("Course/选修/概统");
    });

    expect(useWorkspaceStore.getState().workspaceRootPath).toBe("Course/选修/概统");
    expect(useWorkspaceStore.getState().rootHandle?.name).toBe("概统");
    expect(useWorkspaceStore.getState().workspaceIdentity?.workspaceKey).toContain("web:");
  });

  it("hydrates pdf virtual children on demand", async () => {
    const root = new FakeDirectoryHandle("workspace");
    root.addFile(new FakeFileHandle("paper.pdf"));

    const latticeDir = root.addDirectory(new FakeDirectoryHandle(".lattice"));
    const itemsDir = latticeDir.addDirectory(new FakeDirectoryHandle("items"));
    const itemDir = itemsDir.addDirectory(new FakeDirectoryHandle("workspace-paper.pdf"));
    itemDir.addFile(new FakeFileHandle("manifest.json", JSON.stringify({
      version: 4,
      itemId: "workspace-paper.pdf",
      pdfPath: "workspace/paper.pdf",
      itemFolderPath: ".lattice/items/workspace-paper.pdf",
      annotationIndexPath: ".lattice/items/workspace-paper.pdf/_annotations.md",
      fileFingerprint: null,
      versionFingerprint: null,
      knownPdfPaths: ["workspace/paper.pdf"],
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
    })));
    itemDir.addFile(new FakeFileHandle("Reading Note.md"));

    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: root as unknown as FileSystemDirectoryHandle,
      workspaceRootHandle: root as unknown as FileSystemDirectoryHandle, // Required for .lattice access
      fileTree: {
        root: {
          name: "workspace",
          kind: "directory",
          handle: root as unknown as FileSystemDirectoryHandle,
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
              virtualChildrenState: "idle",
              isExpanded: true,
            },
          ],
        },
      },
    }));

    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      await result.current.hydratePdfVirtualChildren("workspace/paper.pdf", { expand: true });
    });

    const pdfNode = useWorkspaceStore.getState().fileTree.root?.children[0];
    expect(isFileNode(pdfNode as never) && pdfNode?.children?.map((child) => child.name)).toEqual([
      "Reading Note.md",
    ]);
  });

  it("hydrates pdf virtual children from the ancestor lattice root after opening a nested folder", async () => {
    const root = new FakeDirectoryHandle("Course");
    const elective = root.addDirectory(new FakeDirectoryHandle("选修"));
    const stats = elective.addDirectory(new FakeDirectoryHandle("概统"));
    stats.addFile(new FakeFileHandle("讲义.pdf", "%PDF-test"));

    const latticeDir = root.addDirectory(new FakeDirectoryHandle(".lattice"));
    const itemsDir = latticeDir.addDirectory(new FakeDirectoryHandle("items"));
    const itemDir = itemsDir.addDirectory(new FakeDirectoryHandle("lecture-item"));
    itemDir.addFile(new FakeFileHandle("manifest.json", JSON.stringify({
      version: 4,
      itemId: "lecture-item",
      pdfPath: "Course/选修/概统/讲义.pdf",
      itemFolderPath: ".lattice/items/lecture-item",
      annotationIndexPath: null,
      fileFingerprint: null,
      versionFingerprint: null,
      knownPdfPaths: ["Course/选修/概统/讲义.pdf"],
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
    })));
    itemDir.addFile(new FakeFileHandle("Reading Note.md", "# Reading Note"));

    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: root as unknown as FileSystemDirectoryHandle,
      workspaceRootHandle: root as unknown as FileSystemDirectoryHandle,
      workspaceRootPath: "Course",
      workspaceRootHistory: new Map([
        ["Course", root as unknown as FileSystemDirectoryHandle],
      ]),
      fileTree: { root: null },
    }));

    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      await result.current.openDirectoryAsWorkspace("Course/选修/概统");
    });

    const pdfNode = useWorkspaceStore.getState().fileTree.root?.children.find(
      (node) => node.kind === "file" && node.name === "讲义.pdf",
    );
    expect(pdfNode?.path).toBe("概统/讲义.pdf");
    expect(useWorkspaceStore.getState().workspaceRootHandle).toBe(root);
    expect(resolvePathFromLatticeRoot(pdfNode?.path ?? ""))
      .toBe("Course/选修/概统/讲义.pdf");

    await act(async () => {
      await result.current.hydratePdfVirtualChildren(pdfNode?.path ?? "", { expand: true });
    });

    const hydratedPdf = useWorkspaceStore.getState().fileTree.root?.children.find(
      (node) => node.kind === "file" && node.name === "讲义.pdf",
    );
    expect(hydratedPdf?.kind === "file" ? hydratedPdf.children?.map((child) => child.name) : [])
      .toContain("Reading Note.md");
  });

  it("hydrates pdf virtual children from a catalogued workspace after the pdf moves outside its lattice root", async () => {
    const oldRoot = new FakeDirectoryHandle("old-workspace");
    const oldLattice = oldRoot.addDirectory(new FakeDirectoryHandle(".lattice"));
    const oldItems = oldLattice.addDirectory(new FakeDirectoryHandle("items"));
    const oldItem = oldItems.addDirectory(new FakeDirectoryHandle("stable-item"));
    oldItem.addFile(new FakeFileHandle("manifest.json", JSON.stringify({
      version: 4,
      itemId: "stable-doc-id",
      pdfPath: "old-workspace/paper.pdf",
      itemFolderPath: ".lattice/items/stable-item",
      annotationIndexPath: null,
      fileFingerprint: "stored-fingerprint",
      versionFingerprint: "stored-version",
      knownPdfPaths: ["old-workspace/paper.pdf"],
      createdAt: 1,
      updatedAt: 1,
    })));
    oldItem.addFile(new FakeFileHandle("Reading Note.md", "# Reading Note"));

    const newRoot = new FakeDirectoryHandle("new-workspace");
    const movedPdf = newRoot.addFile(new FakeFileHandle("paper.pdf", "%PDF-moved"));
    pdfItemLocationMocks.resolvePdfItemLocation.mockResolvedValue({
      documentId: "stable-doc-id",
      fileFingerprint: "stored-fingerprint",
      workspaceKey: "web:old-workspace",
      desktopRootPath: null,
      pdfPath: "old-workspace/paper.pdf",
      itemFolderPath: ".lattice/items/stable-item",
      updatedAt: 1,
    });
    pdfItemLocationMocks.resolvePdfItemLocationRoot.mockResolvedValueOnce(null);

    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: newRoot as unknown as FileSystemDirectoryHandle,
      workspaceRootHandle: newRoot as unknown as FileSystemDirectoryHandle,
      workspaceRootPath: "new-workspace",
      workspaceRootHistory: new Map([
        ["new-workspace", newRoot as unknown as FileSystemDirectoryHandle],
      ]),
      fileTree: {
        root: {
          name: "new-workspace",
          kind: "directory",
          handle: newRoot as unknown as FileSystemDirectoryHandle,
          path: "new-workspace",
          isExpanded: true,
          children: [{
            name: "paper.pdf",
            kind: "file",
            handle: movedPdf as unknown as FileSystemFileHandle,
            extension: "pdf",
            path: "new-workspace/paper.pdf",
            canExpandVirtualChildren: true,
            virtualChildrenState: "idle",
          }],
        },
      },
    }));

    const { result } = renderHook(() => useFileSystem());
    await act(async () => {
      await result.current.hydratePdfVirtualChildren("new-workspace/paper.pdf", { expand: true });
    });

    expect(pdfItemLocationMocks.resolvePdfItemLocation).toHaveBeenCalledWith(
      expect.objectContaining({ fileFingerprint: expect.any(String) }),
    );
    expect(pdfItemLocationMocks.resolvePdfItemLocationRoot).toHaveBeenCalled();
    const unavailablePdf = useWorkspaceStore.getState().fileTree.root?.children[0];
    expect(unavailablePdf?.kind === "file" ? unavailablePdf.virtualChildrenState : null)
      .toBe("unavailable");

    pdfItemLocationMocks.resolvePdfItemLocationRoot.mockResolvedValue(oldRoot);
    await act(async () => {
      await result.current.hydratePdfVirtualChildren("new-workspace/paper.pdf", { force: true, expand: true });
    });

    const hydratedPdf = useWorkspaceStore.getState().fileTree.root?.children[0];
    expect(hydratedPdf?.kind === "file" ? hydratedPdf.children?.map((child) => child.name) : [])
      .toContain("Reading Note.md");
  });
});

describe("useFileSystem incremental Explorer updates", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: null,
      workspaceRootHandle: null,
      workspaceRootPath: null,
      fileTree: { root: null },
      isLoading: false,
      error: null,
    }));
    delete (window as Window & { __TAURI__?: unknown }).__TAURI__;
  });

  function mountWorkspace(root: FakeDirectoryHandle, children: NonNullable<ReturnType<typeof useWorkspaceStore.getState>["fileTree"]["root"]>["children"]) {
    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: root as unknown as FileSystemDirectoryHandle,
      workspaceRootHandle: null,
      workspaceRootPath: root.name,
      fileTree: {
        root: {
          name: root.name,
          kind: "directory",
          handle: root as unknown as FileSystemDirectoryHandle,
          path: root.name,
          isExpanded: true,
          children,
        },
      },
    }));
  }

  function directoryNode(
    handle: FakeDirectoryHandle,
    path: string,
    children: TreeNode[] = [],
  ): DirectoryNode {
    return {
      name: handle.name,
      kind: "directory",
      handle: handle as unknown as FileSystemDirectoryHandle,
      children,
      path,
      isExpanded: true,
    };
  }

  it("deduplicates concurrent lazy directory expansion", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const docs = root.addDirectory(new FakeDirectoryHandle("docs"));
    docs.addFile(new FakeFileHandle("deep.md"));
    mountWorkspace(root, [{
      name: "docs",
      kind: "directory",
      handle: docs as unknown as FileSystemDirectoryHandle,
      children: [],
      path: "workspace/docs",
      isExpanded: false,
      childrenState: "idle",
    }]);
    const { result } = renderHook(() => useFileSystem());
    const otherConsumer = renderHook(() => useFileSystem());

    await act(async () => {
      await Promise.all([
        result.current.ensureDirectoryExpanded("workspace/docs"),
        otherConsumer.result.current.ensureDirectoryExpanded("workspace/docs"),
      ]);
    });

    expect(docs.valuesCallCount).toBe(1);
    const expanded = useWorkspaceStore.getState().fileTree.root?.children[0];
    expect(expanded?.kind === "directory" ? expanded.childrenState : null).toBe("ready");
    expect(expanded?.kind === "directory" ? expanded.children.map((node) => node.name) : []).toEqual(["deep.md"]);
  });

  it("keeps a directory collapsed when its pending children finish loading", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const docs = root.addDirectory(new FakeDirectoryHandle("docs"));
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const read = docs.values.bind(docs);
    docs.values = async function* () { await blocked; yield* read(); };
    mountWorkspace(root, [{
      name: "docs", kind: "directory", handle: docs as unknown as FileSystemDirectoryHandle,
      children: [], path: "workspace/docs", isExpanded: false, childrenState: "idle",
    }]);
    const { result } = renderHook(() => useFileSystem());
    let pending!: Promise<void>;
    act(() => { pending = result.current.ensureDirectoryExpanded("workspace/docs"); });
    act(() => useWorkspaceStore.getState().toggleDirectory("workspace/docs"));
    await act(async () => { release(); await pending; });
    const directory = useWorkspaceStore.getState().fileTree.root?.children[0];
    expect(directory?.kind === "directory" && directory.isExpanded).toBe(false);
    expect(directory?.kind === "directory" && directory.childrenState).toBe("ready");
  });

  it("creates a file and updates the parent without rescanning the root", async () => {
    const root = new FakeDirectoryHandle("workspace");
    mountWorkspace(root, []);
    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      const operation = await result.current.createFile("notes.md", "file", "workspace");
      expect(operation.success).toBe(true);
    });

    expect(root.valuesCallCount).toBe(0);
    expect(useWorkspaceStore.getState().fileTree.root?.children.map((node) => node.name)).toEqual(["notes.md"]);
  });

  it("creates an empty folder and shows it without rescanning the root", async () => {
    const root = new FakeDirectoryHandle("workspace");
    mountWorkspace(root, []);
    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      const operation = await result.current.createDirectory("New Folder", "workspace");
      expect(operation.success).toBe(true);
    });

    expect(root.valuesCallCount).toBe(0);
    expect(useWorkspaceStore.getState().fileTree.root?.children.map((node) => node.name)).toEqual(["New Folder"]);
  });

  it("deletes a file without rescanning the root", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const notes = root.addFile(new FakeFileHandle("notes.md"));
    mountWorkspace(root, [{
      name: notes.name,
      kind: "file",
      handle: notes as unknown as FileSystemFileHandle,
      extension: "md",
      path: "workspace/notes.md",
    }]);
    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      const operation = await result.current.deleteFile("workspace/notes.md");
      expect(operation.success).toBe(true);
    });

    expect(root.valuesCallCount).toBe(0);
    expect(useWorkspaceStore.getState().fileTree.root?.children).toEqual([]);
  });

  it("moves a file between folders without rescanning the root", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const archive = root.addDirectory(new FakeDirectoryHandle("archive"));
    const notes = root.addFile(new FakeFileHandle("notes.md", "content"));
    mountWorkspace(root, [
      {
        name: "archive",
        kind: "directory",
        handle: archive as unknown as FileSystemDirectoryHandle,
        children: [],
        path: "workspace/archive",
        isExpanded: true,
      },
      {
        name: notes.name,
        kind: "file",
        handle: notes as unknown as FileSystemFileHandle,
        extension: "md",
        path: "workspace/notes.md",
      },
    ]);
    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      const operation = await result.current.moveEntry("workspace/notes.md", "workspace/archive");
      expect(operation.success).toBe(true);
    });

    expect(root.valuesCallCount).toBe(0);
    const currentRoot = useWorkspaceStore.getState().fileTree.root;
    expect(currentRoot?.children.map((node) => node.name)).toEqual(["archive"]);
    expect(currentRoot?.children[0]?.kind === "directory" ? currentRoot.children[0].children.map((node) => node.name) : []).toEqual(["notes.md"]);
  });

  it("renames a file without rescanning the root", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const notes = root.addFile(new FakeFileHandle("notes.md", "content"));
    mountWorkspace(root, [{
      name: notes.name,
      kind: "file",
      handle: notes as unknown as FileSystemFileHandle,
      extension: "md",
      path: "workspace/notes.md",
    }]);
    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      const operation = await result.current.renameFile("workspace/notes.md", "research.md");
      expect(operation.success).toBe(true);
    });

    expect(root.valuesCallCount).toBe(0);
    expect(useWorkspaceStore.getState().fileTree.root?.children.map((node) => `${node.name}:${node.path}`)).toEqual([
      "research.md:workspace/research.md",
    ]);
  });

  it("rewrites PDF sidecar paths from the workspace root when a nested folder is open", async () => {
    const workspace = new FakeDirectoryHandle("Course");
    const nested = workspace.addDirectory(new FakeDirectoryHandle("Reading"));
    const paper = nested.addFile(new FakeFileHandle("paper.pdf", "%PDF-stable"));
    const lattice = workspace.addDirectory(new FakeDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new FakeDirectoryHandle("items"));
    const item = items.addDirectory(new FakeDirectoryHandle("stable-item"));
    item.addFile(new FakeFileHandle("manifest.json", JSON.stringify({
      version: 4,
      itemId: "stable-doc-id",
      pdfPath: "Course/Reading/paper.pdf",
      itemFolderPath: ".lattice/items/stable-item",
      annotationIndexPath: null,
      fileFingerprint: null,
      versionFingerprint: null,
      knownPdfPaths: ["Course/Reading/paper.pdf"],
      createdAt: 1,
      updatedAt: 1,
    })));
    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: nested as unknown as FileSystemDirectoryHandle,
      workspaceRootHandle: workspace as unknown as FileSystemDirectoryHandle,
      workspaceRootPath: "Course/Reading",
      workspaceRootHistory: new Map([["Course", workspace as unknown as FileSystemDirectoryHandle]]),
      fileTree: {
        root: {
          name: "Reading",
          kind: "directory",
          handle: nested as unknown as FileSystemDirectoryHandle,
          path: "Reading",
          isExpanded: true,
          children: [{
            name: paper.name,
            kind: "file",
            handle: paper as unknown as FileSystemFileHandle,
            extension: "pdf",
            path: "Reading/paper.pdf",
          }],
        },
      },
    }));
    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      const operation = await result.current.renameFile("Reading/paper.pdf", "renamed.pdf");
      expect(operation.success).toBe(true);
    });

    const manifest = await (await workspace.getDirectoryHandle(".lattice")).getDirectoryHandle("items");
    const stableItem = await manifest.getDirectoryHandle("stable-item");
    const saved = JSON.parse(await (await stableItem.getFileHandle("manifest.json")).getFile().then((file) => file.text()));
    expect(saved.itemId).toBe("stable-doc-id");
    expect(saved.knownPdfPaths).toContain("Course/Reading/renamed.pdf");
    await expect(nested.getFileHandle("renamed.pdf")).resolves.toBeTruthy();
  });

  it("copies a file without rescanning the root or removing the source", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const archive = root.addDirectory(new FakeDirectoryHandle("archive"));
    const notes = root.addFile(new FakeFileHandle("notes.md", "content"));
    mountWorkspace(root, [
      {
        name: "archive",
        kind: "directory",
        handle: archive as unknown as FileSystemDirectoryHandle,
        children: [],
        path: "workspace/archive",
        isExpanded: true,
      },
      {
        name: notes.name,
        kind: "file",
        handle: notes as unknown as FileSystemFileHandle,
        extension: "md",
        path: "workspace/notes.md",
      },
    ]);
    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      const operation = await result.current.copyEntry("workspace/notes.md", "workspace/archive");
      expect(operation.success).toBe(true);
    });

    expect(root.valuesCallCount).toBe(0);
    const currentRoot = useWorkspaceStore.getState().fileTree.root;
    expect(currentRoot?.children.map((node) => node.name)).toEqual(["archive", "notes.md"]);
    expect(currentRoot?.children[0]?.kind === "directory" ? currentRoot.children[0].children.map((node) => node.name) : []).toEqual(["notes.md"]);
  });

  it("rebuilds copied directory descendants with handles from the target directory", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const archive = root.addDirectory(new FakeDirectoryHandle("archive"));
    const assets = root.addDirectory(new FakeDirectoryHandle("assets"));
    const sourceFile = assets.addFile(new FakeFileHandle("script.py", "print('source')"));
    mountWorkspace(root, [
      directoryNode(archive, "workspace/archive"),
      directoryNode(assets, "workspace/assets", [{
        name: sourceFile.name,
        kind: "file",
        handle: sourceFile as unknown as FileSystemFileHandle,
        extension: "py",
        path: "workspace/assets/script.py",
      }]),
    ]);
    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      const operation = await result.current.copyEntry("workspace/assets", "workspace/archive");
      expect(operation.success).toBe(true);
    });

    expect(root.valuesCallCount).toBe(0);
    const archiveNode = useWorkspaceStore.getState().fileTree.root?.children.find((node) => node.path === "workspace/archive");
    const copiedDirectory = archiveNode?.kind === "directory" ? archiveNode.children[0] : null;
    const copiedFile = copiedDirectory?.kind === "directory" ? copiedDirectory.children[0] : null;
    expect(copiedFile?.path).toBe("workspace/archive/assets/script.py");
    expect(copiedFile?.handle).not.toBe(sourceFile);
  });

  it("rebuilds moved directory descendants with handles from the target directory", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const archive = root.addDirectory(new FakeDirectoryHandle("archive"));
    const assets = root.addDirectory(new FakeDirectoryHandle("assets"));
    const sourceFile = assets.addFile(new FakeFileHandle("script.py", "print('source')"));
    mountWorkspace(root, [
      directoryNode(archive, "workspace/archive"),
      directoryNode(assets, "workspace/assets", [{
        name: sourceFile.name,
        kind: "file",
        handle: sourceFile as unknown as FileSystemFileHandle,
        extension: "py",
        path: "workspace/assets/script.py",
      }]),
    ]);
    const { result } = renderHook(() => useFileSystem());

    await act(async () => {
      const operation = await result.current.moveEntry("workspace/assets", "workspace/archive");
      expect(operation.success).toBe(true);
    });

    expect(root.valuesCallCount).toBe(0);
    const archiveNode = useWorkspaceStore.getState().fileTree.root?.children.find((node) => node.path === "workspace/archive");
    const movedDirectory = archiveNode?.kind === "directory" ? archiveNode.children[0] : null;
    const movedFile = movedDirectory?.kind === "directory" ? movedDirectory.children[0] : null;
    expect(movedFile?.path).toBe("workspace/archive/assets/script.py");
    expect(movedFile?.handle).not.toBe(sourceFile);
  });

  it("moves a file into a PDF item workspace and hydrates the PDF children", async () => {
    const root = new FakeDirectoryHandle("workspace");
    const notes = root.addFile(new FakeFileHandle("notes.md", "research note"));
    const paper = root.addFile(new FakeFileHandle("paper.pdf", "%PDF-test"));
    mountWorkspace(root, [
      {
        name: notes.name,
        kind: "file",
        handle: notes as unknown as FileSystemFileHandle,
        extension: "md",
        path: "workspace/notes.md",
      },
      {
        name: paper.name,
        kind: "file",
        handle: paper as unknown as FileSystemFileHandle,
        extension: "pdf",
        path: "workspace/paper.pdf",
        canExpandVirtualChildren: true,
        virtualChildrenState: "idle",
        isExpanded: false,
      },
    ]);
    useWorkspaceStore.setState({
      workspaceRootHandle: root as unknown as FileSystemDirectoryHandle,
    });
    const { result } = renderHook(() => useFileSystem());

    let movedPath = "";
    await act(async () => {
      const operation = await result.current.moveEntryIntoPdfItemWorkspace(
        "workspace/notes.md",
        "workspace/paper.pdf",
      );
      expect(operation.success).toBe(true);
      movedPath = operation.path ?? "";
    });

    expect(movedPath).toMatch(/^\.lattice\/items\/.+\/notes\.md$/);
    expect(root.valuesCallCount).toBe(0);
    const currentRoot = useWorkspaceStore.getState().fileTree.root;
    expect(currentRoot?.children.map((node) => node.name)).toEqual(["paper.pdf"]);
    const pdfNode = currentRoot?.children[0];
    expect(pdfNode?.kind).toBe("file");
    expect(pdfNode?.kind === "file" ? pdfNode.children?.map((node) => node.name) : []).toContain("notes.md");
    const movedNote = pdfNode?.kind === "file" ? pdfNode.children?.find((node) => node.name === "notes.md") : null;
    expect(movedNote?.handle).not.toBe(notes);
  });
});

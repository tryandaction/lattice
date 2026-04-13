/**
 * @vitest-environment jsdom
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readDirectoryRecursive, useFileSystem } from "@/hooks/use-file-system";
import { useSettingsStore } from "@/stores/settings-store";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { isFileNode } from "@/types/file-system";

class FakeFileHandle {
  kind = "file" as const;

  constructor(public name: string, private readonly content = "") {}

  async getFile() {
    return {
      text: async () => this.content,
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

  async isSameEntry(other: FileSystemHandle) {
    return other === (this as unknown as FileSystemHandle);
  }
}

describe("readDirectoryRecursive", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState((state) => ({
      ...state,
      settings: {
        ...state.settings,
        lastOpenedFolder: null,
      },
    }));
    useWorkspaceStore.setState((state) => ({
      ...state,
      rootHandle: null,
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
});

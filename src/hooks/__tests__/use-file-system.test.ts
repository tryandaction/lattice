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

  it("projects pdf item companion files under the pdf node and hides the raw hidden companion directory", async () => {
    const root = new FakeDirectoryHandle("workspace");
    root.addFile(new FakeFileHandle("paper.pdf"));
    root.addFile(new FakeFileHandle("notes.md"));

    const itemDir = root.addDirectory(new FakeDirectoryHandle(".paper.lattice"));
    itemDir.addFile(new FakeFileHandle("manifest.json", JSON.stringify({
      version: 2,
      itemId: "workspace-paper.pdf",
      pdfPath: "workspace/paper.pdf",
      itemFolderPath: "workspace/.paper.lattice",
      annotationIndexPath: "workspace/.paper.lattice/_annotations.md",
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
    })));
    itemDir.addFile(new FakeFileHandle("Reading Note.md"));
    itemDir.addFile(new FakeFileHandle("Lab Notebook.ipynb"));
    itemDir.addFile(new FakeFileHandle("_annotations.md"));

    const nodes = await readDirectoryRecursive(root as unknown as FileSystemDirectoryHandle);
    const pdfNode = nodes.find((node) => isFileNode(node) && node.name === "paper.pdf");
    const hiddenItemDir = nodes.find((node) => !isFileNode(node) && node.name === ".paper.lattice");

    expect(hiddenItemDir).toBeUndefined();
    expect(pdfNode && isFileNode(pdfNode)).toBe(true);
    expect(pdfNode?.children?.map((child) => child.name)).toEqual([
      "Reading Note.md",
      "Lab Notebook.ipynb",
      "_annotations.md",
    ]);
    expect(pdfNode?.children?.map((child) => isFileNode(child) ? child.entryRole : null)).toEqual([
      "pdf-note",
      "pdf-notebook",
      "pdf-annotations",
    ]);
  });

  it("opens a desktop workspace in Tauri mode and rebuilds the file tree", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command === "plugin:dialog|open") {
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
});

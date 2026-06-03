import { describe, expect, it, vi } from "vitest";
import { findParentDirectory, moveEntryToDirectory, renameFile } from "@/lib/file-operations";

describe("file-operations renameFile", () => {
  it("同名重命名应直接成功，不应报已存在", async () => {
    const fileHandle = {
      kind: "file",
      name: "notes.md",
    } as FileSystemFileHandle;

    const dirHandle = {
      name: "workspace",
      getFileHandle: vi.fn(async (name: string) => {
        if (name === "notes.md") {
          return fileHandle;
        }
        throw new Error("not found");
      }),
      removeEntry: vi.fn(),
    } as unknown as FileSystemDirectoryHandle;

    const result = await renameFile(dirHandle, "notes.md", "notes.md");

    expect(result.success).toBe(true);
    expect(result.handle).toBe(fileHandle);
    expect(result.path).toBe("workspace/notes.md");
    expect(dirHandle.removeEntry).not.toHaveBeenCalled();
  });
});

describe("file-operations findParentDirectory", () => {
  it("resolves root-relative lattice paths without requiring the workspace root prefix", async () => {
    const itemsHandle = {
      name: "items",
      getDirectoryHandle: vi.fn(async (name: string) => {
        if (name === "paper.pdf") {
          return { name: "paper.pdf" } as FileSystemDirectoryHandle;
        }
        throw new Error("not found");
      }),
    } as unknown as FileSystemDirectoryHandle;

    const latticeHandle = {
      name: ".lattice",
      getDirectoryHandle: vi.fn(async (name: string) => {
        if (name === "items") {
          return itemsHandle;
        }
        throw new Error("not found");
      }),
    } as unknown as FileSystemDirectoryHandle;

    const rootHandle = {
      name: "workspace",
      getDirectoryHandle: vi.fn(async (name: string) => {
        if (name === ".lattice") {
          return latticeHandle;
        }
        throw new Error("not found");
      }),
    } as unknown as FileSystemDirectoryHandle;

    const parent = await findParentDirectory(rootHandle, ".lattice/items/paper.pdf/_annotations.md");

    expect(parent).toBeTruthy();
    expect((parent as FileSystemDirectoryHandle).name).toBe("paper.pdf");
  });
});

describe("file-operations moveEntryToDirectory", () => {
  it("preserves the original name when moving into a directory without conflicts", async () => {
    const sourceFile = {
      kind: "file",
      name: "notes.md",
      getFile: vi.fn(async () => new Blob(["hello"])),
    } as unknown as FileSystemFileHandle;

    const sourceParent = {
      name: "workspace",
      removeEntry: vi.fn(),
    } as unknown as FileSystemDirectoryHandle;

    const writable = {
      write: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const targetHandle = {
      kind: "file",
      name: "notes.md",
      createWritable: vi.fn(async () => writable),
    } as unknown as FileSystemFileHandle;

    const targetDirectory = {
      name: "docs",
      getFileHandle: vi.fn(async (name: string, options?: { create?: boolean }) => {
        if (name === "notes.md" && options?.create) {
          return targetHandle;
        }
        throw new Error("not found");
      }),
    } as unknown as FileSystemDirectoryHandle;

    const result = await moveEntryToDirectory(sourceParent, sourceFile, targetDirectory);

    expect(result.success).toBe(true);
    expect(result.path).toBe("docs/notes.md");
    expect(targetDirectory.getFileHandle).toHaveBeenCalledWith("notes.md", { create: true });
    expect(sourceParent.removeEntry).toHaveBeenCalledWith("notes.md", undefined);
  });
});

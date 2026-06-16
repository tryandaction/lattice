import { describe, expect, it, vi } from "vitest";
import { saveImageCopyToWorkspace } from "@/lib/image-editor";

const { emitVaultChange } = vi.hoisted(() => ({
  emitVaultChange: vi.fn(),
}));

vi.mock("@/lib/plugins/runtime", () => ({
  emitVaultChange: (path: string) => emitVaultChange(path),
}));

class MockFileHandle {
  readonly kind = "file";
  content: Blob | null = null;

  constructor(readonly name: string) {}

  async createWritable() {
    return {
      write: vi.fn(async (blob: Blob) => {
        this.content = blob;
      }),
      close: vi.fn(async () => {}),
    };
  }
}

class MockDirectoryHandle {
  readonly kind = "directory";
  private readonly files = new Map<string, MockFileHandle>();
  private readonly directories = new Map<string, MockDirectoryHandle>();

  constructor(readonly name: string) {}

  addDirectory(name: string): MockDirectoryHandle {
    const directory = new MockDirectoryHandle(name);
    this.directories.set(name, directory);
    return directory;
  }

  addFile(name: string): MockFileHandle {
    const file = new MockFileHandle(name);
    this.files.set(name, file);
    return file;
  }

  async getDirectoryHandle(name: string): Promise<MockDirectoryHandle> {
    const directory = this.directories.get(name);
    if (!directory) {
      throw new Error("Directory not found");
    }
    return directory;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileHandle> {
    const existing = this.files.get(name);
    if (existing) {
      return existing;
    }
    if (options?.create) {
      return this.addFile(name);
    }
    throw new Error("File not found");
  }
}

describe("image-editor workspace export", () => {
  it("saves an edited image copy next to the source using a unique filename", async () => {
    const root = new MockDirectoryHandle("workspace");
    const figures = root.addDirectory("figures");
    figures.addFile("sample.png");
    figures.addFile("sample-edited.png");

    const result = await saveImageCopyToWorkspace({
      rootHandle: root as unknown as FileSystemDirectoryHandle,
      sourceFilePath: "figures/sample.png",
      defaultFileName: "sample-edited.png",
      blob: new Blob(["edited"], { type: "image/png" }),
    });

    expect(result).toEqual({
      fileName: "sample-edited-1.png",
      filePath: "figures/sample-edited-1.png",
    });
    await expect(figures.getFileHandle("sample-edited-1.png")).resolves.toMatchObject({
      content: expect.any(Blob),
    });
    expect(emitVaultChange).toHaveBeenCalledWith("figures/sample-edited-1.png");
  });

  it("falls back to the workspace root when the source parent cannot be resolved", async () => {
    const root = new MockDirectoryHandle("workspace");

    const result = await saveImageCopyToWorkspace({
      rootHandle: root as unknown as FileSystemDirectoryHandle,
      sourceFilePath: "missing/sample.png",
      defaultFileName: "sample-edited.png",
      blob: new Blob(["edited"], { type: "image/png" }),
    });

    expect(result).toEqual({
      fileName: "sample-edited.png",
      filePath: "sample-edited.png",
    });
    await expect(root.getFileHandle("sample-edited.png")).resolves.toMatchObject({
      content: expect.any(Blob),
    });
    expect(emitVaultChange).toHaveBeenCalledWith("sample-edited.png");
  });
});

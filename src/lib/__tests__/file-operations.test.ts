import { describe, expect, it, vi } from "vitest";
import { renameFile } from "@/lib/file-operations";

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


/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from "vitest";
import { readDirectoryRecursive } from "@/hooks/use-file-system";
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
  it("projects pdf item companion files under the pdf node and hides the raw .item directory", async () => {
    const root = new FakeDirectoryHandle("workspace");
    root.addFile(new FakeFileHandle("paper.pdf"));
    root.addFile(new FakeFileHandle("notes.md"));

    const itemDir = root.addDirectory(new FakeDirectoryHandle("paper.item"));
    itemDir.addFile(new FakeFileHandle("Reading Note.md"));
    itemDir.addFile(new FakeFileHandle("Lab Notebook.ipynb"));
    itemDir.addFile(new FakeFileHandle("_annotations.md"));

    const nodes = await readDirectoryRecursive(root as unknown as FileSystemDirectoryHandle);
    const pdfNode = nodes.find((node) => isFileNode(node) && node.name === "paper.pdf");
    const hiddenItemDir = nodes.find((node) => !isFileNode(node) && node.name === "paper.item");

    expect(hiddenItemDir).toBeUndefined();
    expect(pdfNode && isFileNode(pdfNode)).toBe(true);
    expect(pdfNode?.children?.map((child) => child.name)).toEqual([
      "_annotations.md",
      "Reading Note.md",
      "Lab Notebook.ipynb",
    ]);
    expect(pdfNode?.children?.map((child) => isFileNode(child) ? child.entryRole : null)).toEqual([
      "pdf-annotations",
      "pdf-note",
      "pdf-notebook",
    ]);
  });
});

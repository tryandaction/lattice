import { describe, expect, it } from "vitest";
import type { AnnotationItem } from "@/types/universal-annotation";
import {
  buildPdfAnnotationsMarkdown,
  getPdfItemManifestIndex,
  getDefaultPdfItemFolderPath,
  invalidatePdfItemManifestIndex,
  loadPdfItemManifest,
  syncPdfManagedFiles,
} from "@/lib/pdf-item";

class TestFileHandle {
  kind = "file" as const;

  constructor(public name: string, private content: string) {}

  async getFile() {
    return new File([this.content], this.name);
  }

  async createWritable() {
    return {
      write: async (nextContent: string) => {
        this.content = typeof nextContent === "string" ? nextContent : this.content;
      },
      close: async () => undefined,
    } as unknown as FileSystemWritableFileStream;
  }
}

class TestDirectoryHandle {
  kind = "directory" as const;
  private readonly directories = new Map<string, TestDirectoryHandle>();
  private readonly files = new Map<string, TestFileHandle>();

  constructor(public name: string) {}

  addDirectory(dir: TestDirectoryHandle) {
    this.directories.set(dir.name, dir);
    return dir;
  }

  addFile(file: TestFileHandle) {
    this.files.set(file.name, file);
    return file;
  }

  async *values(): AsyncGenerator<TestDirectoryHandle | TestFileHandle> {
    for (const dir of this.directories.values()) {
      yield dir;
    }
    for (const file of this.files.values()) {
      yield file;
    }
  }

  async getDirectoryHandle(name: string) {
    const dir = this.directories.get(name);
    if (!dir) {
      throw new DOMException("Directory not found", "NotFoundError");
    }
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    const file = this.files.get(name);
    if (file) {
      return file;
    }
    if (options?.create) {
      const created = new TestFileHandle(name, "");
      this.files.set(name, created);
      return created;
    }
    throw new DOMException("File not found", "NotFoundError");
  }
}

describe("pdf-item utils", () => {
  it("derives a root-level lattice item folder for the pdf workspace", () => {
    expect(getDefaultPdfItemFolderPath("papers/rydberg-review.pdf")).toBe(".lattice/items/papers-rydberg-review.pdf");
    expect(getDefaultPdfItemFolderPath("rydberg review.pdf")).toBe(".lattice/items/rydberg_review.pdf");
  });

  it("builds markdown output for pdf annotations", () => {
    const annotations: AnnotationItem[] = [
      {
        id: "ann-1",
        target: {
          type: "pdf",
          page: 2,
          rects: [{ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.25 }],
        },
        style: {
          color: "#ffeb3b",
          type: "highlight",
        },
        content: "Rydberg blockade requires strong interaction.",
        comment: "Move this into the reading note.",
        author: "user",
        createdAt: 1710000000000,
      },
      {
        id: "ann-2",
        target: {
          type: "pdf",
          page: 4,
          rects: [{ x1: 0.2, y1: 0.3, x2: 0.4, y2: 0.35 }],
        },
        style: {
          color: "#4caf50",
          type: "underline",
        },
        content: "This coupling is dominated by a small subset of states.",
        author: "user",
        createdAt: 1710000005000,
      },
    ];

    const markdown = buildPdfAnnotationsMarkdown({
      fileName: "rydberg-review.pdf",
      manifest: {
        version: 4,
        itemId: "papers-rydberg-review.pdf",
        pdfPath: "papers/rydberg-review.pdf",
        itemFolderPath: ".lattice/items/papers-rydberg-review.pdf",
        annotationIndexPath: ".lattice/items/papers-rydberg-review.pdf/_annotations.md",
        fileFingerprint: null,
        versionFingerprint: null,
        knownPdfPaths: ["papers/rydberg-review.pdf"],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
      },
      annotations,
    });

    expect(markdown).toContain("# rydberg-review.pdf Annotations");
    expect(markdown).toContain("Source PDF: [rydberg-review.pdf](../../../papers/rydberg-review.pdf)");
    expect(markdown).toContain("## Page 2");
    expect(markdown).toContain("## Page 4");
    expect(markdown).toContain("Move this into the reading note.");
    expect(markdown).toContain("../../../papers/rydberg-review.pdf#page=2");
    expect(markdown).toContain("../../../papers/rydberg-review.pdf#annotation=ann-1");
  });

  it("recovers an existing workspace by stable document id after the pdf path changes", async () => {
    const root = new TestDirectoryHandle("workspace");
    const lattice = root.addDirectory(new TestDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new TestDirectoryHandle("items"));
    const itemDir = items.addDirectory(new TestDirectoryHandle("papers-old-paper.pdf"));
    itemDir.addFile(new TestFileHandle("manifest.json", JSON.stringify({
      version: 4,
      itemId: "stable-doc-id",
      pdfPath: "papers/old-paper.pdf",
      itemFolderPath: ".lattice/items/papers-old-paper.pdf",
      annotationIndexPath: ".lattice/items/papers-old-paper.pdf/_annotations.md",
      fileFingerprint: "fingerprint-a",
      versionFingerprint: "version-a",
      knownPdfPaths: ["papers/old-paper.pdf"],
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
    })));

    const manifest = await loadPdfItemManifest(
      root as unknown as FileSystemDirectoryHandle,
      "papers-renamed-paper.pdf",
      "papers/renamed-paper.pdf",
      {
        documentId: "stable-doc-id",
        knownPdfPaths: ["papers/old-paper.pdf", "papers/renamed-paper.pdf"],
        fileFingerprint: "fingerprint-a",
        versionFingerprint: "version-a",
      },
    );

    expect(manifest.itemId).toBe("stable-doc-id");
    expect(manifest.itemFolderPath).toBe(".lattice/items/papers-old-paper.pdf");
    expect(manifest.knownPdfPaths).toContain("papers/renamed-paper.pdf");
  });

  it("strips legacy pdf note frontmatter from managed markdown notes", async () => {
    const root = new TestDirectoryHandle("workspace");
    const lattice = root.addDirectory(new TestDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new TestDirectoryHandle("items"));
    const itemDir = items.addDirectory(new TestDirectoryHandle("papers-paper.pdf"));
    itemDir.addFile(new TestFileHandle("Reading Note.md", [
      "---",
      'type: "pdf-note"',
      'itemId: "stable-doc-id"',
      'pdf: "../paper.pdf"',
      'created: "2026-03-25T03:26:04.249Z"',
      "---",
      "",
    ].join("\n")));

    await syncPdfManagedFiles(root as unknown as FileSystemDirectoryHandle, {
      version: 4,
      itemId: "stable-doc-id",
      pdfPath: "papers/paper.pdf",
      itemFolderPath: ".lattice/items/papers-paper.pdf",
      annotationIndexPath: null,
      fileFingerprint: null,
      versionFingerprint: null,
      knownPdfPaths: ["papers/paper.pdf"],
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
    });

    const cleaned = await itemDir.getFileHandle("Reading Note.md");
    const content = await (await cleaned.getFile()).text();
    expect(content.startsWith("---")).toBe(false);
    expect(content).toContain("# Reading Note");
  });

  it("reuses the cached pdf item manifest index across repeated lookups", async () => {
    const root = new TestDirectoryHandle("workspace");
    const lattice = root.addDirectory(new TestDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new TestDirectoryHandle("items"));
    const firstDir = items.addDirectory(new TestDirectoryHandle("paper-a.pdf"));
    firstDir.addFile(new TestFileHandle("manifest.json", JSON.stringify({
      version: 4,
      itemId: "doc-a",
      pdfPath: "papers/a.pdf",
      itemFolderPath: ".lattice/items/paper-a.pdf",
      annotationIndexPath: null,
      fileFingerprint: null,
      versionFingerprint: null,
      knownPdfPaths: ["papers/a.pdf"],
      createdAt: 1,
      updatedAt: 1,
    })));

    invalidatePdfItemManifestIndex(root as unknown as FileSystemDirectoryHandle);
    const firstIndex = await getPdfItemManifestIndex(root as unknown as FileSystemDirectoryHandle);
    const secondIndex = await getPdfItemManifestIndex(root as unknown as FileSystemDirectoryHandle);

    expect(firstIndex).toBe(secondIndex);
    expect(firstIndex.byDocumentId.get("doc-a")?.pdfPath).toBe("papers/a.pdf");
  });
});

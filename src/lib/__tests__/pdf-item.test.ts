import { describe, expect, it } from "vitest";
import type { AnnotationItem } from "@/types/universal-annotation";
import {
  buildPdfAnnotationsMarkdown,
  getPdfItemManifestIndex,
  getDefaultPdfItemFolderPath,
  invalidatePdfItemManifestIndex,
  loadPdfItemManifest,
  syncPdfAnnotationsMarkdown,
  syncPdfManagedFiles,
} from "@/lib/pdf-item";
import { setLocale } from "@/lib/i18n";

class TestFileHandle {
  kind = "file" as const;
  writeCount = 0;

  constructor(public name: string, private content: string) {}

  async getFile() {
    return new File([this.content], this.name);
  }

  async createWritable() {
    return {
      write: async (nextContent: string | Blob) => {
        this.writeCount += 1;
        if (typeof nextContent === "string") {
          this.content = nextContent;
          return;
        }
        this.content = await nextContent.text();
      },
      close: async () => undefined,
    } as unknown as FileSystemWritableFileStream;
  }

  resetWriteCount() {
    this.writeCount = 0;
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
    setLocale("en-US");
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
      {
        id: "ann-area",
        target: {
          type: "pdf",
          page: 4,
          rects: [{ x1: 0.45, y1: 0.5, x2: 0.75, y2: 0.68 }],
        },
        style: {
          color: "#2ea8e5",
          type: "area",
        },
        preview: {
          type: "image",
          dataUrl: "data:image/png;base64,ZmFrZS1wcmV2aWV3",
          width: 320,
          height: 180,
        },
        author: "user",
        createdAt: 1710000006000,
      },
      {
        id: "ann-ink",
        target: {
          type: "pdf",
          page: 4,
          rects: [{ x1: 0.46, y1: 0.52, x2: 0.58, y2: 0.59 }],
        },
        style: {
          color: "#ff5252",
          type: "ink",
        },
        preview: {
          type: "image",
          dataUrl: "data:image/png;base64,aW5rLXByZXZpZXc=",
          width: 240,
          height: 120,
        },
        author: "user",
        createdAt: 1710000007000,
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
      previewPathByAnnotationId: {
        "ann-area": "./_annotation_previews/ann-area.png",
        "ann-ink": "./_annotation_previews/ann-ink.png",
      },
    });

    expect(markdown).toContain("# rydberg-review.pdf Annotations");
    expect(markdown).toContain("Source PDF: [rydberg-review.pdf](../../../papers/rydberg-review.pdf)");
    expect(markdown).toContain("## Page 2");
    expect(markdown).toContain("## Page 4");
    expect(markdown).toContain("Move this into the reading note.");
    expect(markdown).toContain("../../../papers/rydberg-review.pdf#page=2");
    expect(markdown).toContain("../../../papers/rydberg-review.pdf#annotation=ann-1");
    expect(markdown).toContain("- Screenshot:");
    expect(markdown).toContain("![Area Screenshot ann-area Page 4](./_annotation_previews/ann-area.png)");
    expect(markdown).toContain("![Ink Screenshot ann-ink Page 4](./_annotation_previews/ann-ink.png)");
  });

  it("localizes generated pdf annotation markdown labels", () => {
    setLocale("zh-CN");

    const markdown = buildPdfAnnotationsMarkdown({
      fileName: "论文.pdf",
      manifest: {
        version: 4,
        itemId: "paper",
        pdfPath: "docs/论文.pdf",
        itemFolderPath: ".lattice/items/paper",
        annotationIndexPath: ".lattice/items/paper/_annotations.md",
        fileFingerprint: null,
        versionFingerprint: null,
        knownPdfPaths: ["docs/论文.pdf"],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
      },
      annotations: [],
    });

    expect(markdown).toContain("# 论文.pdf 批注");
    expect(markdown).toContain("源 PDF: [论文.pdf]");
    expect(markdown).toContain("共 0 条批注");
    expect(markdown).toContain("_暂无批注。_");
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

  it("skips rewriting unchanged annotation markdown and preview files", async () => {
    setLocale("en-US");

    const root = new TestDirectoryHandle("workspace");
    const lattice = root.addDirectory(new TestDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new TestDirectoryHandle("items"));
    const itemDir = items.addDirectory(new TestDirectoryHandle("paper"));
    const previewDir = itemDir.addDirectory(new TestDirectoryHandle("_annotation_previews"));
    const previewFile = previewDir.addFile(new TestFileHandle("ann-area.png", "existing-preview"));
    const annotation: AnnotationItem = {
      id: "ann-area",
      target: {
        type: "pdf",
        page: 4,
        rects: [{ x1: 0.45, y1: 0.5, x2: 0.75, y2: 0.68 }],
      },
      style: {
        color: "#2ea8e5",
        type: "area",
      },
      preview: {
        type: "image",
        dataUrl: "data:image/png;base64,bmV3LXByZXZpZXc=",
        width: 320,
        height: 180,
      },
      author: "user",
      createdAt: 1710000006000,
    };
    const manifest = {
      version: 4 as const,
      itemId: "paper",
      pdfPath: "docs/paper.pdf",
      itemFolderPath: ".lattice/items/paper",
      annotationIndexPath: ".lattice/items/paper/_annotations.md",
      fileFingerprint: null,
      versionFingerprint: null,
      knownPdfPaths: ["docs/paper.pdf"],
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
    };
    const markdownFile = itemDir.addFile(new TestFileHandle("_annotations.md", ""));

    await syncPdfAnnotationsMarkdown(
      root as unknown as FileSystemDirectoryHandle,
      manifest,
      "paper.pdf",
      [annotation],
    );
    markdownFile.resetWriteCount();

    await syncPdfAnnotationsMarkdown(
      root as unknown as FileSystemDirectoryHandle,
      manifest,
      "paper.pdf",
      [annotation],
    );

    expect(previewFile.writeCount).toBe(0);
    expect(markdownFile.writeCount).toBe(0);
  });
});

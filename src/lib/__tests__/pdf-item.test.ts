import { describe, expect, it } from "vitest";
import type { AnnotationItem } from "@/types/universal-annotation";
import {
  buildPdfAnnotationsMarkdown,
  copyPdfItemWorkspace,
  ensurePdfItemWorkspace,
  getPdfItemManifestIndex,
  getDefaultPdfItemFolderPath,
  invalidatePdfItemManifestIndex,
  listPdfItemNotes,
  loadPdfItemManifest,
  removeResolvedPdfItemAnnotationMarkdownDrafts,
  syncPdfAnnotationsMarkdown,
  syncPdfManagedFiles,
} from "@/lib/pdf-item";
import {
  PDF_ANNOTATION_DRAFTS_BEGIN,
  PDF_ANNOTATION_DRAFTS_END,
} from "@/lib/pdf-annotation-markdown-drafts";
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

  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    const dir = this.directories.get(name);
    if (!dir && options?.create) {
      const created = new TestDirectoryHandle(name);
      this.directories.set(name, created);
      return created;
    }
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

  async removeEntry(name: string) {
    if (this.files.delete(name) || this.directories.delete(name)) {
      return;
    }
    throw new DOMException("Entry not found", "NotFoundError");
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
    expect(markdown).toContain("#### Screenshot");
    expect(markdown).toContain("![Area Screenshot ann-area Page 4](./_annotation_previews/ann-area.png)");
    expect(markdown).toContain("![Ink Screenshot ann-ink Page 4](./_annotation_previews/ann-ink.png)");
  });

  it("formats pdf annotation markdown as readable renderable sections", () => {
    setLocale("en-US");
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
      annotations: [
        {
          id: "ann-readable",
          target: {
            type: "pdf",
            page: 3,
            rects: [{ x1: 0.1, y1: 0.2, x2: 0.6, y2: 0.28 }],
          },
          style: {
            color: "#ffeb3b",
            type: "highlight",
          },
          content: "First selected line.\nSecond selected line.",
          comment: [
            "This comment keeps **Markdown** syntax.",
            "",
            "- compare with [notebook](../analysis.ipynb)",
            "- preserve `inline code`",
          ].join("\n"),
          author: "user",
          createdAt: 1710000000000,
        },
        {
          id: "ann-area-readable",
          target: {
            type: "pdf",
            page: 3,
            rects: [{ x1: 0.2, y1: 0.4, x2: 0.7, y2: 0.72 }],
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
          createdAt: 1710000001000,
        },
      ],
      previewPathByAnnotationId: {
        "ann-area-readable": "./_annotation_previews/ann-area-readable.png",
      },
    });

    expect(markdown).toContain("#### Quote\n\n> First selected line.\n> Second selected line.");
    expect(markdown).toContain("#### Comment\n\nThis comment keeps **Markdown** syntax.\n\n- compare with [notebook](../analysis.ipynb)\n- preserve `inline code`");
    expect(markdown).not.toContain("- Quote: First selected line.");
    expect(markdown).not.toContain("- Comment: This comment keeps");
    expect(markdown).toContain("#### Screenshot\n\n![Area Screenshot ann-area-readable Page 3](./_annotation_previews/ann-area-readable.png)\n\n_Screenshot: page 3, 320x180px_");
    expect(markdown).not.toContain("- Screenshot:\n  !");
  });

  it("exports pdf annotations with compact jump links and color metadata", () => {
    setLocale("en-US");

    const markdown = buildPdfAnnotationsMarkdown({
      fileName: "paper.pdf",
      manifest: {
        version: 4,
        itemId: "paper",
        pdfPath: "docs/paper.pdf",
        itemFolderPath: ".lattice/items/paper",
        annotationIndexPath: ".lattice/items/paper/_annotations.md",
        fileFingerprint: null,
        versionFingerprint: null,
        knownPdfPaths: ["docs/paper.pdf"],
        createdAt: 1710000000000,
        updatedAt: 1710000000000,
      },
      annotations: [
        {
          id: "ann-blue",
          target: {
            type: "pdf",
            page: 2,
            rects: [{ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.28 }],
          },
          style: {
            color: "#2ea8e5",
            type: "highlight",
          },
          content: "Matched color quote.",
          comment: "A comment with **Markdown**.",
          author: "user",
          createdAt: 1710000000000,
        },
      ],
    });

    expect(markdown).toContain('<!-- lattice-pdf-annotation id="ann-blue" page="2" type="highlight" color="#2ea8e5" -->');
    expect(markdown).toContain('<span class="lattice-pdf-annotation-chip" data-color="#2ea8e5" data-type="highlight">Highlight</span>');
    expect(markdown).toContain('[Page 2](../../../docs/paper.pdf#page=2) | [Open annotation](../../../docs/paper.pdf#annotation=ann-blue)');
    expect(markdown).not.toContain("- Page Link:");
    expect(markdown).not.toContain("- Annotation Link:");
    expect(markdown).toContain("#### Comment\n\nA comment with **Markdown**.");
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

  it("recursively lists folders and arbitrary files in a pdf item workspace", async () => {
    const root = new TestDirectoryHandle("workspace");
    const lattice = root.addDirectory(new TestDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new TestDirectoryHandle("items"));
    const itemDir = items.addDirectory(new TestDirectoryHandle("paper"));
    itemDir.addFile(new TestFileHandle("data.csv", "x,y\n1,2"));
    itemDir.addFile(new TestFileHandle("analysis.py", "print(1)"));
    itemDir.addFile(new TestFileHandle("_annotations.md", "# annotations"));
    const assets = itemDir.addDirectory(new TestDirectoryHandle("assets"));
    assets.addFile(new TestFileHandle("plot.png", "png"));

    const entries = await listPdfItemNotes(root as unknown as FileSystemDirectoryHandle, {
      version: 4,
      itemId: "paper",
      pdfPath: "docs/paper.pdf",
      itemFolderPath: ".lattice/items/paper",
      annotationIndexPath: ".lattice/items/paper/_annotations.md",
      fileFingerprint: null,
      versionFingerprint: null,
      knownPdfPaths: ["docs/paper.pdf"],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(entries.map((entry) => [entry.type, entry.path])).toEqual([
      ["directory", ".lattice/items/paper/assets"],
      ["file", ".lattice/items/paper/assets/plot.png"],
      ["file", ".lattice/items/paper/analysis.py"],
      ["file", ".lattice/items/paper/data.csv"],
      ["annotation-note", ".lattice/items/paper/_annotations.md"],
    ]);
  });

  it("finds an existing pdf item workspace by fingerprint after an external rename", async () => {
    const root = new TestDirectoryHandle("workspace");
    const lattice = root.addDirectory(new TestDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new TestDirectoryHandle("items"));
    const itemDir = items.addDirectory(new TestDirectoryHandle("papers-old.pdf"));
    itemDir.addFile(new TestFileHandle("manifest.json", JSON.stringify({
      version: 4,
      itemId: "stable-doc-id",
      pdfPath: "papers/old.pdf",
      itemFolderPath: ".lattice/items/papers-old.pdf",
      annotationIndexPath: ".lattice/items/papers-old.pdf/_annotations.md",
      fileFingerprint: "same-content",
      versionFingerprint: "old-version",
      knownPdfPaths: ["papers/old.pdf"],
      createdAt: 1,
      updatedAt: 1,
    })));

    const manifest = await loadPdfItemManifest(
      root as unknown as FileSystemDirectoryHandle,
      "papers-renamed.pdf",
      "papers/renamed.pdf",
      {
        fileFingerprint: "same-content",
        versionFingerprint: "new-version",
      },
    );

    expect(manifest.itemId).toBe("stable-doc-id");
    expect(manifest.itemFolderPath).toBe(".lattice/items/papers-old.pdf");
    expect(manifest.knownPdfPaths).toContain("papers/renamed.pdf");
  });

  it("does not duplicate the item workspace when copying a pdf", async () => {
    const root = new TestDirectoryHandle("workspace");
    const lattice = root.addDirectory(new TestDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new TestDirectoryHandle("items"));
    const itemDir = items.addDirectory(new TestDirectoryHandle("papers-source.pdf"));
    itemDir.addFile(new TestFileHandle("manifest.json", JSON.stringify({
      version: 4,
      itemId: "stable-doc-id",
      pdfPath: "papers/source.pdf",
      itemFolderPath: ".lattice/items/papers-source.pdf",
      annotationIndexPath: ".lattice/items/papers-source.pdf/_annotations.md",
      fileFingerprint: "same-content",
      versionFingerprint: "source-version",
      knownPdfPaths: ["papers/source.pdf"],
      createdAt: 1,
      updatedAt: 1,
    })));
    itemDir.addFile(new TestFileHandle("notes.md", "# Notes"));

    const manifest = await copyPdfItemWorkspace(
      root as unknown as FileSystemDirectoryHandle,
      "papers/source.pdf",
      "copies/source.pdf",
    );

    expect(manifest?.itemId).toBe("stable-doc-id");
    expect(manifest?.itemFolderPath).toBe(".lattice/items/papers-source.pdf");
    expect(manifest?.knownPdfPaths).toContain("copies/source.pdf");
    await expect(items.getDirectoryHandle("copies-source.pdf")).rejects.toBeInstanceOf(DOMException);
    await expect(lattice.getDirectoryHandle("annotations")).rejects.toBeInstanceOf(DOMException);
  });

  it("keeps the same item id and moves the workspace when an external rename is repaired", async () => {
    const root = new TestDirectoryHandle("workspace");
    const lattice = root.addDirectory(new TestDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new TestDirectoryHandle("items"));
    const itemDir = items.addDirectory(new TestDirectoryHandle("papers-old.pdf"));
    itemDir.addFile(new TestFileHandle("manifest.json", JSON.stringify({
      version: 4,
      itemId: "stable-doc-id",
      pdfPath: "papers/old.pdf",
      itemFolderPath: ".lattice/items/papers-old.pdf",
      annotationIndexPath: ".lattice/items/papers-old.pdf/_annotations.md",
      fileFingerprint: "same-content",
      versionFingerprint: "old-version",
      knownPdfPaths: ["papers/old.pdf"],
      createdAt: 1,
      updatedAt: 1,
    })));
    itemDir.addFile(new TestFileHandle("notes.md", "# Notes"));

    const repaired = await ensurePdfItemWorkspace(
      root as unknown as FileSystemDirectoryHandle,
      "papers-renamed.pdf",
      "papers/renamed.pdf",
      {
        documentId: null,
        fileFingerprint: "same-content",
        versionFingerprint: "new-version",
      },
    );

    expect(repaired.itemId).toBe("stable-doc-id");
    expect(repaired.itemFolderPath).toBe(".lattice/items/papers-renamed.pdf");
    await expect(items.getDirectoryHandle("papers-old.pdf")).rejects.toBeInstanceOf(DOMException);
    const repairedDir = await items.getDirectoryHandle("papers-renamed.pdf");
    await expect(repairedDir.getFileHandle("notes.md")).resolves.toBeTruthy();
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

  it("does not create annotation sidecar files for untouched PDFs", async () => {
    setLocale("en-US");

    const root = new TestDirectoryHandle("workspace");
    const manifest = {
      version: 4 as const,
      itemId: "paper",
      pdfPath: "docs/paper.pdf",
      itemFolderPath: ".lattice/items/paper",
      annotationIndexPath: null,
      fileFingerprint: null,
      versionFingerprint: null,
      knownPdfPaths: ["docs/paper.pdf"],
      createdAt: 1710000000000,
      updatedAt: 1710000000000,
    };

    const result = await syncPdfAnnotationsMarkdown(
      root as unknown as FileSystemDirectoryHandle,
      manifest,
      "paper.pdf",
      [],
    );

    expect(result.handle).toBeNull();
    expect(result.path).toBeNull();
    expect(result.manifest.annotationIndexPath).toBeNull();
    await expect(root.getDirectoryHandle(".lattice")).rejects.toBeInstanceOf(DOMException);
  });

  it("keeps the PDF annotation draft block before drafts resolve into sidecar annotations", async () => {
    setLocale("en-US");

    const root = new TestDirectoryHandle("workspace");
    const lattice = root.addDirectory(new TestDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new TestDirectoryHandle("items"));
    const itemDir = items.addDirectory(new TestDirectoryHandle("paper"));
    itemDir.addDirectory(new TestDirectoryHandle("_annotation_previews"));
    const markdownFile = itemDir.addFile(new TestFileHandle("_annotations.md", [
      "# previous",
      "",
      PDF_ANNOTATION_DRAFTS_BEGIN,
      '<!-- lattice-pdf-annotation id="ann-ai-draft" page="7" type="highlight" color="#FFD400" -->',
      "- Quote: exact text from PDF",
      "",
      PDF_ANNOTATION_DRAFTS_END,
    ].join("\n")));
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

    const result = await syncPdfAnnotationsMarkdown(
      root as unknown as FileSystemDirectoryHandle,
      manifest,
      "paper.pdf",
      [],
    );

    const nextMarkdown = await markdownFile.getFile().then((file) => file.text());
    expect(result.path).toBe(".lattice/items/paper/_annotations.md");
    expect(nextMarkdown).toContain("_No annotations yet._");
    expect(nextMarkdown).toContain('id="ann-ai-draft"');
    expect(nextMarkdown).toContain("- Quote: exact text from PDF");
  });

  it("clears resolved PDF annotation drafts without removing unresolved drafts", async () => {
    setLocale("en-US");

    const root = new TestDirectoryHandle("workspace");
    const lattice = root.addDirectory(new TestDirectoryHandle(".lattice"));
    const items = lattice.addDirectory(new TestDirectoryHandle("items"));
    const itemDir = items.addDirectory(new TestDirectoryHandle("paper"));
    const markdownFile = itemDir.addFile(new TestFileHandle("_annotations.md", [
      "# annotations",
      "",
      PDF_ANNOTATION_DRAFTS_BEGIN,
      '<!-- lattice-pdf-annotation id="ann-done" page="7" type="highlight" color="#FFD400" -->',
      "- Quote: resolved text",
      "",
      '<!-- lattice-pdf-annotation id="ann-open" page="8" type="underline" color="#2196F3" -->',
      "- Quote: unresolved text",
      "",
      PDF_ANNOTATION_DRAFTS_END,
      "",
    ].join("\n")));
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

    const changed = await removeResolvedPdfItemAnnotationMarkdownDrafts(
      root as unknown as FileSystemDirectoryHandle,
      manifest,
      ["ann-done"],
    );

    const nextMarkdown = await markdownFile.getFile().then((file) => file.text());
    expect(changed).toBe(true);
    expect(nextMarkdown).not.toContain('id="ann-done"');
    expect(nextMarkdown).not.toContain("- Quote: resolved text");
    expect(nextMarkdown).toContain('id="ann-open"');
    expect(nextMarkdown).toContain("- Quote: unresolved text");
  });
});

import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { AnnotationItem } from "@/types/universal-annotation";
import type { EvidenceRef } from "@/lib/ai/types";
import {
  buildMarkdownExportPreview,
  markdownExportInternals,
} from "@/lib/markdown-export";

describe("markdown export", () => {
  const annotations: AnnotationItem[] = [
    {
      id: "ann-pdf",
      target: {
        type: "pdf",
        page: 4,
        rects: [{ x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.2 }],
      },
      style: {
        color: "#FFEB3B",
        type: "highlight",
      },
      content: "Important theorem",
      comment: "Need to compare this proof with the notebook draft.",
      author: "user",
      createdAt: 1_710_000_000_000,
    },
    {
      id: "ann-code",
      target: {
        type: "code_line",
        line: 42,
      },
      style: {
        color: "#2196F3",
        type: "underline",
      },
      content: "return computeEvidenceScore(context);",
      comment: "Potential hot path.",
      author: "user",
      createdAt: 1_710_000_100_000,
    },
  ];

  const evidenceRefs: EvidenceRef[] = [
    {
      kind: "heading",
      label: "Methodology",
      locator: "notes/research.md#methodology",
      preview: "We compare appendix exports with study-note exports.",
    },
  ];

  it("builds appendix preview with source locators", async () => {
    const preview = await buildMarkdownExportPreview(
      "# Title\n\n| A | B |\n| - | - |\n| 1 | 2 |\n",
      {
        format: "docx",
        fileName: "paper.md",
        filePath: "papers/paper.md",
        annotationMode: "appendix",
        includeAnnotations: true,
        visualMode: "document",
        annotations,
        evidenceRefs,
      }
    );

    expect(preview.entryCount).toBe(3);
    expect(preview.html).toContain("Annotation Appendix");
    expect(preview.html).toContain("papers/paper.md#line=42");
    expect(preview.html).toContain("notes/research.md#methodology");
    expect(preview.html).toContain("<table");
  });

  it("normalizes annotations and evidence into unified entries", () => {
    const entries = markdownExportInternals.toExportEntries(
      annotations,
      evidenceRefs,
      "papers/paper.md",
      "paper.md"
    );

    expect(entries).toHaveLength(3);
    expect(entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "annotation",
          locator: "papers/paper.md#page=4",
          title: "PDF 第 4 页",
        }),
        expect.objectContaining({
          locator: "papers/paper.md#line=42",
          title: "代码第 42 行",
        }),
        expect.objectContaining({
          kind: "evidence",
          locator: "notes/research.md#methodology",
        }),
      ])
    );
  });

  it("creates a docx package with HTML altChunk payload", async () => {
    const bytes = await markdownExportInternals.createDocxBytes(
      markdownExportInternals.createHtmlDocument({
        title: "Exported Document",
        bodyHtml: "<main><h1>Export</h1><p>Body</p></main>",
        css: "body { color: black; }",
        entryCount: 0,
        generatedAt: "2026-03-17 16:00",
      })
    );

    const zip = await JSZip.loadAsync(bytes);
    const rels = await zip.file("word/_rels/document.xml.rels")?.async("text");
    const html = await zip.file("word/afchunk/export.html")?.async("text");

    expect(rels).toContain('relationships/aFChunk');
    expect(html).toContain("<main><h1>Export</h1><p>Body</p></main>");
    expect(zip.file("[Content_Types].xml")).toBeTruthy();
  });
});

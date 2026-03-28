import { describe, expect, it } from "vitest";
import type { AnnotationItem } from "@/types/universal-annotation";
import { buildPdfAnnotationsMarkdown, getDefaultPdfItemFolderPath } from "@/lib/pdf-item";

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
        version: 3,
        itemId: "papers-rydberg-review.pdf",
        pdfPath: "papers/rydberg-review.pdf",
        itemFolderPath: ".lattice/items/papers-rydberg-review.pdf",
        annotationIndexPath: ".lattice/items/papers-rydberg-review.pdf/_annotations.md",
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
});

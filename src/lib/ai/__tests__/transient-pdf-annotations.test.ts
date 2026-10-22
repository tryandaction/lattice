import { describe, expect, it } from "vitest";
import { validateAnnotationItem } from "@/types/universal-annotation";
import {
  buildTransientPdfAnnotations,
  confirmTransientPdfAnnotations,
} from "../transient-pdf-annotations";

const evidenceRef = {
  kind: "pdf_page" as const,
  label: "paper.pdf page 3",
  locator: "papers/paper.pdf#page=3",
  preview: "The experiment establishes the central claim.",
  anchor: {
    page: 3,
    rects: [{ left: 0.1, top: 0.2, width: 0.4, height: 0.05 }],
    snippet: "The experiment establishes the central claim.",
  },
};

describe("transient PDF annotations", () => {
  it("strips query and fragment from evidence document paths", () => {
    const [annotation] = buildTransientPdfAnnotations([{
      kind: "pdf_page",
      label: "Paper",
      locator: "./papers//paper.pdf?download=1#page=2",
      anchor: {
        page: 2,
        snippet: "A bounded quote",
        rects: [{ left: 0.1, top: 0.2, width: 0.3, height: 0.04 }],
      },
    }]);

    expect(annotation?.documentPath).toBe("papers/paper.pdf");
  });
  it("builds one transient annotation per unique PDF evidence anchor", () => {
    const annotations = buildTransientPdfAnnotations([evidenceRef, evidenceRef]);

    expect(annotations).toEqual([
      expect.objectContaining({
        documentPath: "papers/paper.pdf",
        page: 3,
        quote: "The experiment establishes the central claim.",
        source: evidenceRef,
      }),
    ]);
    expect(annotations[0].rects).toEqual([{ x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.25 }]);
  });

  it("converts confirmed transient annotations into valid persistent PDF annotations", () => {
    const [transient] = buildTransientPdfAnnotations([evidenceRef]);
    const confirmed = confirmTransientPdfAnnotations([transient], "ai");

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toEqual(expect.objectContaining({
      target: expect.objectContaining({ type: "pdf", page: 3 }),
      content: evidenceRef.preview,
      comment: evidenceRef.label,
      author: "ai",
      tags: ["ai-evidence"],
    }));
    expect(validateAnnotationItem(confirmed[0]).valid).toBe(true);
  });
});

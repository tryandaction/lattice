import { describe, expect, it } from "vitest";
import {
  assertPdfTextMarkupAnnotationCanonical,
  repairPdfTextMarkupAnnotationsInFile,
  upsertCanonicalPdfTextMarkupAnnotationInFile,
} from "@/lib/pdf-annotation-sidecar-canonical";
import type { PdfPageTextModel } from "@/lib/pdf-page-text-cache";
import type { AnnotationItem, UniversalAnnotationFile } from "@/types/universal-annotation";

function createSaffmanFigFiveModel(): PdfPageTextModel {
  const line0 = "of states with equal and opposite Delta E, as can be inferred";
  const line1 = "from Fig. 5, that tend to cause shifts in opposite direc-";
  const line2 = "tions. Even so, the electric field stability required to hold";
  const line3 = "Stark shifts below 1 MHz is typically of order";
  const line4 = "0.01(100/n)7/2 V/cm.";
  const normalizedText = [line0, line1, line2, line3, line4].join(" ");
  const viewportWidth = 640;
  const viewportHeight = 960;
  let offset = 0;
  const segments = [line0, line1, line2, line3, line4].map((line, index) => {
    const start = offset;
    const end = start + line.length;
    offset = end + 1;
    return {
      itemIndex: index,
      text: line,
      normalizedText: line,
      hasEOL: index < 4,
      pageTextStart: start,
      pageTextEnd: end,
      lineIndex: index,
      blockIndex: 0,
      columnIndex: 0,
      layoutClass: "main" as const,
    };
  });

  return {
    pageNumber: 7,
    viewportWidth,
    viewportHeight,
    textContent: { items: [], styles: {}, lang: null },
    items: [],
    normalizedText,
    itemRects: [
      { itemIndex: 0, left: 80, top: 250, width: 430, height: 24 },
      { itemIndex: 1, left: 80, top: 282, width: 420, height: 24 },
      { itemIndex: 2, left: 80, top: 314, width: 430, height: 24 },
      { itemIndex: 3, left: 80, top: 346, width: 360, height: 24 },
      { itemIndex: 4, left: 80, top: 378, width: 170, height: 24 },
    ],
    segments,
  };
}

function createAnnotationFile(annotations: AnnotationItem[]): UniversalAnnotationFile {
  return {
    version: 3,
    documentId: "paper",
    fileId: "paper",
    fileType: "pdf",
    annotations,
    lastModified: 1,
  };
}

describe("pdf-annotation-sidecar-canonical", () => {
  it("repairs a sidecar text markup whose quote and saved rectangles point to different text", () => {
    const model = createSaffmanFigFiveModel();
    const exact = "Fig. 5, that tend to cause shifts in opposite direc-";
    const staleAnnotation: AnnotationItem = {
      id: "ann-stale-sidecar",
      target: {
        type: "pdf",
        page: 7,
        rects: [
          { x1: 80 / 640, y1: 250 / 960, x2: 510 / 640, y2: 274 / 960 },
          { x1: 80 / 640, y1: 282 / 960, x2: 500 / 640, y2: 306 / 960 },
        ],
        textQuote: {
          exact,
          prefix: "of states with equal and opposite Delta E, as can be inferred from ",
          suffix: "tions. Even so",
          source: "pdfjs-text-model",
          confidence: "exact",
        },
        startCharIndex: model.normalizedText.indexOf("of states"),
        endCharIndex: model.normalizedText.indexOf(exact) + exact.length,
        quads: [
          {
            x1: 80 / 640,
            y1: 250 / 960,
            x2: 510 / 640,
            y2: 250 / 960,
            x3: 510 / 640,
            y3: 274 / 960,
            x4: 80 / 640,
            y4: 274 / 960,
          },
        ],
        textSource: "pdfjs-text-model",
        textConfidence: 1,
      },
      style: { color: "#FFD400", type: "highlight" },
      content: exact,
      author: "user",
      createdAt: 1,
    };

    const result = repairPdfTextMarkupAnnotationsInFile({
      annotationFile: createAnnotationFile([staleAnnotation]),
      modelsByPage: new Map([[7, model]]),
      now: 2,
    });

    expect(result.changed).toBe(true);
    expect(result.repairedCount).toBe(1);
    const repaired = result.annotationFile.annotations[0];
    expect(repaired.content).toBe(exact);
    expect(repaired.target.type).toBe("pdf");
    if (repaired.target.type === "pdf") {
      expect(repaired.target.startCharIndex).toBe(model.normalizedText.indexOf(exact));
      expect(repaired.target.rects).toHaveLength(1);
      expect(repaired.target.rects[0].y1).toBeCloseTo(282 / 960);
      expect(repaired.target.rects[0].x1).toBeGreaterThan(80 / 640);
      expect(repaired.target.rects[0].x2).toBeCloseTo(500 / 640);
      expect(repaired.target.quads).toHaveLength(repaired.target.rects.length);
      expect(repaired.target.quads?.[0].y1).toBe(repaired.target.rects[0].y1);
    }
  });

  it("upserts a programmatic exact quote as a canonical PDF text markup annotation", () => {
    const model = createSaffmanFigFiveModel();
    const exact = "from Fig. 5, that tend to cause shifts in opposite directions. Even so";
    const result = upsertCanonicalPdfTextMarkupAnnotationInFile({
      annotationFile: createAnnotationFile([]),
      model,
      exact,
      styleType: "underline",
      color: "#2196F3",
      author: "ai",
      id: "ann-ai-exact",
      createdAt: 7,
      comment: "AI note",
      tags: ["AI", "AI批注"],
      now: 9,
    });

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.annotationFile.annotations).toHaveLength(1);
    const annotation = result.annotationFile.annotations[0];
    expect(annotation.id).toBe("ann-ai-exact");
    expect(annotation.createdAt).toBe(7);
    expect(annotation.comment).toBe("AI note");
    expect(annotation.tags).toEqual(["AI", "AI批注"]);
    expect(annotation.style.type).toBe("underline");
    expect(annotation.content).toBe(
      "from Fig. 5, that tend to cause shifts in opposite directions. Even so",
    );
    expect(annotation.target.type).toBe("pdf");
    if (annotation.target.type === "pdf") {
      expect(annotation.target.rects.length).toBeGreaterThan(1);
      expect(annotation.target.rects.every((rect) => rect.y2 - rect.y1 < 0.04)).toBe(true);
      expect(annotation.target.quads).toHaveLength(annotation.target.rects.length);
      expect(annotation.target.textQuote?.exact).toBe(annotation.content);
      expect(annotation.target.startCharIndex).toBe(model.normalizedText.indexOf("from Fig. 5"));
      expect(annotation.target.textSource).toBe("pdfjs-text-model");
    }
  });

  it("keeps an AI exact quote bounded to the requested Fig. 5 sentence", () => {
    const model = createSaffmanFigFiveModel();
    const exact = "Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)7/2 V/cm.";
    const result = upsertCanonicalPdfTextMarkupAnnotationInFile({
      annotationFile: createAnnotationFile([]),
      model,
      exact,
      styleType: "highlight",
      color: "#FFD400",
      author: "lattice-ai",
      id: "ann-ai-fig5-only",
      createdAt: 11,
      tags: ["AI", "AI批注"],
      now: 12,
    });

    expect(result.ok).toBe(true);
    const annotation = result.annotation;
    expect(annotation?.content).toBe(
      "Fig. 5, that tend to cause shifts in opposite directions. Even so, the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)^(7/2) V/cm.",
    );
    expect(annotation?.content).not.toContain("of states with equal");
    expect(annotation?.content).not.toContain("In higher electric fields");
    expect(annotation?.target.type).toBe("pdf");
    if (annotation?.target.type === "pdf") {
      expect(annotation.target.startCharIndex).toBe(model.normalizedText.indexOf("Fig. 5"));
      expect(annotation.target.endCharIndex).toBe(model.normalizedText.indexOf(" V/cm.") + " V/cm.".length);
      expect(annotation.target.rects.length).toBeGreaterThan(1);
      expect(annotation.target.rects.every((rect) => rect.y2 - rect.y1 < 0.04)).toBe(true);
      expect(annotation.target.rects[0].y1).toBeCloseTo(282 / 960);
      expect(annotation.target.rects.at(-1)?.y1).toBeCloseTo(378 / 960);
    }
  });

  it("reports non-canonical sidecar annotations before repair", () => {
    const model = createSaffmanFigFiveModel();
    const annotation = upsertCanonicalPdfTextMarkupAnnotationInFile({
      annotationFile: createAnnotationFile([]),
      model,
      exact: "Fig. 5, that tend",
      styleType: "highlight",
      color: "#FFD400",
      author: "ai",
      id: "ann-check",
      createdAt: 1,
    }).annotation;
    expect(annotation).toBeDefined();
    const stale: AnnotationItem = {
      ...annotation!,
      target: annotation!.target.type === "pdf"
        ? {
            ...annotation!.target,
            rects: [{ x1: 0, y1: 0, x2: 0.8, y2: 0.2 }],
            quads: [],
          }
        : annotation!.target,
    };

    const checked = assertPdfTextMarkupAnnotationCanonical({ annotation: stale, model });
    expect(checked.ok).toBe(false);
    expect(checked.reason).toBe("annotation-anchor-is-not-canonical");
    expect(checked.repaired?.target.type).toBe("pdf");
    if (checked.repaired?.target.type === "pdf") {
      expect(checked.repaired.target.rects[0].y1).toBeCloseTo(282 / 960);
      expect(checked.repaired.target.quads).toHaveLength(checked.repaired.target.rects.length);
    }
  });
});

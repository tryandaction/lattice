import { describe, expect, it } from "vitest";
import {
  buildPdfPreviewRect,
  buildPdfSelectionRectsFromSnapshot,
  dedupeAnnotationsById,
  findPdfPageElementInScope,
  pdfSearchRectsToTargetRects,
  resolveSidebarSelectionTarget,
  shouldPreserveExistingPdfSelectionText,
  shouldClearSelectedAnnotationAfterDelete,
} from "@/lib/pdf-highlighter-adapter-utils";
import type { PdfSelectionSnapshot } from "@/lib/pdf-selection-session";
import type { AnnotationItem } from "@/types/universal-annotation";

function createAnnotation(id: string, page = 1): AnnotationItem {
  return {
    id,
    target: {
      type: "pdf",
      page,
      rects: [{ x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.4 }],
    },
    style: { color: "#ffeb3b", type: "highlight" },
    author: "user",
    createdAt: 1,
  };
}

describe("pdf-highlighter-adapter-utils", () => {
  it("finds the measured visible PDF page wrapper when duplicate page markers exist", () => {
    const root = document.createElement("div");
    const staleOverlay = document.createElement("div");
    staleOverlay.dataset.pageNumber = "4";
    staleOverlay.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 1,
      height: 1,
      right: 1,
      bottom: 1,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    const page = document.createElement("div");
    page.dataset.pageNumber = "4";
    page.dataset.pdfPageVisible = "true";
    page.dataset.pdfPageMeasured = "true";
    page.appendChild(document.createElement("canvas"));
    const textLayer = document.createElement("div");
    textLayer.className = "textLayer";
    page.appendChild(textLayer);
    page.getBoundingClientRect = () => ({
      left: 10,
      top: 20,
      width: 640,
      height: 960,
      right: 650,
      bottom: 980,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);

    root.appendChild(staleOverlay);
    root.appendChild(page);
    document.body.appendChild(root);

    expect(findPdfPageElementInScope(root, 4)).toBe(page);

    root.remove();
  });

  it("deduplicates annotations by keeping the latest item for each id", () => {
    const first = createAnnotation("a", 1);
    const second = createAnnotation("b", 2);
    const replacement = createAnnotation("a", 3);

    expect(dedupeAnnotationsById([first, second, replacement])).toEqual([second, replacement]);
  });

  it("normalizes transient selection rects against the page element", () => {
    const page = document.createElement("div");
    page.dataset.pageNumber = "2";
    page.getBoundingClientRect = () => ({
      left: 10,
      top: 20,
      width: 200,
      height: 400,
      right: 210,
      bottom: 420,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    } as DOMRect);
    document.body.appendChild(page);

    const snapshot: PdfSelectionSnapshot = {
      pageNumber: 2,
      startOffset: 0,
      endOffset: 4,
      text: "test",
      textQuote: { exact: "test", prefix: "", suffix: "", source: "dom-selection", confidence: "exact" },
      pageRects: [{ x1: 0.1, y1: 0.1, x2: 0.2, y2: 0.2 }],
      viewportRects: [],
      overlayRectsByPage: {
        2: [{ left: 20, top: 40, width: 80, height: 100, pageNumber: 2 }],
      },
      pageNumbers: [2],
      signature: "sig",
    };

    expect(buildPdfSelectionRectsFromSnapshot(snapshot, document.body)).toEqual({
      pageNumber: 2,
      rects: [{ left: 0.1, top: 0.1, width: 0.4, height: 0.25 }],
    });

    page.remove();
  });

  it("builds preview rects with padding and minimum dimensions", () => {
    const preview = buildPdfPreviewRect({
      rects: [{ x1: 0.45, y1: 0.45, x2: 0.46, y2: 0.46 }],
      pageWidth: 1000,
      pageHeight: 1000,
      paddingRatio: 0.01,
      minCssWidth: 100,
      minCssHeight: 80,
    });

    expect(preview?.x1).toBeCloseTo(0.405);
    expect(preview?.y1).toBeCloseTo(0.415);
    expect(preview?.x2).toBeCloseTo(0.505);
    expect(preview?.y2).toBeCloseTo(0.495);
  });

  it("converts search match rects into PDF target rects", () => {
    const rects = pdfSearchRectsToTargetRects([
      { left: 0.2, top: 0.3, width: 0.1, height: 0.05 },
    ]);

    expect(rects).toHaveLength(1);
    expect(rects?.[0].x1).toBeCloseTo(0.2);
    expect(rects?.[0].y1).toBeCloseTo(0.3);
    expect(rects?.[0].x2).toBeCloseTo(0.3);
    expect(rects?.[0].y2).toBeCloseTo(0.35);
  });

  it("resolves sidebar actions without mutating component state", () => {
    const annotation = createAnnotation("ann-1", 4);
    expect(resolveSidebarSelectionTarget(annotation)).toEqual({
      annotationId: "ann-1",
      pdfTarget: annotation.target,
    });
    expect(shouldClearSelectedAnnotationAfterDelete("ann-1", "ann-1")).toBe(true);
    expect(shouldClearSelectedAnnotationAfterDelete("ann-2", "ann-1")).toBe(false);
  });

  it("preserves a native multi-line selection when a secondary pdfjs anchor splits a word boundary", () => {
    expect(shouldPreserveExistingPdfSelectionText({
      selection: {
        text: "the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)7/2 V/cm.",
        textQuote: {
          exact: "the electric field stability required to hold Stark shifts below 1 MHz is typically of order 0.01(100/n)7/2 V/cm.",
          prefix: "tions. Even so, ",
          suffix: " In higher electric fields",
          source: "pdfium-native",
          confidence: "exact",
        },
        pageRects: [
          { x1: 0.08, y1: 0.29, x2: 0.62, y2: 0.32 },
          { x1: 0.08, y1: 0.33, x2: 0.78, y2: 0.36 },
          { x1: 0.08, y1: 0.37, x2: 0.24, y2: 0.39 },
        ],
        textSource: "pdfium-native",
      },
      candidate: {
        text: "ctric field stability required to holdStark shifts below 1 MHz is typically of order0.01 \u0001100/n\u00027/2 V/cm.",
        quote: {
          exact: "ctric field stability required to holdStark shifts below 1 MHz is typically of order0.01 \u0001100/n\u00027/2 V/cm.",
          prefix: "te direc-tions. Even so, the ele",
          suffix: "In higher electric fields",
          source: "pdfjs-text-model",
        },
        rects: [
          { x1: 0.08, y1: 0.29, x2: 0.62, y2: 0.32 },
          { x1: 0.08, y1: 0.33, x2: 0.78, y2: 0.36 },
          { x1: 0.08, y1: 0.37, x2: 0.24, y2: 0.39 },
        ],
      },
    })).toBe(true);
  });

  it("allows a native selection to accept a compatible pdfjs safe expansion", () => {
    expect(shouldPreserveExistingPdfSelectionText({
      selection: {
        text: "Fig. 5, that tend",
        textQuote: {
          exact: "Fig. 5, that tend",
          prefix: "from ",
          suffix: " to cause shifts",
          source: "pdfium-native",
          confidence: "exact",
        },
        pageRects: [
          { x1: 0.12, y1: 0.25, x2: 0.23, y2: 0.27 },
        ],
        textSource: "pdfium-native",
      },
      candidate: {
        text: "Fig. 5, that tend to cause shifts",
        quote: {
          exact: "Fig. 5, that tend to cause shifts",
          prefix: "from ",
          suffix: " in opposite directions",
          source: "pdfjs-text-model",
        },
        rects: [
          { x1: 0.12, y1: 0.25, x2: 0.36, y2: 0.27 },
        ],
      },
    })).toBe(false);
  });
});

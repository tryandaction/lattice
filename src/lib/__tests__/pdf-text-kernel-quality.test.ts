import { describe, expect, it } from "vitest";
import type { PdfPageTextModel } from "../pdf-page-text-cache";
import { buildPdfTextKernelAnchor, buildPdfTextKernelPage } from "../pdf-text-kernel";
import {
  evaluatePdfTextKernelAnchor,
  scorePdfKernelGeometry,
  scorePdfKernelText,
  summarizePdfTextKernelQuality,
} from "../pdf-text-kernel-quality";

function createModel(text: string): PdfPageTextModel {
  const left = 40;
  const top = 80;
  const charWidth = 14;
  const height = 24;
  return {
    pageNumber: 1,
    viewportWidth: 640,
    viewportHeight: 960,
    textContent: {
      items: [],
      styles: {},
      lang: null,
    } as PdfPageTextModel["textContent"],
    items: [],
    normalizedText: text,
    segments: [{
      itemIndex: 0,
      text,
      normalizedText: text,
      hasEOL: false,
      pageTextStart: 0,
      pageTextEnd: text.length,
      lineIndex: 0,
      blockIndex: 0,
      columnIndex: 0,
      layoutClass: "main",
    }],
    itemRects: [{
      itemIndex: 0,
      left,
      top,
      width: text.length * charWidth,
      height,
    }],
  };
}

describe("pdf-text-kernel-quality", () => {
  it("scores exact text and detects same-length CJK drift", () => {
    expect(scorePdfKernelText("含有肝炎", "含有肝炎")).toBe(1);
    expect(scorePdfKernelText("中含有肝", "含有肝炎")).toBeLessThan(0.8);
  });

  it("scores geometry overlap against expected PDF-space rects", () => {
    const expected = [{ x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.13 }];
    expect(scorePdfKernelGeometry(expected, expected)).toBe(1);
    expect(scorePdfKernelGeometry([{ x1: 0.5, y1: 0.5, x2: 0.7, y2: 0.53 }], expected)).toBe(0);
  });

  it("evaluates a CJK kernel anchor as a release-gate quality case", () => {
    const text = "例（肝炎病毒检测）：设每个人血清中含有肝炎病毒的概率为 0.4%，求";
    const model = createModel(text);
    const page = buildPdfTextKernelPage({ model });
    const start = text.indexOf("含有肝炎");
    const anchor = buildPdfTextKernelAnchor({
      page,
      model,
      startCharIndex: start,
      endCharIndex: start + "含有肝炎".length,
    });

    expect(anchor).toBeTruthy();
    if (!anchor) {
      throw new Error("Expected anchor");
    }

    const result = evaluatePdfTextKernelAnchor({
      page,
      anchor,
      testCase: {
        id: "cjk-hepatitis-selection",
        expectedText: "含有肝炎",
        expectedRects: anchor.rects,
      },
    });

    expect(result.ok).toBe(true);
    expect(result.textScore).toBe(1);
    expect(result.geometryScore).toBe(1);
    expect(result.boundaryDriftChars).toBe(0);
  });

  it("fails quality when an anchor drifts one CJK character left", () => {
    const text = "例（肝炎病毒检测）：设每个人血清中含有肝炎病毒的概率为 0.4%，求";
    const model = createModel(text);
    const page = buildPdfTextKernelPage({ model });
    const wrongStart = text.indexOf("中含有肝");
    const anchor = buildPdfTextKernelAnchor({
      page,
      model,
      startCharIndex: wrongStart,
      endCharIndex: wrongStart + "中含有肝".length,
    });

    expect(anchor).toBeTruthy();
    if (!anchor) {
      throw new Error("Expected anchor");
    }

    const result = evaluatePdfTextKernelAnchor({
      page,
      anchor,
      testCase: {
        id: "cjk-left-shift-regression",
        expectedText: "含有肝炎",
        expectedRects: anchor.rects,
      },
    });

    expect(result.ok).toBe(false);
    expect(result.failures.some((failure) => failure.startsWith("text-score"))).toBe(true);
    expect(result.failures.some((failure) => failure.startsWith("boundary-drift"))).toBe(true);
  });

  it("summarizes quality results for release gates", () => {
    const summary = summarizePdfTextKernelQuality([
      {
        id: "pass",
        ok: true,
        textScore: 1,
        geometryScore: 1,
        boundaryDriftChars: 0,
        source: "pdfjs-text-model",
        confidence: 1,
        expectedText: "alpha",
        actualText: "alpha",
        failures: [],
      },
      {
        id: "fail",
        ok: false,
        textScore: 0.5,
        geometryScore: 0,
        boundaryDriftChars: 2,
        source: "pdfjs-text-model",
        confidence: 0.8,
        expectedText: "beta",
        actualText: "eta",
        failures: ["text-score:0.500<1"],
      },
    ]);

    expect(summary.ok).toBe(false);
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.minConfidence).toBe(0.8);
  });
});

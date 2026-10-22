import { describe, expect, it } from "vitest";
import {
  mergePageRelativePdfTargetRects,
  mergePageRelativePdfTextMarkupRects,
  mergePdfTargetRectsForTextMarkup,
  mergePdfTextOverlayRects,
} from "@/lib/pdf-text-rects";

describe("pdf-text-rects", () => {
  it("merges ordinary words on the same visual line into Zotero-style line rects", () => {
    const merged = mergePdfTextOverlayRects([
      { left: 100, top: 40, width: 86, height: 18 },
      { left: 198, top: 41, width: 42, height: 17 },
      { left: 252, top: 39, width: 104, height: 19 },
      { left: 368, top: 40, width: 72, height: 18 },
    ], {
      horizontalGap: 1.5,
      maxHorizontalGap: 96,
      inlineGapMultiplier: 2.25,
    });

    const ordered = [...merged].sort((left, right) => left.left - right.left);
    expect(ordered).toHaveLength(1);
    expect(ordered[0]).toMatchObject({
      left: 100,
      width: 340,
    });
    expect(ordered[0].height).toBeGreaterThan(10);
    expect(ordered[0].height).toBeLessThan(18);
  });

  it("merges near-touching glyph fragments inside one text run", () => {
    const merged = mergePdfTextOverlayRects([
      { left: 100, top: 40, width: 18, height: 18 },
      { left: 119, top: 40, width: 20, height: 18 },
      { left: 140, top: 40, width: 16, height: 18 },
    ], {
      horizontalGap: 1.5,
      maxHorizontalGap: 4,
      inlineGapMultiplier: 0.18,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].left).toBe(100);
    expect(merged[0].width).toBe(56);
  });

  it("keeps large column gaps as separate runs", () => {
    const merged = mergePdfTextOverlayRects([
      { left: 40, top: 80, width: 110, height: 18 },
      { left: 166, top: 80, width: 90, height: 18 },
      { left: 430, top: 80, width: 120, height: 18 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].left).toBe(40);
    expect(merged[1].left).toBe(430);
  });

  it("keeps different text rows separate", () => {
    const merged = mergePdfTextOverlayRects([
      { left: 80, top: 100, width: 260, height: 18 },
      { left: 70, top: 128, width: 240, height: 18 },
    ]);

    expect(merged).toHaveLength(2);
  });

  it("normalizes persisted PDF text markup rects without widening or joining lines", () => {
    const merged = mergePdfTargetRectsForTextMarkup([
      { x1: 0.10, y1: 0.10, x2: 0.20, y2: 0.125 },
      { x1: 0.215, y1: 0.101, x2: 0.31, y2: 0.126 },
      { x1: 0.10, y1: 0.15, x2: 0.24, y2: 0.175 },
    ]);

    expect(merged).toHaveLength(3);
    expect(merged[0].x1).toBeCloseTo(0.10);
    expect(merged[0].x2).toBeCloseTo(0.20);
    expect(mergePageRelativePdfTargetRects(merged)).toHaveLength(2);
  });

  it("keeps very wide justified gaps as separate visual-line runs", () => {
    const merged = mergePdfTargetRectsForTextMarkup([
      { x1: 0.10, y1: 0.50, x2: 0.20, y2: 0.525 },
      { x1: 0.31, y1: 0.501, x2: 0.40, y2: 0.526 },
      { x1: 0.51, y1: 0.499, x2: 0.55, y2: 0.524 },
    ]);

    const ordered = [...merged].sort((left, right) => left.x1 - right.x1);
    expect(ordered).toHaveLength(3);
    expect(ordered[0].x1).toBeCloseTo(0.10);
    expect(ordered[0].x2).toBeCloseTo(0.20);
  });

  it("does not merge text markup across the two-column gutter", () => {
    const merged = mergePdfTargetRectsForTextMarkup([
      { x1: 0.12, y1: 0.50, x2: 0.36, y2: 0.525 },
      { x1: 0.58, y1: 0.501, x2: 0.82, y2: 0.526 },
    ]);

    expect(merged).toHaveLength(2);
  });

  it("renders PDF text markup as separate Zotero-style visual line segments", () => {
    const merged = mergePageRelativePdfTextMarkupRects([
      { x1: 0.10, y1: 0.100, x2: 0.56, y2: 0.145 },
      { x1: 0.10, y1: 0.128, x2: 0.54, y2: 0.173 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].top).toBeLessThan(merged[1].top);
    expect(Math.max(...merged.map((segment) => segment.height))).toBeLessThan(4);
  });

  it("keeps transient text selection rows separate even when DOM rects vertically overlap", () => {
    const merged = mergePdfTextOverlayRects([
      { left: 100, top: 100, width: 460, height: 45 },
      { left: 100, top: 128, width: 440, height: 45 },
    ], {
      horizontalGap: 1.5,
      maxHorizontalGap: 4,
      inlineGapMultiplier: 0.18,
      allowWideSameColumnGaps: false,
      strictRows: true,
      targetSegmentHeightRatio: 0.58,
      minSegmentHeightRatio: 0.42,
      maxSegmentHeightRatio: 0.66,
    });

    expect(merged).toHaveLength(2);
    expect(merged[0].top).toBeLessThan(merged[1].top);
    expect(Math.max(...merged.map((segment) => segment.height))).toBeLessThan(30);
  });

  it("keeps inline superscript and subscript fragments in one transient visual row", () => {
    const merged = mergePdfTextOverlayRects([
      { left: 232, top: 120, width: 14, height: 24 },
      { left: 246, top: 130, width: 8, height: 12 },
      { left: 255, top: 112, width: 8, height: 12 },
      { left: 264, top: 120, width: 96, height: 24 },
    ], {
      horizontalGap: 1.5,
      maxHorizontalGap: 4,
      inlineGapMultiplier: 0.18,
      allowWideSameColumnGaps: false,
      strictRows: true,
      targetSegmentHeightRatio: 0.86,
      minSegmentHeightRatio: 0.72,
      maxSegmentHeightRatio: 0.98,
      minimumSegmentHeight: 6,
      lineGapHeightMultiplier: 0.78,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0].left).toBe(232);
    expect(merged[0].width).toBe(128);
    expect(merged[0].height).toBeGreaterThanOrEqual(18);
    expect(merged[0].height).toBeLessThanOrEqual(24);
  });

  it("leaves visible space between strict text markup rows", () => {
    const merged = mergePdfTextOverlayRects([
      { left: 60, top: 80, width: 420, height: 38 },
      { left: 60, top: 118, width: 410, height: 38 },
    ], {
      horizontalGap: 1.5,
      maxHorizontalGap: 4,
      inlineGapMultiplier: 0.18,
      allowWideSameColumnGaps: false,
      strictRows: true,
      targetSegmentHeightRatio: 0.46,
      minSegmentHeightRatio: 0.34,
      maxSegmentHeightRatio: 0.52,
    });

    expect(merged).toHaveLength(2);
    expect(merged[0].top + merged[0].height).toBeLessThan(merged[1].top);
  });

  it("restores readable line boxes from thin PDFium ink bounds", () => {
    const merged = mergePageRelativePdfTextMarkupRects([
      {
        x1: 0.7042810784313726,
        y1: 0.439693859656608,
        x2: 0.9146091503267975,
        y2: 0.4410695746868263,
      },
      {
        x1: 0.5154078921568627,
        y1: 0.452909695148011,
        x2: 0.9152987581699346,
        y2: 0.4580642815116474,
      },
      {
        x1: 0.5152517973856209,
        y1: 0.4662915148989899,
        x2: 0.766657595016509,
        y2: 0.47281112398989894,
      },
    ]);

    expect(merged).toHaveLength(3);
    expect(Math.min(...merged.map((segment) => segment.height))).toBeGreaterThan(0.85);
    expect(merged[0].top + merged[0].height).toBeLessThan(merged[1].top);
    expect(merged[1].top + merged[1].height).toBeLessThan(merged[2].top);
  });
});

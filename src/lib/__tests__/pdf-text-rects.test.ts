import { describe, expect, it } from "vitest";
import {
  mergePageRelativePdfTargetRects,
  mergePdfTargetRectsForTextMarkup,
  mergePdfTextOverlayRects,
} from "@/lib/pdf-text-rects";

describe("pdf-text-rects", () => {
  it("merges fragmented words on the same visual line into a continuous band", () => {
    const merged = mergePdfTextOverlayRects([
      { left: 100, top: 40, width: 86, height: 18 },
      { left: 198, top: 41, width: 42, height: 17 },
      { left: 252, top: 39, width: 104, height: 19 },
      { left: 368, top: 40, width: 72, height: 18 },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      left: 100,
      width: 340,
    });
    expect(merged[0].height).toBeGreaterThanOrEqual(18);
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

  it("normalizes persisted PDF text markup rects to row-level boxes", () => {
    const merged = mergePdfTargetRectsForTextMarkup([
      { x1: 0.10, y1: 0.10, x2: 0.20, y2: 0.125 },
      { x1: 0.215, y1: 0.101, x2: 0.31, y2: 0.126 },
      { x1: 0.10, y1: 0.15, x2: 0.24, y2: 0.175 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].x1).toBeCloseTo(0.10);
    expect(merged[0].x2).toBeCloseTo(0.31);
    expect(mergePageRelativePdfTargetRects(merged)).toHaveLength(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  erasePdfInkPaths,
  getPdfInkBoundingBox,
  parsePdfInkContent,
} from "@/lib/pdf-ink";

describe("pdf ink geometry", () => {
  it("parses legacy and structured ink content", () => {
    expect(parsePdfInkContent(JSON.stringify([
      { x: 0.1, y: 0.2 },
      { x: 0.2, y: 0.3 },
    ]))?.paths).toHaveLength(1);

    const parsed = parsePdfInkContent(JSON.stringify({
      paths: [[
        { x: 0.1, y: 0.2 },
        { x: 0.2, y: 0.3 },
      ]],
      width: 7,
    }));

    expect(parsed?.width).toBe(7);
    expect(parsed?.paths[0]).toEqual([
      { x: 0.1, y: 0.2 },
      { x: 0.2, y: 0.3 },
    ]);
  });

  it("erases an entire stroke when the eraser touches any segment", () => {
    const paths = [
      [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
      [
        { x: 0.7, y: 0.7 },
        { x: 0.8, y: 0.8 },
      ],
    ];

    expect(erasePdfInkPaths({
      paths,
      point: { x: 0.15, y: 0.15 },
      radius: 0.02,
      mode: "stroke",
    })).toEqual([paths[1]]);
  });

  it("splits a path for local erasing when the eraser crosses a sparse segment", () => {
    const paths = [[
      { x: 0.1, y: 0.1 },
      { x: 0.2, y: 0.2 },
      { x: 0.3, y: 0.3 },
      { x: 0.4, y: 0.4 },
      { x: 0.5, y: 0.5 },
    ]];

    const erased = erasePdfInkPaths({
      paths,
      point: { x: 0.3, y: 0.3 },
      radius: 0.03,
      mode: "partial",
    });

    expect(erased).toEqual([
      [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
      [
        { x: 0.4, y: 0.4 },
        { x: 0.5, y: 0.5 },
      ],
    ]);
  });

  it("pads ink bounding boxes for visible sidebar and PDF hit targets", () => {
    const box = getPdfInkBoundingBox([[
      { x: 0.2, y: 0.25 },
      { x: 0.3, y: 0.35 },
    ]], 0.02);

    expect(box?.x1).toBeCloseTo(0.18);
    expect(box?.y1).toBeCloseTo(0.23);
    expect(box?.x2).toBeCloseTo(0.32);
    expect(box?.y2).toBeCloseTo(0.37);
  });
});

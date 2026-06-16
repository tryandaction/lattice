import { describe, expect, it } from "vitest";
import {
  computeMeasurement,
  computeVisibleMeasurements,
  createImageProvenance,
  getScaleBarPixelLength,
  serializeMeasurementsAsCsv,
  serializeProvenance,
} from "../image-editor";

describe("image editor scientific model", () => {
  it("computes calibrated line and rectangle measurements", () => {
    const calibration = { pixelsPerUnit: 10, unit: "um" as const };

    expect(computeMeasurement({
      id: "line-1",
      type: "line",
      name: "axon",
      start: { x: 0, y: 0 },
      end: { x: 30, y: 40 },
      color: "#00f",
      visible: true,
    }, calibration)).toEqual({
      id: "line-1",
      name: "axon",
      type: "line",
      value: 5,
      unit: "um",
    });

    expect(computeMeasurement({
      id: "roi-1",
      type: "rectangle",
      name: "cell",
      rect: { x: 10, y: 20, width: 40, height: 30 },
      color: "#0f0",
      visible: true,
    }, calibration)).toEqual({
      id: "roi-1",
      name: "cell",
      type: "rectangle",
      value: 12,
      unit: "um^2",
    });
  });

  it("exports visible measurement summaries as CSV", () => {
    const computed = computeVisibleMeasurements([
      {
        id: "visible",
        type: "line",
        name: "visible, line",
        start: { x: 0, y: 0 },
        end: { x: 0, y: 20 },
        color: "#fff",
        visible: true,
      },
      {
        id: "hidden",
        type: "line",
        name: "hidden",
        start: { x: 0, y: 0 },
        end: { x: 0, y: 20 },
        color: "#fff",
        visible: false,
      },
    ], { pixelsPerUnit: 2, unit: "mm" });

    expect(computed).toHaveLength(1);
    expect(serializeMeasurementsAsCsv(computed)).toBe([
      "id,name,type,value,unit",
      'visible,"visible, line",line,10,mm',
    ].join("\n"));
  });

  it("keeps scale bar and provenance serializable", () => {
    expect(getScaleBarPixelLength({
      length: 5,
      unit: "um",
      position: "bottom-right",
      color: "#ffffff",
      fontSize: 12,
    }, { pixelsPerUnit: 20, unit: "um" })).toBe(100);

    const provenance = createImageProvenance({
      sourceFileName: "figure.png",
      sourceFilePath: "figures/figure.png",
      sourceMimeType: "image/png",
      sourceDimensions: { width: 1000, height: 800 },
      operations: [{ type: "rotate", degrees: 90 }],
      annotationCount: 2,
      exportedAt: "2026-06-08T00:00:00.000Z",
    });

    expect(JSON.parse(serializeProvenance(provenance))).toMatchObject({
      version: 1,
      kind: "lattice-image-provenance",
      sourceFileName: "figure.png",
      operations: [{ type: "rotate", degrees: 90 }],
      annotationCount: 2,
    });
  });
});

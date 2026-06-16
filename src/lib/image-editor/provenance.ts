import type {
  ComputedMeasurement,
  ImageCalibration,
  ImageDimensions,
  ImageEditOperation,
  ImageProvenance,
} from "./types";

export function createImageProvenance(input: {
  sourceFileName: string;
  sourceFilePath?: string;
  sourceMimeType: string;
  sourceDimensions: ImageDimensions;
  operations: ImageEditOperation[];
  annotationCount: number;
  calibration?: ImageCalibration;
  measurements?: ComputedMeasurement[];
  exportedAt?: string;
}): ImageProvenance {
  return {
    sourceFileName: input.sourceFileName,
    sourceFilePath: input.sourceFilePath,
    sourceMimeType: input.sourceMimeType,
    sourceDimensions: input.sourceDimensions,
    operations: input.operations,
    annotationCount: input.annotationCount,
    calibration: input.calibration,
    measurements: input.measurements ?? [],
    exportedAt: input.exportedAt ?? new Date().toISOString(),
  };
}

export function serializeProvenance(provenance: ImageProvenance): string {
  return JSON.stringify({
    version: 1,
    kind: "lattice-image-provenance",
    ...provenance,
  }, null, 2);
}

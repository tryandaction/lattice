import type {
  ComputedMeasurement,
  ImageCalibration,
  ImageMeasurement,
  LineMeasurement,
  RectangleRoiMeasurement,
  ScaleBarConfig,
} from "./types";

export function createPixelCalibration(): ImageCalibration {
  return {
    pixelsPerUnit: 1,
    unit: "px",
  };
}

export function normalizeCalibration(calibration: ImageCalibration): ImageCalibration {
  if (calibration.pixelsPerUnit <= 0) {
    throw new Error("Calibration pixelsPerUnit must be positive");
  }

  return calibration;
}

export function pixelsToCalibratedUnits(pixels: number, calibration: ImageCalibration): number {
  const normalized = normalizeCalibration(calibration);
  return pixels / normalized.pixelsPerUnit;
}

export function calibratedUnitsToPixels(value: number, calibration: ImageCalibration): number {
  const normalized = normalizeCalibration(calibration);
  return value * normalized.pixelsPerUnit;
}

export function getLineLengthPixels(measurement: LineMeasurement): number {
  const dx = measurement.end.x - measurement.start.x;
  const dy = measurement.end.y - measurement.start.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function getRectangleAreaPixels(measurement: RectangleRoiMeasurement): number {
  return Math.abs(measurement.rect.width * measurement.rect.height);
}

export function computeMeasurement(
  measurement: ImageMeasurement,
  calibration: ImageCalibration = createPixelCalibration(),
): ComputedMeasurement {
  const normalized = normalizeCalibration(calibration);

  if (measurement.type === "line") {
    return {
      id: measurement.id,
      name: measurement.name,
      type: measurement.type,
      value: pixelsToCalibratedUnits(getLineLengthPixels(measurement), normalized),
      unit: normalized.unit,
    };
  }

  return {
    id: measurement.id,
    name: measurement.name,
    type: measurement.type,
    value: getRectangleAreaPixels(measurement) / (normalized.pixelsPerUnit * normalized.pixelsPerUnit),
    unit: `${normalized.unit}^2`,
  };
}

export function computeVisibleMeasurements(
  measurements: ImageMeasurement[],
  calibration: ImageCalibration = createPixelCalibration(),
): ComputedMeasurement[] {
  return measurements
    .filter((measurement) => measurement.visible)
    .map((measurement) => computeMeasurement(measurement, calibration));
}

export function getScaleBarPixelLength(config: ScaleBarConfig, calibration: ImageCalibration): number {
  if (config.unit !== calibration.unit) {
    throw new Error("Scale bar unit conversion is not implemented yet");
  }

  return calibratedUnitsToPixels(config.length, calibration);
}

export function serializeMeasurementsAsCsv(measurements: ComputedMeasurement[]): string {
  const header = "id,name,type,value,unit";
  const rows = measurements.map((measurement) => [
    measurement.id,
    measurement.name,
    measurement.type,
    String(measurement.value),
    measurement.unit,
  ].map(escapeCsvCell).join(","));

  return [header, ...rows].join("\n");
}

function escapeCsvCell(value: string): string {
  if (!/[",\n]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

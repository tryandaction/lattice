import type { AbsoluteRect, PercentageRect } from "@/lib/coordinate-transforms";

export type ImageEditOperationType = "crop" | "rotate" | "flip" | "resize" | "adjust";

export type ImageUnit = "px" | "um" | "mm" | "cm" | "inch";

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface CropOperation {
  type: "crop";
  rect: PercentageRect;
}

export interface RotateOperation {
  type: "rotate";
  degrees: 0 | 90 | 180 | 270;
}

export interface FlipOperation {
  type: "flip";
  axis: "horizontal" | "vertical";
}

export interface ResizeOperation {
  type: "resize";
  width: number;
  height: number;
}

export interface AdjustOperation {
  type: "adjust";
  brightness?: number;
  contrast?: number;
  exposure?: number;
  saturation?: number;
  grayscale?: boolean;
  invert?: boolean;
}

export type ImageEditOperation =
  | CropOperation
  | RotateOperation
  | FlipOperation
  | ResizeOperation
  | AdjustOperation;

export interface ImageEditHistory {
  past: ImageEditOperation[];
  present: ImageEditOperation[];
  future: ImageEditOperation[];
}

export interface ImageCalibration {
  pixelsPerUnit: number;
  unit: ImageUnit;
}

export interface ScaleBarConfig {
  length: number;
  unit: ImageUnit;
  position: "bottom-left" | "bottom-right" | "top-left" | "top-right";
  color: string;
  fontSize: number;
}

export interface LineMeasurement {
  id: string;
  type: "line";
  name: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  color: string;
  visible: boolean;
}

export interface RectangleRoiMeasurement {
  id: string;
  type: "rectangle";
  name: string;
  rect: AbsoluteRect;
  color: string;
  visible: boolean;
}

export type ImageMeasurement = LineMeasurement | RectangleRoiMeasurement;

export interface ComputedMeasurement {
  id: string;
  name: string;
  type: ImageMeasurement["type"];
  value: number;
  unit: ImageUnit | `${ImageUnit}^2`;
}

export interface ImageProvenance {
  sourceFileName: string;
  sourceFilePath?: string;
  sourceMimeType: string;
  sourceDimensions: ImageDimensions;
  operations: ImageEditOperation[];
  annotationCount: number;
  calibration?: ImageCalibration;
  measurements: ComputedMeasurement[];
  exportedAt: string;
}

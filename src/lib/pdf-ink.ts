import type { AnnotationItem, PdfTarget } from "@/types/universal-annotation";

export type PdfInkPoint = { x: number; y: number };
export type PdfInkPath = PdfInkPoint[];
export type PdfInkEraserMode = "stroke" | "partial";

export interface ParsedPdfInkContent {
  paths: PdfInkPath[];
  width: number;
}

type StoredInkAnnotationContent =
  | PdfInkPath[]
  | {
      paths: PdfInkPath[];
      width?: number;
    };

export const DEFAULT_PDF_INK_WIDTH = 5;
export const DEFAULT_PDF_INK_ERASER_SIZE = 24;

function isInkPoint(value: unknown): value is PdfInkPoint {
  if (!value || typeof value !== "object") {
    return false;
  }

  const point = value as Partial<PdfInkPoint>;
  return (
    typeof point.x === "number" &&
    Number.isFinite(point.x) &&
    typeof point.y === "number" &&
    Number.isFinite(point.y)
  );
}

function normalizePath(path: unknown): PdfInkPath {
  if (!Array.isArray(path)) {
    return [];
  }

  return path
    .filter(isInkPoint)
    .map((point) => ({
      x: Math.max(0, Math.min(1, point.x)),
      y: Math.max(0, Math.min(1, point.y)),
    }));
}

export function parsePdfInkContent(content: string | undefined | null): ParsedPdfInkContent | null {
  try {
    const parsed = JSON.parse(content || "[]") as StoredInkAnnotationContent;
    let paths: PdfInkPath[] = [];
    let width = DEFAULT_PDF_INK_WIDTH;

    if (Array.isArray(parsed) && parsed.length > 0) {
      if (isInkPoint(parsed[0])) {
        paths = [normalizePath(parsed)];
      } else {
        paths = parsed.map(normalizePath);
      }
    } else if (parsed && typeof parsed === "object" && "paths" in parsed && Array.isArray(parsed.paths)) {
      paths = parsed.paths.map(normalizePath);
      width = typeof parsed.width === "number" && Number.isFinite(parsed.width)
        ? Math.max(1, parsed.width)
        : width;
    }

    const validPaths = paths.filter((path) => path.length >= 2);
    if (validPaths.length === 0) {
      return null;
    }

    return {
      paths: validPaths,
      width,
    };
  } catch {
    return null;
  }
}

export function serializePdfInkContent(input: ParsedPdfInkContent): string {
  return JSON.stringify({
    paths: input.paths.filter((path) => path.length >= 2),
    width: Math.max(1, input.width),
  });
}

export function getPdfInkBoundingBox(paths: PdfInkPath[], padding = 0): PdfTarget["rects"][number] | null {
  const points = paths.flat();
  if (points.length === 0) {
    return null;
  }

  const x1 = Math.min(...points.map((point) => point.x));
  const y1 = Math.min(...points.map((point) => point.y));
  const x2 = Math.max(...points.map((point) => point.x));
  const y2 = Math.max(...points.map((point) => point.y));

  return {
    x1: Math.max(0, x1 - padding),
    y1: Math.max(0, y1 - padding),
    x2: Math.min(1, x2 + padding),
    y2: Math.min(1, y2 + padding),
  };
}

function distanceToSegmentSquared(point: PdfInkPoint, start: PdfInkPoint, end: PdfInkPoint, yScale = 1): number {
  const pointY = point.y * yScale;
  const startY = start.y * yScale;
  const endY = end.y * yScale;
  const dx = end.x - start.x;
  const dy = endY - startY;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= Number.EPSILON) {
    const pointDx = point.x - start.x;
    const pointDy = pointY - startY;
    return pointDx * pointDx + pointDy * pointDy;
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (pointY - startY) * dy) / lengthSquared));
  const projectionX = start.x + t * dx;
  const projectionY = startY + t * dy;
  const pointDx = point.x - projectionX;
  const pointDy = pointY - projectionY;
  return pointDx * pointDx + pointDy * pointDy;
}

export function isPointNearPdfInkPath(point: PdfInkPoint, path: PdfInkPath, radius: number, yScale = 1): boolean {
  if (path.length < 2) {
    return false;
  }

  const radiusSquared = radius * radius;
  for (let index = 1; index < path.length; index += 1) {
    if (distanceToSegmentSquared(point, path[index - 1], path[index], yScale) <= radiusSquared) {
      return true;
    }
  }

  return false;
}

export function erasePdfInkPaths(input: {
  paths: PdfInkPath[];
  point: PdfInkPoint;
  radius: number;
  mode: PdfInkEraserMode;
  yScale?: number;
}): PdfInkPath[] {
  if (!Number.isFinite(input.radius) || input.radius <= 0) {
    return input.paths;
  }

  const yScale = Number.isFinite(input.yScale) && input.yScale && input.yScale > 0 ? input.yScale : 1;

  if (input.mode === "stroke") {
    return input.paths.filter((path) => !isPointNearPdfInkPath(input.point, path, input.radius, yScale));
  }

  const radiusSquared = input.radius * input.radius;
  const nextPaths: PdfInkPath[] = [];

  for (const path of input.paths) {
    let current: PdfInkPath = [];
    for (let index = 0; index < path.length; index += 1) {
      const point = path[index];
      const dx = point.x - input.point.x;
      const dy = (point.y - input.point.y) * yScale;
      const pointHit = (dx * dx) + (dy * dy) <= radiusSquared;
      const segmentHit = index > 0
        ? distanceToSegmentSquared(input.point, path[index - 1], point, yScale) <= radiusSquared
        : false;

      if (pointHit || segmentHit) {
        if (current.length >= 2) {
          nextPaths.push(current);
        }
        current = pointHit ? [] : [point];
        continue;
      }

      current.push(point);
    }

    if (current.length >= 2) {
      nextPaths.push(current);
    }
  }

  return nextPaths;
}

export function updatePdfInkAnnotationAfterErase(input: {
  annotation: AnnotationItem;
  point: PdfInkPoint;
  radius: number;
  mode: PdfInkEraserMode;
  yScale?: number;
}): { content: string; rects: PdfTarget["rects"] } | null {
  if (input.annotation.style.type !== "ink" || input.annotation.target.type !== "pdf") {
    return null;
  }

  const parsed = parsePdfInkContent(input.annotation.content);
  if (!parsed) {
    return null;
  }

  const paths = erasePdfInkPaths({
    paths: parsed.paths,
    point: input.point,
    radius: input.radius,
    mode: input.mode,
    yScale: input.yScale,
  });
  if (paths.length === parsed.paths.length && paths.every((path, index) => path.length === parsed.paths[index]?.length)) {
    return null;
  }

  const boundingBox = getPdfInkBoundingBox(paths, parsed.width / 1000);
  if (!boundingBox || paths.length === 0) {
    return {
      content: serializePdfInkContent({ paths: [], width: parsed.width }),
      rects: [],
    };
  }

  return {
    content: serializePdfInkContent({ paths, width: parsed.width }),
    rects: [boundingBox],
  };
}

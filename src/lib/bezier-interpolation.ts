/**
 * Bezier Curve Interpolation for Smooth Ink Strokes
 * 
 * Implements Catmull-Rom spline interpolation and conversion to cubic Bezier curves
 * for smooth, natural-looking handwritten strokes.
 */

import type { InkPoint } from '../types/ink-annotation';

// ============================================================================
// Types
// ============================================================================

/**
 * A 2D point
 */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * A cubic Bezier curve segment
 */
export interface BezierSegment {
  /** Start point */
  p0: Point2D;
  /** First control point */
  p1: Point2D;
  /** Second control point */
  p2: Point2D;
  /** End point */
  p3: Point2D;
  /** Pressure at start */
  pressureStart: number;
  /** Pressure at end */
  pressureEnd: number;
}

/**
 * SVG path data for a stroke
 */
export interface StrokePath {
  /** SVG path d attribute */
  d: string;
  /** Array of widths at each segment (for variable width) */
  widths: number[];
}

// ============================================================================
// Catmull-Rom Spline
// ============================================================================

/**
 * Calculate Catmull-Rom spline point
 * 
 * @param p0 - Point before start
 * @param p1 - Start point
 * @param p2 - End point
 * @param p3 - Point after end
 * @param t - Parameter (0-1)
 * @param tension - Tension parameter (0.5 = Catmull-Rom)
 */
function catmullRomPoint(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  t: number,
  tension: number = 0.5
): Point2D {
  const t2 = t * t;
  const t3 = t2 * t;

  const m0x = tension * (p2.x - p0.x);
  const m0y = tension * (p2.y - p0.y);
  const m1x = tension * (p3.x - p1.x);
  const m1y = tension * (p3.y - p1.y);

  const a0 = 2 * t3 - 3 * t2 + 1;
  const a1 = t3 - 2 * t2 + t;
  const a2 = -2 * t3 + 3 * t2;
  const a3 = t3 - t2;

  return {
    x: a0 * p1.x + a1 * m0x + a2 * p2.x + a3 * m1x,
    y: a0 * p1.y + a1 * m0y + a2 * p2.y + a3 * m1y,
  };
}

/**
 * Convert Catmull-Rom segment to cubic Bezier control points
 */
function catmullRomToBezier(
  p0: Point2D,
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  tension: number = 0.5
): BezierSegment {
  // Calculate tangents
  const d1x = tension * (p2.x - p0.x) / 3;
  const d1y = tension * (p2.y - p0.y) / 3;
  const d2x = tension * (p3.x - p1.x) / 3;
  const d2y = tension * (p3.y - p1.y) / 3;

  return {
    p0: p1,
    p1: { x: p1.x + d1x, y: p1.y + d1y },
    p2: { x: p2.x - d2x, y: p2.y - d2y },
    p3: p2,
    pressureStart: 0.5,
    pressureEnd: 0.5,
  };
}

// ============================================================================
// Stroke Smoothing
// ============================================================================

/**
 * Apply smoothing to ink points using moving average
 */
export function smoothPoints(
  points: InkPoint[],
  windowSize: number = 3
): InkPoint[] {
  if (points.length <= windowSize) {
    return points;
  }

  const smoothed: InkPoint[] = [];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < points.length; i++) {
    let sumX = 0;
    let sumY = 0;
    let sumPressure = 0;
    let count = 0;

    for (let j = Math.max(0, i - halfWindow); j <= Math.min(points.length - 1, i + halfWindow); j++) {
      sumX += points[j].x;
      sumY += points[j].y;
      sumPressure += points[j].pressure;
      count++;
    }

    smoothed.push({
      ...points[i],
      x: sumX / count,
      y: sumY / count,
      pressure: sumPressure / count,
    });
  }

  return smoothed;
}

/**
 * Reduce points using Ramer-Douglas-Peucker algorithm
 */
export function simplifyPoints(
  points: InkPoint[],
  epsilon: number = 0.001
): InkPoint[] {
  if (points.length <= 2) {
    return points;
  }

  // Find the point with maximum distance from line between first and last
  let maxDist = 0;
  let maxIndex = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDist > epsilon) {
    const left = simplifyPoints(points.slice(0, maxIndex + 1), epsilon);
    const right = simplifyPoints(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  }

  // Otherwise, return just the endpoints
  return [first, last];
}

/**
 * Calculate perpendicular distance from point to line
 */
function perpendicularDistance(
  point: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) + Math.pow(point.y - lineStart.y, 2)
    );
  }

  const t = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy);
  const nearestX = lineStart.x + t * dx;
  const nearestY = lineStart.y + t * dy;

  return Math.sqrt(Math.pow(point.x - nearestX, 2) + Math.pow(point.y - nearestY, 2));
}

// ============================================================================
// Bezier Path Generation
// ============================================================================

/**
 * Convert ink points to Bezier segments
 */
export function pointsToBezierSegments(
  points: InkPoint[],
  tension: number = 0.5
): BezierSegment[] {
  if (points.length < 2) {
    return [];
  }

  if (points.length === 2) {
    // Simple line
    return [{
      p0: points[0],
      p1: {
        x: points[0].x + (points[1].x - points[0].x) / 3,
        y: points[0].y + (points[1].y - points[0].y) / 3,
      },
      p2: {
        x: points[0].x + 2 * (points[1].x - points[0].x) / 3,
        y: points[0].y + 2 * (points[1].y - points[0].y) / 3,
      },
      p3: points[1],
      pressureStart: points[0].pressure,
      pressureEnd: points[1].pressure,
    }];
  }

  const segments: BezierSegment[] = [];

  // Add phantom points at start and end for smooth endpoints
  const extendedPoints = [
    {
      x: 2 * points[0].x - points[1].x,
      y: 2 * points[0].y - points[1].y,
    },
    ...points,
    {
      x: 2 * points[points.length - 1].x - points[points.length - 2].x,
      y: 2 * points[points.length - 1].y - points[points.length - 2].y,
    },
  ];

  // Generate Bezier segments
  for (let i = 1; i < extendedPoints.length - 2; i++) {
    const segment = catmullRomToBezier(
      extendedPoints[i - 1],
      extendedPoints[i],
      extendedPoints[i + 1],
      extendedPoints[i + 2],
      tension
    );

    // Add pressure information
    const pointIndex = i - 1;
    segment.pressureStart = points[pointIndex]?.pressure ?? 0.5;
    segment.pressureEnd = points[Math.min(pointIndex + 1, points.length - 1)]?.pressure ?? 0.5;

    segments.push(segment);
  }

  return segments;
}

/**
 * Generate SVG path from Bezier segments
 */
export function bezierSegmentsToPath(segments: BezierSegment[]): string {
  if (segments.length === 0) {
    return '';
  }

  let path = `M ${segments[0].p0.x} ${segments[0].p0.y}`;

  for (const segment of segments) {
    path += ` C ${segment.p1.x} ${segment.p1.y}, ${segment.p2.x} ${segment.p2.y}, ${segment.p3.x} ${segment.p3.y}`;
  }

  return path;
}

/**
 * Generate SVG path from ink points with smoothing
 */
export function inkPointsToSvgPath(
  points: InkPoint[],
  options: {
    smoothing?: number;
    simplify?: boolean;
    simplifyEpsilon?: number;
    tension?: number;
  } = {}
): StrokePath {
  const {
    smoothing = 0.5,
    simplify = true,
    simplifyEpsilon = 0.001,
    tension = 0.5,
  } = options;

  if (points.length === 0) {
    return { d: '', widths: [] };
  }

  if (points.length === 1) {
    // Single point - draw a dot
    const p = points[0];
    return {
      d: `M ${p.x} ${p.y} L ${p.x} ${p.y}`,
      widths: [p.pressure],
    };
  }

  // Apply smoothing
  const windowSize = Math.max(1, Math.round(smoothing * 5));
  let processedPoints = smoothPoints(points, windowSize);

  // Simplify if requested
  if (simplify && processedPoints.length > 3) {
    processedPoints = simplifyPoints(processedPoints, simplifyEpsilon);
  }

  // Convert to Bezier segments
  const segments = pointsToBezierSegments(processedPoints, tension);

  // Generate path
  const d = bezierSegmentsToPath(segments);

  // Collect widths
  const widths = segments.map(s => (s.pressureStart + s.pressureEnd) / 2);

  return { d, widths };
}

// ============================================================================
// Variable Width Stroke
// ============================================================================

/**
 * Generate variable-width stroke outline
 * Creates a closed path that represents the stroke with varying width
 */
export function generateVariableWidthPath(
  points: InkPoint[],
  baseWidth: number,
  options: {
    minWidthRatio?: number;
    maxWidthRatio?: number;
    smoothing?: number;
  } = {}
): string {
  const {
    minWidthRatio = 0.2,
    maxWidthRatio = 1.5,
    smoothing = 0.5,
  } = options;

  if (points.length < 2) {
    return '';
  }

  // Smooth points first
  const windowSize = Math.max(1, Math.round(smoothing * 5));
  const smoothedPoints = smoothPoints(points, windowSize);

  // Calculate perpendicular offsets for each point
  const leftPoints: Point2D[] = [];
  const rightPoints: Point2D[] = [];

  for (let i = 0; i < smoothedPoints.length; i++) {
    const point = smoothedPoints[i];
    
    // Calculate direction
    let dx: number, dy: number;
    if (i === 0) {
      dx = smoothedPoints[1].x - point.x;
      dy = smoothedPoints[1].y - point.y;
    } else if (i === smoothedPoints.length - 1) {
      dx = point.x - smoothedPoints[i - 1].x;
      dy = point.y - smoothedPoints[i - 1].y;
    } else {
      dx = smoothedPoints[i + 1].x - smoothedPoints[i - 1].x;
      dy = smoothedPoints[i + 1].y - smoothedPoints[i - 1].y;
    }

    // Normalize
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;
    dx /= len;
    dy /= len;

    // Calculate width based on pressure
    const pressureWidth = minWidthRatio + (maxWidthRatio - minWidthRatio) * point.pressure;
    const halfWidth = (baseWidth * pressureWidth) / 2;

    // Perpendicular offset
    const perpX = -dy * halfWidth;
    const perpY = dx * halfWidth;

    leftPoints.push({ x: point.x + perpX, y: point.y + perpY });
    rightPoints.push({ x: point.x - perpX, y: point.y - perpY });
  }

  // Build closed path
  if (leftPoints.length === 0) return '';

  let path = `M ${leftPoints[0].x} ${leftPoints[0].y}`;

  // Left side (forward)
  for (let i = 1; i < leftPoints.length; i++) {
    path += ` L ${leftPoints[i].x} ${leftPoints[i].y}`;
  }

  // End cap (rounded)
  const lastLeft = leftPoints[leftPoints.length - 1];
  const lastRight = rightPoints[rightPoints.length - 1];
  const lastPoint = smoothedPoints[smoothedPoints.length - 1];
  const endRadius = baseWidth * (minWidthRatio + (maxWidthRatio - minWidthRatio) * lastPoint.pressure) / 2;
  path += ` A ${endRadius} ${endRadius} 0 0 1 ${lastRight.x} ${lastRight.y}`;

  // Right side (backward)
  for (let i = rightPoints.length - 2; i >= 0; i--) {
    path += ` L ${rightPoints[i].x} ${rightPoints[i].y}`;
  }

  // Start cap (rounded)
  const firstLeft = leftPoints[0];
  const firstRight = rightPoints[0];
  const firstPoint = smoothedPoints[0];
  const startRadius = baseWidth * (minWidthRatio + (maxWidthRatio - minWidthRatio) * firstPoint.pressure) / 2;
  path += ` A ${startRadius} ${startRadius} 0 0 1 ${firstLeft.x} ${firstLeft.y}`;

  path += ' Z';

  return path;
}

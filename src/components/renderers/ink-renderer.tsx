"use client";

import { useMemo, memo } from 'react';
import { cn } from '@/lib/utils';
import type { InkStroke, InkPoint } from '@/types/ink-annotation';
import {
  inkPointsToSvgPath,
  generateVariableWidthPath,
} from '@/lib/bezier-interpolation';

// ============================================================================
// Types
// ============================================================================

interface InkRendererProps {
  /** Strokes to render */
  strokes: InkStroke[];
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Whether to use variable width rendering */
  variableWidth?: boolean;
  /** Currently selected stroke ID (for highlighting) */
  selectedStrokeId?: string;
  /** Callback when a stroke is clicked */
  onStrokeClick?: (strokeId: string) => void;
  /** Custom class name */
  className?: string;
}

interface SingleStrokeProps {
  stroke: InkStroke;
  width: number;
  height: number;
  variableWidth: boolean;
  isSelected: boolean;
  onClick?: () => void;
}

// ============================================================================
// Single Stroke Component
// ============================================================================

/**
 * Renders a single ink stroke
 */
const SingleStroke = memo(function SingleStroke({
  stroke,
  width,
  height,
  variableWidth,
  isSelected,
  onClick,
}: SingleStrokeProps) {
  // Convert normalized points to pixel coordinates
  const pixelPoints = useMemo((): InkPoint[] => {
    return stroke.points.map(point => ({
      ...point,
      x: point.x * width,
      y: point.y * height,
    }));
  }, [stroke.points, width, height]);

  // Generate SVG path
  const pathData = useMemo(() => {
    if (pixelPoints.length === 0) return '';

    if (variableWidth && stroke.style.pressureSensitivity) {
      // Use variable width path for pressure-sensitive strokes
      return generateVariableWidthPath(pixelPoints, stroke.style.width, {
        smoothing: stroke.style.smoothing,
      });
    } else {
      // Use simple bezier path
      const { d } = inkPointsToSvgPath(pixelPoints, {
        smoothing: stroke.style.smoothing,
      });
      return d;
    }
  }, [pixelPoints, variableWidth, stroke.style]);

  if (!pathData) return null;

  const isVariableWidth = variableWidth && stroke.style.pressureSensitivity;

  return (
    <path
      d={pathData}
      fill={isVariableWidth ? stroke.style.color : 'none'}
      stroke={isVariableWidth ? 'none' : stroke.style.color}
      strokeWidth={isVariableWidth ? 0 : stroke.style.width}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={stroke.style.opacity}
      className={cn(
        'transition-opacity',
        isSelected && 'opacity-50',
        onClick && 'cursor-pointer hover:opacity-70'
      )}
      onClick={onClick}
      data-stroke-id={stroke.id}
    />
  );
});

// ============================================================================
// Main Ink Renderer
// ============================================================================

/**
 * InkRenderer - Renders ink strokes as SVG
 * 
 * Features:
 * - Smooth Bezier curve rendering
 * - Variable width based on pressure
 * - Selection highlighting
 * - Click handling for stroke selection
 * 
 * Requirements: 8.3, 9.1, 9.3
 */
export function InkRenderer({
  strokes,
  width,
  height,
  variableWidth = true,
  selectedStrokeId,
  onStrokeClick,
  className,
}: InkRendererProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('pointer-events-none', className)}
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      {strokes.map(stroke => (
        <SingleStroke
          key={stroke.id}
          stroke={stroke}
          width={width}
          height={height}
          variableWidth={variableWidth}
          isSelected={stroke.id === selectedStrokeId}
          onClick={onStrokeClick ? () => onStrokeClick(stroke.id) : undefined}
        />
      ))}
    </svg>
  );
}

// ============================================================================
// Live Stroke Preview
// ============================================================================

interface LiveStrokePreviewProps {
  /** Current points being drawn */
  points: InkPoint[];
  /** Canvas width in pixels */
  width: number;
  /** Canvas height in pixels */
  height: number;
  /** Stroke color */
  color: string;
  /** Stroke width */
  strokeWidth: number;
  /** Stroke opacity */
  opacity?: number;
  /** Whether to use variable width */
  variableWidth?: boolean;
  /** Smoothing level */
  smoothing?: number;
  /** Custom class name */
  className?: string;
}

/**
 * LiveStrokePreview - Renders the stroke currently being drawn
 * 
 * Optimized for real-time rendering during drawing
 */
export function LiveStrokePreview({
  points,
  width,
  height,
  color,
  strokeWidth,
  opacity = 1,
  variableWidth = true,
  smoothing = 0.5,
  className,
}: LiveStrokePreviewProps) {
  // Convert normalized points to pixel coordinates
  const pixelPoints = useMemo((): InkPoint[] => {
    return points.map(point => ({
      ...point,
      x: point.x * width,
      y: point.y * height,
    }));
  }, [points, width, height]);

  // Generate path - use simpler algorithm for live preview
  const pathData = useMemo(() => {
    if (pixelPoints.length === 0) return '';

    if (pixelPoints.length === 1) {
      // Single point - draw a dot
      const p = pixelPoints[0];
      return `M ${p.x} ${p.y} L ${p.x} ${p.y}`;
    }

    if (variableWidth) {
      return generateVariableWidthPath(pixelPoints, strokeWidth, {
        smoothing: smoothing * 0.5, // Less smoothing for responsiveness
      });
    }

    // Simple polyline for fast rendering
    let path = `M ${pixelPoints[0].x} ${pixelPoints[0].y}`;
    for (let i = 1; i < pixelPoints.length; i++) {
      path += ` L ${pixelPoints[i].x} ${pixelPoints[i].y}`;
    }
    return path;
  }, [pixelPoints, variableWidth, strokeWidth, smoothing]);

  if (!pathData || points.length === 0) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('pointer-events-none', className)}
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <path
        d={pathData}
        fill={variableWidth ? color : 'none'}
        stroke={variableWidth ? 'none' : color}
        strokeWidth={variableWidth ? 0 : strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={opacity}
      />
    </svg>
  );
}

// ============================================================================
// Eraser Preview
// ============================================================================

interface EraserPreviewProps {
  /** Current position */
  position: { x: number; y: number } | null;
  /** Eraser size in pixels */
  size: number;
  /** Canvas width */
  width: number;
  /** Canvas height */
  height: number;
  /** Custom class name */
  className?: string;
}

/**
 * EraserPreview - Shows the eraser cursor
 */
export function EraserPreview({
  position,
  size,
  width,
  height,
  className,
}: EraserPreviewProps) {
  if (!position) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('pointer-events-none', className)}
      style={{ position: 'absolute', top: 0, left: 0 }}
    >
      <circle
        cx={position.x}
        cy={position.y}
        r={size / 2}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="4 2"
        className="text-muted-foreground"
      />
    </svg>
  );
}

export default InkRenderer;

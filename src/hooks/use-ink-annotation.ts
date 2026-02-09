/**
 * useInkAnnotation Hook
 * 
 * Manages ink stroke buffering and merging for continuous drawing.
 * Strokes within a time/distance threshold are merged into a single annotation.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';

// ============================================================================
// Types
// ============================================================================

export interface InkPoint {
  x: number;  // Normalized 0-1
  y: number;  // Normalized 0-1
}

export interface InkStroke {
  points: InkPoint[];
  page: number;
  color: string;
}

export interface MergeCriteria {
  timeThreshold: number;      // ms, default: 2000
  distanceThreshold: number;  // normalized 0-1, default: 0.1 (10% of page)
  samePage: boolean;          // default: true
  sameColor: boolean;         // default: true
}

export interface StrokeBuffer {
  strokes: InkStroke[];
  startTime: number;
  lastStrokeTime: number;
  page: number;
  color: string;
  boundingBox: BoundingBox;
}

export interface BoundingBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface MergedInkAnnotation {
  page: number;
  color: string;
  strokes: InkStroke[];
  boundingBox: BoundingBox;
  content: string;  // JSON stringified paths for rendering
}

export interface UseInkAnnotationOptions {
  onCreateAnnotation: (annotation: MergedInkAnnotation) => void;
  mergeCriteria?: Partial<MergeCriteria>;
}

export interface UseInkAnnotationReturn {
  addStroke: (stroke: InkStroke) => void;
  isDrawing: boolean;
  strokeCount: number;
  finalizeNow: () => void;
  cancelDrawing: () => void;
}

// ============================================================================
// Default Values
// ============================================================================

const DEFAULT_CRITERIA: MergeCriteria = {
  timeThreshold: 2000,
  distanceThreshold: 0.1,  // 10% of page dimension
  samePage: true,
  sameColor: true,
};

// ============================================================================
// Utility Functions
// ============================================================================

function getStrokeBoundingBox(stroke: InkStroke): BoundingBox {
  const xs = stroke.points.map(p => p.x);
  const ys = stroke.points.map(p => p.y);
  
  return {
    x1: Math.min(...xs),
    y1: Math.min(...ys),
    x2: Math.max(...xs),
    y2: Math.max(...ys),
  };
}

function expandBoundingBox(box: BoundingBox, stroke: InkStroke): BoundingBox {
  const strokeBox = getStrokeBoundingBox(stroke);
  
  return {
    x1: Math.min(box.x1, strokeBox.x1),
    y1: Math.min(box.y1, strokeBox.y1),
    x2: Math.max(box.x2, strokeBox.x2),
    y2: Math.max(box.y2, strokeBox.y2),
  };
}

function calculateDistance(stroke1: InkStroke, stroke2: InkStroke): number {
  if (stroke1.points.length === 0 || stroke2.points.length === 0) {
    return Infinity;
  }
  
  // Get end point of stroke1
  const end1 = stroke1.points[stroke1.points.length - 1];
  // Get start point of stroke2
  const start2 = stroke2.points[0];
  
  return Math.sqrt(
    Math.pow(end1.x - start2.x, 2) +
    Math.pow(end1.y - start2.y, 2)
  );
}

function shouldMergeWithBuffer(
  buffer: StrokeBuffer | null,
  newStroke: InkStroke,
  criteria: MergeCriteria
): boolean {
  if (!buffer) return false;
  if (buffer.strokes.length === 0) return false;
  
  const now = Date.now();
  const timeSinceLastStroke = now - buffer.lastStrokeTime;
  
  // Time check
  if (timeSinceLastStroke > criteria.timeThreshold) {
    return false;
  }
  
  // Page check
  if (criteria.samePage && buffer.page !== newStroke.page) {
    return false;
  }
  
  // Color check
  if (criteria.sameColor && buffer.color !== newStroke.color) {
    return false;
  }
  
  // Distance check
  const lastStroke = buffer.strokes[buffer.strokes.length - 1];
  const distance = calculateDistance(lastStroke, newStroke);
  if (distance > criteria.distanceThreshold) {
    return false;
  }
  
  return true;
}

function createMergedAnnotation(buffer: StrokeBuffer): MergedInkAnnotation {
  // Combine all stroke paths for rendering
  const allPaths = buffer.strokes.map(s => s.points);
  
  return {
    page: buffer.page,
    color: buffer.color,
    strokes: buffer.strokes,
    boundingBox: buffer.boundingBox,
    content: JSON.stringify(allPaths),
  };
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useInkAnnotation(options: UseInkAnnotationOptions): UseInkAnnotationReturn {
  const { onCreateAnnotation, mergeCriteria } = options;
  
  const criteria = useMemo<MergeCriteria>(() => ({
    ...DEFAULT_CRITERIA,
    ...mergeCriteria,
  }), [mergeCriteria]);
  
  const [buffer, setBuffer] = useState<StrokeBuffer | null>(null);
  const finalizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bufferRef = useRef<StrokeBuffer | null>(null);
  
  // Keep bufferRef in sync with buffer state
  useEffect(() => {
    bufferRef.current = buffer;
  }, [buffer]);
  
  // Finalize the current buffer into an annotation
  const finalizeAnnotation = useCallback(() => {
    const currentBuffer = bufferRef.current;
    if (!currentBuffer || currentBuffer.strokes.length === 0) {
      setBuffer(null);
      return;
    }
    
    const annotation = createMergedAnnotation(currentBuffer);
    onCreateAnnotation(annotation);
    setBuffer(null);
  }, [onCreateAnnotation]);
  
  // Add a stroke to the buffer
  const addStroke = useCallback((stroke: InkStroke) => {
    if (stroke.points.length < 2) return;
    
    // Clear existing finalize timeout
    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
    
    setBuffer(prevBuffer => {
      if (shouldMergeWithBuffer(prevBuffer, stroke, criteria)) {
        // Add to existing buffer
        return {
          ...prevBuffer!,
          strokes: [...prevBuffer!.strokes, stroke],
          lastStrokeTime: Date.now(),
          boundingBox: expandBoundingBox(prevBuffer!.boundingBox, stroke),
        };
      } else {
        // Finalize previous buffer if exists
        if (prevBuffer && prevBuffer.strokes.length > 0) {
          const annotation = createMergedAnnotation(prevBuffer);
          // Use setTimeout to avoid state update during render
          setTimeout(() => onCreateAnnotation(annotation), 0);
        }
        
        // Start new buffer
        return {
          strokes: [stroke],
          startTime: Date.now(),
          lastStrokeTime: Date.now(),
          page: stroke.page,
          color: stroke.color,
          boundingBox: getStrokeBoundingBox(stroke),
        };
      }
    });
    
    // Set new finalize timeout
    finalizeTimeoutRef.current = setTimeout(() => {
      finalizeAnnotation();
    }, criteria.timeThreshold);
  }, [criteria, onCreateAnnotation, finalizeAnnotation]);
  
  // Force finalize now
  const finalizeNow = useCallback(() => {
    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
    finalizeAnnotation();
  }, [finalizeAnnotation]);
  
  // Cancel current drawing without saving
  const cancelDrawing = useCallback(() => {
    if (finalizeTimeoutRef.current) {
      clearTimeout(finalizeTimeoutRef.current);
      finalizeTimeoutRef.current = null;
    }
    setBuffer(null);
  }, []);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (finalizeTimeoutRef.current) {
        clearTimeout(finalizeTimeoutRef.current);
      }
      // Finalize any pending strokes on unmount
      const currentBuffer = bufferRef.current;
      if (currentBuffer && currentBuffer.strokes.length > 0) {
        const annotation = createMergedAnnotation(currentBuffer);
        onCreateAnnotation(annotation);
      }
    };
  }, [onCreateAnnotation]);
  
  return {
    addStroke,
    isDrawing: buffer !== null && buffer.strokes.length > 0,
    strokeCount: buffer?.strokes.length ?? 0,
    finalizeNow,
    cancelDrawing,
  };
}

export default useInkAnnotation;

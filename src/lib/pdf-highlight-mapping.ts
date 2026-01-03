/**
 * PDF Highlight Mapping Utilities
 * 
 * Converts between Universal Annotation format and react-pdf-highlighter format.
 * Provides bidirectional mapping for highlights.
 */

import type { 
  AnnotationItem, 
  PdfTarget, 
  BoundingBox,
  AnnotationStyleType 
} from '../types/universal-annotation';
import { HIGHLIGHT_COLORS, DEFAULT_HIGHLIGHT_COLOR } from './annotation-colors';

// ============================================================================
// Types for react-pdf-highlighter
// ============================================================================

/**
 * Scaled position from react-pdf-highlighter
 */
export interface ScaledPosition {
  boundingRect: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
    pageNumber?: number;
  };
  rects: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    width: number;
    height: number;
    pageNumber?: number;
  }>;
  pageNumber: number;
}

/**
 * Highlight format used by react-pdf-highlighter
 */
export interface PDFHighlight {
  id: string;
  position: ScaledPosition;
  content: {
    text?: string;
    image?: string;
  };
  comment?: {
    text: string;
    emoji?: string;
  };
  color?: string;
}

/**
 * Selection result from react-pdf-highlighter onSelectionFinished
 */
export interface PDFSelection {
  content: {
    text?: string;
    image?: string;
  };
  position: ScaledPosition;
  scaledPosition: ScaledPosition;
}

// ============================================================================
// Annotation to Highlight Conversion
// ============================================================================

/**
 * Converts a Universal AnnotationItem to react-pdf-highlighter Highlight format
 * 
 * @param annotation - Universal annotation item
 * @returns PDFHighlight or null if not a PDF annotation
 */
export function annotationToHighlight(annotation: AnnotationItem): PDFHighlight | null {
  // Only convert PDF target annotations
  if (annotation.target.type !== 'pdf') {
    return null;
  }

  const target = annotation.target as PdfTarget;
  
  // Convert bounding boxes to scaled position format
  const rects = target.rects.map(rect => ({
    x1: rect.x1,
    y1: rect.y1,
    x2: rect.x2,
    y2: rect.y2,
    width: rect.x2 - rect.x1,
    height: rect.y2 - rect.y1,
    pageNumber: target.page,
  }));

  // Calculate overall bounding rect from all rects
  const boundingRect = calculateBoundingRect(rects);

  const highlight: PDFHighlight = {
    id: annotation.id,
    position: {
      boundingRect: {
        ...boundingRect,
        pageNumber: target.page,
      },
      rects,
      pageNumber: target.page,
    },
    content: {
      text: annotation.content,
    },
    color: annotation.style.color,
  };

  // Add comment if present
  if (annotation.comment) {
    highlight.comment = {
      text: annotation.comment,
    };
  }

  return highlight;
}

/**
 * Converts multiple annotations to highlights
 * 
 * @param annotations - Array of universal annotations
 * @returns Array of PDF highlights (non-PDF annotations filtered out)
 */
export function annotationsToHighlights(annotations: AnnotationItem[]): PDFHighlight[] {
  return annotations
    .map(annotationToHighlight)
    .filter((h): h is PDFHighlight => h !== null);
}

// ============================================================================
// Selection to Annotation Conversion
// ============================================================================

/**
 * Converts a react-pdf-highlighter selection to Universal AnnotationItem format
 * 
 * @param selection - Selection from onSelectionFinished
 * @param color - Highlight color
 * @param author - Author identifier
 * @param styleType - Style type (default: 'highlight')
 * @returns Partial annotation item (without id and createdAt)
 */
export function selectionToAnnotation(
  selection: PDFSelection,
  color: string,
  author: string,
  styleType: AnnotationStyleType = 'highlight'
): Omit<AnnotationItem, 'id' | 'createdAt'> {
  const position = selection.scaledPosition || selection.position;
  
  // Convert rects to BoundingBox format
  const rects: BoundingBox[] = position.rects.map(rect => ({
    x1: rect.x1,
    y1: rect.y1,
    x2: rect.x2,
    y2: rect.y2,
  }));

  const target: PdfTarget = {
    type: 'pdf',
    page: position.pageNumber,
    rects,
  };

  return {
    target,
    style: {
      color,
      type: styleType,
    },
    content: selection.content.text,
    author,
  };
}

/**
 * Creates a pin annotation at specific coordinates
 * 
 * @param page - Page number (1-indexed)
 * @param x - X coordinate (normalized 0-1)
 * @param y - Y coordinate (normalized 0-1)
 * @param comment - Optional comment text
 * @param author - Author identifier
 * @param color - Pin color (default: amber)
 * @returns Partial annotation item for a pin
 */
export function createPinAnnotation(
  page: number,
  x: number,
  y: number,
  comment: string | undefined,
  author: string,
  color: string = '#FFC107'
): Omit<AnnotationItem, 'id' | 'createdAt'> {
  // Create a small area around the click point
  const pinSize = 0.02; // 2% of page dimension
  
  const target: PdfTarget = {
    type: 'pdf',
    page,
    rects: [{
      x1: Math.max(0, x - pinSize / 2),
      y1: Math.max(0, y - pinSize / 2),
      x2: Math.min(1, x + pinSize / 2),
      y2: Math.min(1, y + pinSize / 2),
    }],
  };

  return {
    target,
    style: {
      color,
      type: 'area',
    },
    comment,
    author,
  };
}

// ============================================================================
// Highlight to Annotation Conversion (reverse mapping)
// ============================================================================

/**
 * Converts a react-pdf-highlighter Highlight back to Universal AnnotationItem format
 * Useful for round-trip testing
 * 
 * @param highlight - PDF highlight
 * @param author - Author identifier
 * @returns Partial annotation item
 */
export function highlightToAnnotation(
  highlight: PDFHighlight,
  author: string
): Omit<AnnotationItem, 'id' | 'createdAt'> {
  const rects: BoundingBox[] = highlight.position.rects.map(rect => ({
    x1: rect.x1,
    y1: rect.y1,
    x2: rect.x2,
    y2: rect.y2,
  }));

  const target: PdfTarget = {
    type: 'pdf',
    page: highlight.position.pageNumber,
    rects,
  };

  return {
    target,
    style: {
      color: highlight.color || DEFAULT_HIGHLIGHT_COLOR.hex,
      type: 'highlight',
    },
    content: highlight.content.text,
    comment: highlight.comment?.text,
    author,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculates the overall bounding rectangle from multiple rects
 */
function calculateBoundingRect(rects: Array<{ x1: number; y1: number; x2: number; y2: number; width: number; height: number }>) {
  if (rects.length === 0) {
    return { x1: 0, y1: 0, x2: 0, y2: 0, width: 0, height: 0 };
  }

  const x1 = Math.min(...rects.map(r => r.x1));
  const y1 = Math.min(...rects.map(r => r.y1));
  const x2 = Math.max(...rects.map(r => r.x2));
  const y2 = Math.max(...rects.map(r => r.y2));

  return {
    x1,
    y1,
    x2,
    y2,
    width: x2 - x1,
    height: y2 - y1,
  };
}

/**
 * Checks if an annotation is a pin (area style with small rect)
 */
export function isPinAnnotation(annotation: AnnotationItem): boolean {
  if (annotation.target.type !== 'pdf') return false;
  if (annotation.style.type !== 'area') return false;
  
  const target = annotation.target as PdfTarget;
  if (target.rects.length !== 1) return false;
  
  const rect = target.rects[0];
  const width = rect.x2 - rect.x1;
  const height = rect.y2 - rect.y1;
  
  // Pin annotations are small (< 5% of page)
  return width < 0.05 && height < 0.05;
}

/**
 * Gets the center point of a pin annotation
 */
export function getPinCenter(annotation: AnnotationItem): { x: number; y: number } | null {
  if (!isPinAnnotation(annotation)) return null;
  
  const target = annotation.target as PdfTarget;
  const rect = target.rects[0];
  
  return {
    x: (rect.x1 + rect.x2) / 2,
    y: (rect.y1 + rect.y2) / 2,
  };
}

/**
 * Gets the color name from a color value
 */
export function getColorName(color: string): string {
  const found = HIGHLIGHT_COLORS.find(c => c.hex === color || c.value === color);
  return found?.name || 'Custom';
}

/**
 * Validates that a highlight has required fields
 */
export function isValidHighlight(highlight: unknown): highlight is PDFHighlight {
  if (!highlight || typeof highlight !== 'object') return false;
  
  const h = highlight as Record<string, unknown>;
  
  return (
    typeof h.id === 'string' &&
    h.position !== null &&
    typeof h.position === 'object' &&
    typeof (h.position as Record<string, unknown>).pageNumber === 'number'
  );
}

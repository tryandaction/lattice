/**
 * PDF Annotation Hook
 * 
 * Provides text selection detection and annotation creation functionality
 * for PDF pages.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { LatticeAnnotation, AnnotationColor, AnnotationType, TextNoteStyle } from '../types/annotation';
import { createAnnotation } from '../lib/annotation-utils';
import {
  normalizePosition,
  calculateBoundingBox,
  type PixelRect,
} from '../lib/annotation-coordinates';

// ============================================================================
// Types
// ============================================================================

export interface TextSelectionInfo {
  /** Selected text content */
  text: string;
  /** Bounding rectangles for the selection (in page coordinates) */
  rects: PixelRect[];
  /** Overall bounding box */
  boundingRect: PixelRect;
  /** Page number (1-indexed) */
  page: number;
  /** Position for showing the color picker (viewport coordinates) */
  pickerPosition: { x: number; y: number };
}

export interface AreaSelectionInfo {
  /** Bounding rectangle for the area (in page coordinates) */
  rect: PixelRect;
  /** Page number (1-indexed) */
  page: number;
}

export interface TextNoteData {
  /** Display text for the annotation */
  displayText: string;
  /** Background color (hex or 'transparent') */
  backgroundColor: string;
  /** Text styling */
  textStyle: TextNoteStyle;
}

export interface UsePdfAnnotationOptions {
  /** File ID for the PDF */
  fileId: string;
  /** Current zoom scale */
  scale: number;
  /** Page width at scale 1.0 */
  pageWidth: number;
  /** Page height at scale 1.0 */
  pageHeight: number;
  /** Callback when an annotation is created */
  onAnnotationCreate?: (annotation: LatticeAnnotation) => void;
}

export interface UsePdfAnnotationReturn {
  /** Current text selection info (null if no selection) */
  textSelection: TextSelectionInfo | null;
  /** Current area selection info (null if not selecting) */
  areaSelection: AreaSelectionInfo | null;
  /** Whether area selection mode is active (Alt key held) */
  isAreaSelecting: boolean;
  /** Clear the current text selection */
  clearTextSelection: () => void;
  /** Create a text highlight from the current selection */
  createTextHighlight: (color: AnnotationColor) => LatticeAnnotation | null;
  /** Create an area highlight */
  createAreaHighlight: (rect: PixelRect, page: number, color: AnnotationColor) => LatticeAnnotation | null;
  /** Create a text note annotation */
  createTextNote: (rect: PixelRect, page: number, data: TextNoteData) => LatticeAnnotation | null;
  /** Handle mouse down for area selection */
  handleAreaMouseDown: (e: React.MouseEvent, page: number) => void;
  /** Handle mouse move for area selection */
  handleAreaMouseMove: (e: React.MouseEvent) => void;
  /** Handle mouse up for area selection */
  handleAreaMouseUp: (e: React.MouseEvent, color: AnnotationColor) => void;
  /** Handle text selection change */
  handleTextSelectionChange: (page: number, pageElement: HTMLElement) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing PDF annotation creation
 * 
 * Handles:
 * - Text selection detection and bounding rect calculation
 * - Area selection with Alt+drag
 * - Annotation creation with normalized coordinates
 */
export function usePdfAnnotation({
  fileId,
  scale,
  pageWidth,
  pageHeight,
  onAnnotationCreate,
}: UsePdfAnnotationOptions): UsePdfAnnotationReturn {
  const [textSelection, setTextSelection] = useState<TextSelectionInfo | null>(null);
  const [areaSelection, setAreaSelection] = useState<AreaSelectionInfo | null>(null);
  const [isAreaSelecting, setIsAreaSelecting] = useState(false);
  
  // Track area selection start point
  const areaStartRef = useRef<{ x: number; y: number; page: number } | null>(null);

  // Clear text selection
  const clearTextSelection = useCallback(() => {
    setTextSelection(null);
    window.getSelection()?.removeAllRanges();
  }, []);

  // Create text highlight from current selection
  const createTextHighlight = useCallback(
    (color: AnnotationColor): LatticeAnnotation | null => {
      if (!textSelection) return null;

      const position = normalizePosition(
        textSelection.boundingRect,
        textSelection.rects,
        pageWidth,
        pageHeight
      );

      const annotation = createAnnotation({
        fileId,
        page: textSelection.page,
        position,
        content: { text: textSelection.text },
        color,
        type: 'text',
      });

      onAnnotationCreate?.(annotation);
      clearTextSelection();

      return annotation;
    },
    [textSelection, fileId, pageWidth, pageHeight, onAnnotationCreate, clearTextSelection]
  );

  // Create area highlight
  const createAreaHighlight = useCallback(
    (rect: PixelRect, page: number, color: AnnotationColor): LatticeAnnotation | null => {
      const position = normalizePosition(rect, [rect], pageWidth, pageHeight);

      const annotation = createAnnotation({
        fileId,
        page,
        position,
        content: {},
        color,
        type: 'area',
      });

      onAnnotationCreate?.(annotation);

      return annotation;
    },
    [fileId, pageWidth, pageHeight, onAnnotationCreate]
  );

  // Create text note annotation
  const createTextNote = useCallback(
    (rect: PixelRect, page: number, data: TextNoteData): LatticeAnnotation | null => {
      const position = normalizePosition(rect, [rect], pageWidth, pageHeight);

      const annotation = createAnnotation({
        fileId,
        page,
        position,
        content: {
          displayText: data.displayText,
          backgroundColor: data.backgroundColor,
          textStyle: data.textStyle,
        },
        color: data.backgroundColor === 'transparent' ? 'yellow' : data.backgroundColor,
        type: 'textNote',
      });

      onAnnotationCreate?.(annotation);

      return annotation;
    },
    [fileId, pageWidth, pageHeight, onAnnotationCreate]
  );

  // Handle area selection mouse down
  const handleAreaMouseDown = useCallback(
    (e: React.MouseEvent, page: number) => {
      if (!e.altKey) return;

      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      areaStartRef.current = { x, y, page };
      setIsAreaSelecting(true);
      setAreaSelection({
        rect: { x, y, width: 0, height: 0 },
        page,
      });
    },
    [scale]
  );

  // Handle area selection mouse move
  const handleAreaMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isAreaSelecting || !areaStartRef.current) return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const currentX = (e.clientX - rect.left) / scale;
      const currentY = (e.clientY - rect.top) / scale;

      const startX = areaStartRef.current.x;
      const startY = areaStartRef.current.y;

      // Calculate rectangle (handle negative dimensions)
      const x = Math.min(startX, currentX);
      const y = Math.min(startY, currentY);
      const width = Math.abs(currentX - startX);
      const height = Math.abs(currentY - startY);

      setAreaSelection({
        rect: { x, y, width, height },
        page: areaStartRef.current.page,
      });
    },
    [isAreaSelecting, scale]
  );

  // Handle area selection mouse up
  const handleAreaMouseUp = useCallback(
    (e: React.MouseEvent, color: AnnotationColor) => {
      if (!isAreaSelecting || !areaSelection) {
        setIsAreaSelecting(false);
        areaStartRef.current = null;
        return;
      }

      // Only create annotation if area is large enough (reduced threshold for easier use)
      const minArea = 5; // Minimum width/height in PDF units
      if (areaSelection.rect.width > minArea && areaSelection.rect.height > minArea) {
        createAreaHighlight(areaSelection.rect, areaSelection.page, color);
      }

      setIsAreaSelecting(false);
      setAreaSelection(null);
      areaStartRef.current = null;
    },
    [isAreaSelecting, areaSelection, createAreaHighlight]
  );

  // Handle text selection change
  const handleTextSelectionChange = useCallback(
    (page: number, pageElement: HTMLElement) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        setTextSelection(null);
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        setTextSelection(null);
        return;
      }

      // Get all client rects for the selection
      const range = selection.getRangeAt(0);
      const clientRects = range.getClientRects();
      const pageRect = pageElement.getBoundingClientRect();

      // Convert client rects to page coordinates
      const rects: PixelRect[] = [];
      for (let i = 0; i < clientRects.length; i++) {
        const clientRect = clientRects[i];
        rects.push({
          x: (clientRect.left - pageRect.left) / scale,
          y: (clientRect.top - pageRect.top) / scale,
          width: clientRect.width / scale,
          height: clientRect.height / scale,
        });
      }

      if (rects.length === 0) {
        setTextSelection(null);
        return;
      }

      const boundingRect = calculateBoundingBox(rects);

      // Calculate picker position (center-top of selection in viewport)
      const firstRect = clientRects[0];
      const pickerPosition = {
        x: firstRect.left + firstRect.width / 2,
        y: firstRect.top,
      };

      setTextSelection({
        text,
        rects,
        boundingRect,
        page,
        pickerPosition,
      });
    },
    [scale]
  );

  // Listen for Alt key to enable area selection mode indicator
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        // Visual indicator could be added here
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Alt' && isAreaSelecting) {
        // Cancel area selection if Alt is released during selection
        setIsAreaSelecting(false);
        setAreaSelection(null);
        areaStartRef.current = null;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
  }, [isAreaSelecting]);

  return {
    textSelection,
    areaSelection,
    isAreaSelecting,
    clearTextSelection,
    createTextHighlight,
    createAreaHighlight,
    createTextNote,
    handleAreaMouseDown,
    handleAreaMouseMove,
    handleAreaMouseUp,
    handleTextSelectionChange,
  };
}

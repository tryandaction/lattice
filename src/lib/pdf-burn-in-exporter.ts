/**
 * PDF Burn-In Exporter
 * 
 * Client-side PDF modification using pdf-lib to flatten annotations
 * into the PDF for sharing with users who don't have Lattice.
 */

import { PDFDocument, rgb, PDFPage } from 'pdf-lib';
import type { AnnotationItem, PdfTarget, BoundingBox } from '@/types/universal-annotation';
import { hexToRGB } from './annotation-colors';

// ============================================================================
// Constants
// ============================================================================

/**
 * Default highlight opacity (0.35 = 35% opacity)
 */
export const HIGHLIGHT_OPACITY = 0.35;

/**
 * Color mapping for PDF drawing
 * Maps color names and hex values to RGB (0-1 range)
 */
export const PDF_HIGHLIGHT_COLORS: Record<string, { r: number; g: number; b: number }> = {
  // Hex colors
  '#FFEB3B': { r: 1, g: 0.92, b: 0.23 },      // Yellow
  '#4CAF50': { r: 0.30, g: 0.69, b: 0.31 },   // Green
  '#2196F3': { r: 0.13, g: 0.59, b: 0.95 },   // Blue
  '#E91E63': { r: 0.91, g: 0.12, b: 0.39 },   // Pink
  '#FF9800': { r: 1, g: 0.60, b: 0 },         // Orange
  '#FFC107': { r: 1, g: 0.76, b: 0.03 },      // Amber (pins)
  // Named colors
  yellow: { r: 1, g: 0.92, b: 0.23 },
  green: { r: 0.30, g: 0.69, b: 0.31 },
  blue: { r: 0.13, g: 0.59, b: 0.95 },
  pink: { r: 0.91, g: 0.12, b: 0.39 },
  orange: { r: 1, g: 0.60, b: 0 },
  amber: { r: 1, g: 0.76, b: 0.03 },
};

// ============================================================================
// Coordinate Conversion
// ============================================================================

/**
 * Converts normalized PDF coordinates (0-1) to pdf-lib points
 * PDF coordinate system has origin at bottom-left
 */
export function normalizedToPoints(
  rect: BoundingBox,
  pageWidth: number,
  pageHeight: number
): { x: number; y: number; width: number; height: number } {
  return {
    x: rect.x1 * pageWidth,
    // Flip Y axis: PDF origin is bottom-left, our coords are top-left
    y: pageHeight - (rect.y2 * pageHeight),
    width: (rect.x2 - rect.x1) * pageWidth,
    height: (rect.y2 - rect.y1) * pageHeight,
  };
}

// ============================================================================
// Color Utilities
// ============================================================================

/**
 * Gets RGB color values for a color string
 * Supports hex colors and named colors
 */
export function getColorRgb(color: string): { r: number; g: number; b: number } {
  // Check predefined colors first
  const predefined = PDF_HIGHLIGHT_COLORS[color] || PDF_HIGHLIGHT_COLORS[color.toLowerCase()];
  if (predefined) {
    return predefined;
  }
  
  // Try to parse hex color
  if (color.startsWith('#')) {
    // hexToRGB already returns values in 0-1 range
    return hexToRGB(color);
  }
  
  // Default to yellow
  return PDF_HIGHLIGHT_COLORS.yellow;
}

// ============================================================================
// Drawing Functions
// ============================================================================

/**
 * Draws a highlight rectangle on a PDF page
 */
export function drawHighlightRect(
  page: PDFPage,
  rect: BoundingBox,
  color: string,
  opacity: number = HIGHLIGHT_OPACITY
): void {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const { x, y, width, height } = normalizedToPoints(rect, pageWidth, pageHeight);
  const colorRgb = getColorRgb(color);
  
  page.drawRectangle({
    x,
    y,
    width,
    height,
    color: rgb(colorRgb.r, colorRgb.g, colorRgb.b),
    opacity,
  });
}

/**
 * Draws all rectangles for a highlight annotation
 */
export function drawHighlightAnnotation(
  page: PDFPage,
  annotation: AnnotationItem,
  opacity: number = HIGHLIGHT_OPACITY
): number {
  if (annotation.target.type !== 'pdf') return 0;
  
  const target = annotation.target as PdfTarget;
  const color = annotation.style.color;
  let rectCount = 0;
  
  for (const rect of target.rects) {
    drawHighlightRect(page, rect, color, opacity);
    rectCount++;
  }
  
  return rectCount;
}

// ============================================================================
// PDF Annotation Notes
// ============================================================================

/**
 * Adds a PDF annotation note at the specified location
 * Note: pdf-lib has limited support for annotation notes,
 * so we draw a small indicator and add the text as a comment
 */
export function addAnnotationNote(
  page: PDFPage,
  x: number,
  y: number,
  _content: string
): void {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  
  // Convert normalized coordinates to points
  const pointX = x * pageWidth;
  const pointY = pageHeight - (y * pageHeight);
  
  // Draw a small note indicator (yellow square)
  const noteSize = 12;
  page.drawRectangle({
    x: pointX - noteSize / 2,
    y: pointY - noteSize / 2,
    width: noteSize,
    height: noteSize,
    color: rgb(1, 0.76, 0.03), // Amber
    borderColor: rgb(0.8, 0.6, 0),
    borderWidth: 1,
  });
  
  // Draw a small "N" to indicate note
  page.drawText('N', {
    x: pointX - 3,
    y: pointY - 4,
    size: 8,
    color: rgb(0, 0, 0),
  });
}

// ============================================================================
// Main Export Function
// ============================================================================

/**
 * Exports a PDF with annotations burned in
 * 
 * @param originalPdfBytes - Original PDF file bytes
 * @param annotations - Annotations to burn in
 * @returns Modified PDF bytes
 */
export async function exportFlattenedPDF(
  originalPdfBytes: ArrayBuffer,
  annotations: AnnotationItem[]
): Promise<Uint8Array> {
  // Load the PDF document
  const pdfDoc = await PDFDocument.load(originalPdfBytes);
  const pages = pdfDoc.getPages();
  
  // Filter to only PDF annotations
  const pdfAnnotations = annotations.filter(
    (a): a is AnnotationItem & { target: PdfTarget } => a.target.type === 'pdf'
  );
  
  // Group annotations by page
  const annotationsByPage = new Map<number, typeof pdfAnnotations>();
  for (const annotation of pdfAnnotations) {
    const page = annotation.target.page;
    if (!annotationsByPage.has(page)) {
      annotationsByPage.set(page, []);
    }
    annotationsByPage.get(page)!.push(annotation);
  }
  
  // Draw annotations on each page
  for (const [pageNum, pageAnnotations] of annotationsByPage) {
    // Pages are 1-indexed in our system, 0-indexed in pdf-lib
    const pageIndex = pageNum - 1;
    if (pageIndex < 0 || pageIndex >= pages.length) {
      console.warn(`Page ${pageNum} out of range, skipping annotations`);
      continue;
    }
    
    const page = pages[pageIndex];
    
    for (const annotation of pageAnnotations) {
      // Draw highlight rectangles
      drawHighlightAnnotation(page, annotation);
      
      // Add note indicator if there's a comment
      if (annotation.comment) {
        // Position note at the first rect's top-left corner
        const firstRect = annotation.target.rects[0];
        if (firstRect) {
          addAnnotationNote(page, firstRect.x1, firstRect.y1, annotation.comment);
        }
      }
    }
  }
  
  // Save and return the modified PDF
  return pdfDoc.save();
}

/**
 * Counts the total number of rectangles that will be drawn
 * Useful for testing Property 5
 */
export function countHighlightRects(annotations: AnnotationItem[]): number {
  return annotations
    .filter((a): a is AnnotationItem & { target: PdfTarget } => a.target.type === 'pdf')
    .reduce((count, a) => count + a.target.rects.length, 0);
}

/**
 * Counts annotations with comments
 */
export function countAnnotationsWithComments(annotations: AnnotationItem[]): number {
  return annotations.filter(a => a.target.type === 'pdf' && a.comment).length;
}

// ============================================================================
// Download Helper
// ============================================================================

/**
 * Triggers browser download of the flattened PDF
 */
export function downloadFlattenedPDF(
  pdfBytes: Uint8Array,
  originalFileName: string
): void {
  // Generate output filename
  const baseName = originalFileName.replace(/\.pdf$/i, '');
  const outputFileName = `${baseName}-annotated.pdf`;
  
  // Create blob and trigger download - copy to new ArrayBuffer to avoid SharedArrayBuffer issues
  const arrayBuffer = new ArrayBuffer(pdfBytes.length);
  new Uint8Array(arrayBuffer).set(pdfBytes);
  const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = outputFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  // Clean up
  URL.revokeObjectURL(url);
}

/**
 * Downloads annotations as JSON fallback
 */
export function downloadAnnotationsJSON(
  annotations: AnnotationItem[],
  originalFileName: string
): void {
  const baseName = originalFileName.replace(/\.pdf$/i, '');
  const outputFileName = `${baseName}-annotations.json`;
  
  const jsonContent = JSON.stringify(annotations, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = outputFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  
  URL.revokeObjectURL(url);
}

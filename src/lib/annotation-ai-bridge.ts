/**
 * Annotation AI Bridge
 * 
 * Exports annotations in a clean text format suitable for AI/RAG usage.
 * Provides structured context about annotations for language models.
 */

import type { AnnotationItem, AnnotationTarget } from '../types/universal-annotation';

// ============================================================================
// Location Context Formatting
// ============================================================================

/**
 * Formats the location context for an annotation target
 * 
 * @param target - Annotation target
 * @returns Location string (e.g., "Page 1:", "Line 42:", "Image region:")
 */
function formatLocationContext(target: AnnotationTarget): string {
  switch (target.type) {
    case 'pdf':
      return `Page ${target.page}:`;
    case 'code_line':
      return `Line ${target.line}:`;
    case 'image':
      return 'Image region:';
    case 'text_anchor':
      return `Element ${target.elementId}:`;
    default:
      return 'Unknown location:';
  }
}

/**
 * Formats the style type for display
 * 
 * @param styleType - Annotation style type
 * @returns Formatted style string in brackets (e.g., "[Highlight]")
 */
function formatStyleType(styleType: string): string {
  // Capitalize first letter
  const capitalized = styleType.charAt(0).toUpperCase() + styleType.slice(1);
  return `[${capitalized}]`;
}

// ============================================================================
// Single Annotation Formatting
// ============================================================================

/**
 * Formats a single annotation for AI export
 * 
 * Format: "Location: [Style] 'content' - Note: 'comment'"
 * 
 * @param annotation - Annotation to format
 * @returns Formatted string for AI consumption
 */
export function formatAnnotationForAI(annotation: AnnotationItem): string {
  const parts: string[] = [];
  
  // Add location context
  parts.push(formatLocationContext(annotation.target));
  
  // Add style type
  parts.push(formatStyleType(annotation.style.type));
  
  // Add content in quotes (if present)
  if (annotation.content && annotation.content.length > 0) {
    parts.push(`'${annotation.content}'`);
  }
  
  // Build the main line
  let result = parts.join(' ');
  
  // Append comment if present
  if (annotation.comment && annotation.comment.length > 0) {
    result += ` - Note: '${annotation.comment}'`;
  }
  
  return result;
}

// ============================================================================
// Batch Export Functions
// ============================================================================

/**
 * Exports all annotations in a clean text format for AI/RAG usage
 * 
 * Example output:
 * "Page 1: [Highlight] 'Quantum entanglement is...' - Note: 'Check this citation'
 *  Line 42: [Underline] 'function processData()'
 *  Image region: [Area] 'Figure 3 diagram'"
 * 
 * @param annotations - Array of annotations to export
 * @returns Formatted text summary, empty string if no annotations
 */
export function exportAnnotationsForAI(annotations: AnnotationItem[]): string {
  if (!annotations || annotations.length === 0) {
    return '';
  }
  
  return annotations
    .map(formatAnnotationForAI)
    .join('\n');
}

/**
 * Exports annotations grouped by target type
 * 
 * @param annotations - Array of annotations to export
 * @returns Object with formatted strings per target type
 */
export function exportAnnotationsGroupedByType(
  annotations: AnnotationItem[]
): Record<string, string> {
  const groups: Record<string, AnnotationItem[]> = {};
  
  for (const annotation of annotations) {
    const type = annotation.target.type;
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(annotation);
  }
  
  const result: Record<string, string> = {};
  
  for (const [type, items] of Object.entries(groups)) {
    result[type] = exportAnnotationsForAI(items);
  }
  
  return result;
}

/**
 * Exports annotations with additional metadata for structured AI consumption
 * 
 * @param annotations - Array of annotations to export
 * @param fileId - File identifier
 * @returns Structured export object
 */
export function exportAnnotationsStructured(
  annotations: AnnotationItem[],
  fileId: string
): {
  fileId: string;
  totalCount: number;
  summary: string;
  byType: Record<string, { count: number; formatted: string }>;
} {
  const byType: Record<string, { count: number; formatted: string }> = {};
  
  // Group by type
  const groups: Record<string, AnnotationItem[]> = {};
  for (const annotation of annotations) {
    const type = annotation.target.type;
    if (!groups[type]) {
      groups[type] = [];
    }
    groups[type].push(annotation);
  }
  
  // Format each group
  for (const [type, items] of Object.entries(groups)) {
    byType[type] = {
      count: items.length,
      formatted: exportAnnotationsForAI(items),
    };
  }
  
  return {
    fileId,
    totalCount: annotations.length,
    summary: exportAnnotationsForAI(annotations),
    byType,
  };
}

// ============================================================================
// Filtering Utilities
// ============================================================================

/**
 * Exports only annotations with comments (notes)
 * 
 * @param annotations - Array of annotations to filter and export
 * @returns Formatted text of annotations with comments
 */
export function exportAnnotationsWithComments(annotations: AnnotationItem[]): string {
  const withComments = annotations.filter(
    a => a.comment && a.comment.length > 0
  );
  return exportAnnotationsForAI(withComments);
}

/**
 * Exports annotations for a specific page (PDF only)
 * 
 * @param annotations - Array of annotations to filter and export
 * @param page - Page number to filter by
 * @returns Formatted text of annotations on the specified page
 */
export function exportAnnotationsForPage(
  annotations: AnnotationItem[],
  page: number
): string {
  const pageAnnotations = annotations.filter(
    a => a.target.type === 'pdf' && a.target.page === page
  );
  return exportAnnotationsForAI(pageAnnotations);
}

/**
 * Exports annotations for a specific line range (code only)
 * 
 * @param annotations - Array of annotations to filter and export
 * @param startLine - Start line (inclusive)
 * @param endLine - End line (inclusive)
 * @returns Formatted text of annotations in the line range
 */
export function exportAnnotationsForLineRange(
  annotations: AnnotationItem[],
  startLine: number,
  endLine: number
): string {
  const lineAnnotations = annotations.filter(
    a => a.target.type === 'code_line' && 
         a.target.line >= startLine && 
         a.target.line <= endLine
  );
  return exportAnnotationsForAI(lineAnnotations);
}

/**
 * Annotation Backlinks Service
 * 
 * Scans notes for annotation references and tracks backlinks.
 * Supports [[file.pdf#ann-uuid]] syntax for linking to PDF annotations.
 * 
 * Requirements: 10.3, 10.5
 */

// ============================================================================
// Types
// ============================================================================

export interface AnnotationBacklink {
  /** The note file that contains the reference */
  sourceFile: string;
  /** Line number in the source file */
  lineNumber: number;
  /** Context around the reference (surrounding text) */
  context: string;
  /** The annotation ID being referenced */
  annotationId: string;
  /** The PDF file containing the annotation */
  pdfFile: string;
  /** Display text (alias) if provided */
  displayText?: string;
}

export interface BacklinkIndex {
  /** Map from annotation ID to backlinks */
  byAnnotation: Map<string, AnnotationBacklink[]>;
  /** Map from PDF file to annotation IDs with backlinks */
  byPdfFile: Map<string, Set<string>>;
  /** Last scan timestamp */
  lastScan: number;
}

// ============================================================================
// Regex Patterns
// ============================================================================

/**
 * Pattern to match annotation links: [[file.pdf#ann-uuid]] or [[file.pdf#ann-uuid|alias]]
 */
const ANNOTATION_LINK_PATTERN = /\[\[([^\]|#]+\.pdf)#(ann-[a-f0-9-]+)(?:\|([^\]]+))?\]\]/gi;

// ============================================================================
// Backlink Index
// ============================================================================

let backlinkIndex: BacklinkIndex = {
  byAnnotation: new Map(),
  byPdfFile: new Map(),
  lastScan: 0,
};

/**
 * Get the current backlink index
 */
export function getBacklinkIndex(): BacklinkIndex {
  return backlinkIndex;
}

/**
 * Clear the backlink index
 */
export function clearBacklinkIndex(): void {
  backlinkIndex = {
    byAnnotation: new Map(),
    byPdfFile: new Map(),
    lastScan: 0,
  };
}

// ============================================================================
// Scanning Functions
// ============================================================================

/**
 * Extract annotation references from a single note's content
 */
export function extractAnnotationReferences(
  content: string,
  sourceFile: string
): AnnotationBacklink[] {
  const backlinks: AnnotationBacklink[] = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    
    // Reset regex lastIndex for each line
    ANNOTATION_LINK_PATTERN.lastIndex = 0;
    
    while ((match = ANNOTATION_LINK_PATTERN.exec(line)) !== null) {
      const pdfFile = match[1];
      const annotationId = match[2];
      const displayText = match[3];
      
      // Get context (surrounding text, max 100 chars)
      const contextStart = Math.max(0, match.index - 30);
      const contextEnd = Math.min(line.length, match.index + match[0].length + 30);
      let context = line.slice(contextStart, contextEnd);
      if (contextStart > 0) context = '...' + context;
      if (contextEnd < line.length) context = context + '...';
      
      backlinks.push({
        sourceFile,
        lineNumber: i + 1,
        context,
        annotationId,
        pdfFile,
        displayText,
      });
    }
  }
  
  return backlinks;
}

/**
 * Add backlinks from a note to the index
 */
export function indexNoteBacklinks(
  content: string,
  sourceFile: string
): void {
  const backlinks = extractAnnotationReferences(content, sourceFile);
  
  for (const backlink of backlinks) {
    // Index by annotation ID
    if (!backlinkIndex.byAnnotation.has(backlink.annotationId)) {
      backlinkIndex.byAnnotation.set(backlink.annotationId, []);
    }
    
    // Check for duplicates (same source file and line)
    const existing = backlinkIndex.byAnnotation.get(backlink.annotationId)!;
    const isDuplicate = existing.some(
      b => b.sourceFile === backlink.sourceFile && b.lineNumber === backlink.lineNumber
    );
    
    if (!isDuplicate) {
      existing.push(backlink);
    }
    
    // Index by PDF file
    if (!backlinkIndex.byPdfFile.has(backlink.pdfFile)) {
      backlinkIndex.byPdfFile.set(backlink.pdfFile, new Set());
    }
    backlinkIndex.byPdfFile.get(backlink.pdfFile)!.add(backlink.annotationId);
  }
  
  backlinkIndex.lastScan = Date.now();
}

/**
 * Remove backlinks from a specific source file
 */
export function removeNoteBacklinks(sourceFile: string): void {
  // Remove from byAnnotation
  for (const [annotationId, backlinks] of backlinkIndex.byAnnotation) {
    const filtered = backlinks.filter(b => b.sourceFile !== sourceFile);
    if (filtered.length === 0) {
      backlinkIndex.byAnnotation.delete(annotationId);
    } else {
      backlinkIndex.byAnnotation.set(annotationId, filtered);
    }
  }
  
  // Rebuild byPdfFile index
  backlinkIndex.byPdfFile.clear();
  for (const [annotationId, backlinks] of backlinkIndex.byAnnotation) {
    for (const backlink of backlinks) {
      if (!backlinkIndex.byPdfFile.has(backlink.pdfFile)) {
        backlinkIndex.byPdfFile.set(backlink.pdfFile, new Set());
      }
      backlinkIndex.byPdfFile.get(backlink.pdfFile)!.add(annotationId);
    }
  }
}

// ============================================================================
// Query Functions
// ============================================================================

/**
 * Get all backlinks for a specific annotation
 */
export function getBacklinksForAnnotation(annotationId: string): AnnotationBacklink[] {
  return backlinkIndex.byAnnotation.get(annotationId) || [];
}

/**
 * Get all annotation IDs with backlinks for a PDF file
 */
export function getAnnotationsWithBacklinks(pdfFile: string): string[] {
  const annotationIds = backlinkIndex.byPdfFile.get(pdfFile);
  return annotationIds ? Array.from(annotationIds) : [];
}

/**
 * Check if an annotation has any backlinks
 */
export function hasBacklinks(annotationId: string): boolean {
  const backlinks = backlinkIndex.byAnnotation.get(annotationId);
  return backlinks !== undefined && backlinks.length > 0;
}

/**
 * Get backlink count for an annotation
 */
export function getBacklinkCount(annotationId: string): number {
  const backlinks = backlinkIndex.byAnnotation.get(annotationId);
  return backlinks?.length || 0;
}

// ============================================================================
// Batch Scanning
// ============================================================================

/**
 * Scan multiple notes and build the backlink index
 */
export function scanNotesForBacklinks(
  notes: Array<{ path: string; content: string }>
): void {
  clearBacklinkIndex();
  
  for (const note of notes) {
    indexNoteBacklinks(note.content, note.path);
  }
}

/**
 * Generate a copy-friendly annotation reference
 */
export function generateAnnotationReference(
  pdfFile: string,
  annotationId: string,
  displayText?: string
): string {
  if (displayText) {
    return `[[${pdfFile}#${annotationId}|${displayText}]]`;
  }
  return `[[${pdfFile}#${annotationId}]]`;
}

/**
 * Annotation Migration Utilities
 * 
 * Handles migration from legacy PDF annotation format (version 1)
 * to the new universal annotation format (version 2).
 */

import type { LatticeAnnotation, AnnotationFile } from '../types/annotation';
import { isAnnotationFile } from '../types/annotation';
import type { 
  AnnotationItem, 
  UniversalAnnotationFile,
  PdfTarget,
  BoundingBox,
  AnnotationStyleType
} from '../types/universal-annotation';

// ============================================================================
// Legacy Format Detection
// ============================================================================

/**
 * Detects if a parsed JSON object is a legacy annotation file (version 1)
 * 
 * @param data - Parsed JSON data
 * @returns True if the data is a legacy annotation file
 */
export function isLegacyAnnotationFile(data: unknown): data is AnnotationFile {
  if (typeof data !== 'object' || data === null) return false;
  const file = data as Record<string, unknown>;
  
  // Check for version 1 signature
  if (file.version !== 1) return false;
  
  // Use the existing type guard for full validation
  return isAnnotationFile(data);
}

/**
 * Detects if raw JSON string contains legacy annotations
 * 
 * @param json - Raw JSON string
 * @returns True if the JSON represents a legacy annotation file
 */
export function isLegacyAnnotationJson(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    return isLegacyAnnotationFile(parsed);
  } catch {
    return false;
  }
}

// ============================================================================
// Migration Functions
// ============================================================================

/**
 * Maps legacy annotation type to new style type
 */
function mapLegacyTypeToStyleType(legacyType: string): AnnotationStyleType {
  switch (legacyType) {
    case 'text':
      return 'highlight';
    case 'area':
      return 'area';
    case 'textNote':
      return 'text';
    default:
      return 'highlight';
  }
}

/**
 * Converts legacy BoundingRect to new BoundingBox format
 * Legacy format includes width/height, new format only has coordinates
 */
function convertBoundingRect(rect: { x1: number; y1: number; x2: number; y2: number }): BoundingBox {
  return {
    x1: rect.x1,
    y1: rect.y1,
    x2: rect.x2,
    y2: rect.y2,
  };
}

/**
 * Converts a single legacy LatticeAnnotation to new AnnotationItem format
 * 
 * @param legacy - Legacy annotation to convert
 * @returns New format AnnotationItem
 */
export function migrateLegacyAnnotation(legacy: LatticeAnnotation): AnnotationItem {
  // Build PDF target from legacy position data
  const pdfTarget: PdfTarget = {
    type: 'pdf',
    page: legacy.page,
    rects: legacy.position.rects.map(convertBoundingRect),
  };
  
  // Build the new annotation item
  const item: AnnotationItem = {
    id: legacy.id,
    target: pdfTarget,
    style: {
      color: legacy.color,
      type: mapLegacyTypeToStyleType(legacy.type),
    },
    author: 'migrated', // Legacy format didn't have author
    createdAt: legacy.timestamp,
  };
  
  // Add optional content if present
  if (legacy.content.text) {
    item.content = legacy.content.text;
  }
  
  // Add comment if present and non-empty
  if (legacy.comment && legacy.comment.length > 0) {
    item.comment = legacy.comment;
  }
  
  return item;
}

/**
 * Migrates an entire legacy annotation file to the new universal format
 * 
 * @param legacyFile - Legacy annotation file to migrate
 * @returns New format UniversalAnnotationFile
 */
export function migrateLegacyAnnotationFile(legacyFile: AnnotationFile): UniversalAnnotationFile {
  return {
    version: 2,
    fileId: legacyFile.fileId,
    fileType: 'pdf', // Legacy format was PDF-only
    annotations: legacyFile.annotations.map(migrateLegacyAnnotation),
    lastModified: legacyFile.lastModified,
  };
}

/**
 * Attempts to load and migrate a legacy annotation file from JSON
 * Returns null if the JSON is not a valid legacy format
 * 
 * @param json - Raw JSON string
 * @returns Migrated UniversalAnnotationFile or null
 */
export function tryMigrateLegacyJson(json: string): UniversalAnnotationFile | null {
  try {
    const parsed = JSON.parse(json);
    
    if (!isLegacyAnnotationFile(parsed)) {
      return null;
    }
    
    return migrateLegacyAnnotationFile(parsed);
  } catch {
    return null;
  }
}

// ============================================================================
// Combined Loading with Migration Support
// ============================================================================

/**
 * Result of loading an annotation file with migration support
 */
export interface LoadAnnotationResult {
  file: UniversalAnnotationFile | null;
  wasMigrated: boolean;
  errors: string[];
}

/**
 * Loads an annotation file, automatically migrating from legacy format if needed
 * 
 * @param json - Raw JSON string from annotation file
 * @param defaultFileId - File ID to use if creating new file
 * @returns Load result with file, migration status, and any errors
 */
export function loadAnnotationWithMigration(
  json: string,
  defaultFileId: string
): LoadAnnotationResult {
  try {
    const parsed = JSON.parse(json);
    
    // Check if it's a legacy file
    if (isLegacyAnnotationFile(parsed)) {
      const migrated = migrateLegacyAnnotationFile(parsed);
      return {
        file: migrated,
        wasMigrated: true,
        errors: [],
      };
    }
    
    // Check if it's already a universal file
    if (typeof parsed === 'object' && parsed !== null && parsed.version === 2) {
      // Import validation function
      const { validateUniversalAnnotationFile } = require('../types/universal-annotation');
      const validation = validateUniversalAnnotationFile(parsed);
      
      if (validation.valid) {
        return {
          file: parsed as UniversalAnnotationFile,
          wasMigrated: false,
          errors: [],
        };
      }
      
      return {
        file: null,
        wasMigrated: false,
        errors: validation.errors,
      };
    }
    
    // Unknown format
    return {
      file: null,
      wasMigrated: false,
      errors: ['Unknown annotation file format'],
    };
  } catch (error) {
    return {
      file: null,
      wasMigrated: false,
      errors: [`JSON parse error: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}

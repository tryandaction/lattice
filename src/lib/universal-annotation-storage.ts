/**
 * Universal Annotation Storage Utilities
 * 
 * Handles file ID derivation, serialization, and file system operations
 * for storing universal annotations in sidecar JSON files.
 */

import type { 
  UniversalAnnotationFile, 
  AnnotationItem,
  AnnotationFileType 
} from '../types/universal-annotation';
import { 
  isUniversalAnnotationFile,
  validateUniversalAnnotationFile 
} from '../types/universal-annotation';

// ============================================================================
// Constants
// ============================================================================

/**
 * Directory name for storing annotation files
 */
export const ANNOTATIONS_DIR = '.lattice/annotations';

/**
 * Current annotation file version
 */
export const ANNOTATION_FILE_VERSION = 2;

// ============================================================================
// FileId Derivation
// ============================================================================

/**
 * Characters that are invalid in filenames across platforms
 */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/**
 * Derives a safe fileId from a file path
 * 
 * Converts a file path to a valid filename by:
 * - Replacing path separators with dashes
 * - Replacing spaces with underscores
 * - Removing invalid filename characters
 * 
 * @param filePath - Original file path
 * @returns Safe filename for use as fileId
 */
export function generateFileId(filePath: string): string {
  if (!filePath || filePath.trim().length === 0) {
    throw new Error('File path cannot be empty');
  }

  // Normalize path separators
  let fileId = filePath
    .replace(/\\/g, '/') // Convert Windows backslashes
    .replace(/^\/+/, '') // Remove leading slashes
    .replace(/\/+/g, '-') // Replace path separators with dashes
    .replace(/\s+/g, '_') // Replace spaces with underscores
    .replace(INVALID_FILENAME_CHARS, '') // Remove invalid chars
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^[-_]+/, '') // Remove leading dashes/underscores
    .replace(/[-_]+$/, ''); // Remove trailing dashes/underscores

  // Ensure we have a valid result
  if (fileId.length === 0) {
    throw new Error('File path resulted in empty fileId');
  }

  return fileId;
}

/**
 * Gets the annotation file path for a given fileId
 * 
 * @param fileId - The derived file ID
 * @returns Path to the annotation JSON file
 */
export function getAnnotationFilePath(fileId: string): string {
  return `${ANNOTATIONS_DIR}/${fileId}.json`;
}

// ============================================================================
// File Type Detection
// ============================================================================

/**
 * Detects the annotation file type from a file extension
 * 
 * @param filePath - File path or name
 * @returns Detected file type
 */
export function detectFileType(filePath: string): AnnotationFileType {
  const ext = filePath.toLowerCase().split('.').pop() || '';
  
  switch (ext) {
    case 'pdf':
      return 'pdf';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'bmp':
      return 'image';
    case 'pptx':
    case 'ppt':
      return 'pptx';
    case 'html':
    case 'htm':
      return 'html';
    case 'js':
    case 'ts':
    case 'jsx':
    case 'tsx':
    case 'py':
    case 'java':
    case 'c':
    case 'cpp':
    case 'h':
    case 'hpp':
    case 'cs':
    case 'go':
    case 'rs':
    case 'rb':
    case 'php':
    case 'swift':
    case 'kt':
    case 'scala':
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'sql':
    case 'json':
    case 'yaml':
    case 'yml':
    case 'xml':
    case 'css':
    case 'scss':
    case 'less':
    case 'md':
    case 'markdown':
      return 'code';
    default:
      return 'unknown';
  }
}

// ============================================================================
// Serialization
// ============================================================================

/**
 * Serializes a UniversalAnnotationFile to JSON string
 * 
 * @param file - UniversalAnnotationFile to serialize
 * @returns JSON string
 */
export function serializeAnnotationFile(file: UniversalAnnotationFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Deserializes a JSON string to UniversalAnnotationFile
 * Returns null for invalid or corrupted data
 * 
 * @param json - JSON string to parse
 * @returns UniversalAnnotationFile or null if invalid
 */
export function deserializeAnnotationFile(json: string): UniversalAnnotationFile | null {
  try {
    const parsed = JSON.parse(json);
    
    // Validate the structure
    if (!isUniversalAnnotationFile(parsed)) {
      console.warn('Invalid annotation file structure');
      return null;
    }
    
    return parsed;
  } catch (error) {
    console.warn('Failed to parse annotation file:', error);
    return null;
  }
}

/**
 * Safely deserializes with detailed validation
 * Returns validation result with errors if invalid
 * 
 * @param json - JSON string to parse
 * @returns Object with file (or null) and validation errors
 */
export function deserializeAnnotationFileWithValidation(json: string): {
  file: UniversalAnnotationFile | null;
  errors: string[];
} {
  try {
    const parsed = JSON.parse(json);
    const validation = validateUniversalAnnotationFile(parsed);
    
    if (!validation.valid) {
      return { file: null, errors: validation.errors };
    }
    
    return { file: parsed as UniversalAnnotationFile, errors: [] };
  } catch (error) {
    return {
      file: null,
      errors: [`JSON parse error: ${error instanceof Error ? error.message : 'Unknown error'}`],
    };
  }
}

// ============================================================================
// File Creation Utilities
// ============================================================================

/**
 * Creates an empty UniversalAnnotationFile
 * 
 * @param fileId - File identifier
 * @param fileType - Type of file being annotated
 * @returns New empty annotation file
 */
export function createUniversalAnnotationFile(
  fileId: string,
  fileType: AnnotationFileType = 'unknown'
): UniversalAnnotationFile {
  return {
    version: 2,
    fileId,
    fileType,
    annotations: [],
    lastModified: Date.now(),
  };
}

// ============================================================================
// File System Operations
// ============================================================================

/**
 * Ensures the annotations directory exists
 * Creates .lattice/annotations/ if it doesn't exist
 * 
 * @param rootHandle - Root directory handle
 * @returns Directory handle for annotations folder
 */
export async function ensureAnnotationsDirectory(
  rootHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle> {
  // Create .lattice directory if needed
  const latticeDir = await rootHandle.getDirectoryHandle('.lattice', { create: true });
  
  // Create annotations subdirectory if needed
  const annotationsDir = await latticeDir.getDirectoryHandle('annotations', { create: true });
  
  return annotationsDir;
}

/**
 * Loads annotations for a file from disk
 * Returns empty annotation file if not found or corrupted
 * 
 * @param fileId - The file ID to load annotations for
 * @param rootHandle - Root directory handle
 * @param fileType - Type of file being annotated
 * @returns UniversalAnnotationFile (empty if not found)
 */
export async function loadAnnotationsFromDisk(
  fileId: string,
  rootHandle: FileSystemDirectoryHandle,
  fileType: AnnotationFileType = 'unknown'
): Promise<UniversalAnnotationFile> {
  try {
    const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
    const fileName = `${fileId}.json`;
    
    try {
      const fileHandle = await annotationsDir.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const content = await file.text();
      
      const annotationFile = deserializeAnnotationFile(content);
      
      if (annotationFile) {
        return annotationFile;
      }
      
      // File exists but is corrupted - return empty
      console.warn(`Corrupted annotation file for ${fileId}, starting fresh`);
      return createUniversalAnnotationFile(fileId, fileType);
    } catch (error) {
      // File doesn't exist - return empty
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        return createUniversalAnnotationFile(fileId, fileType);
      }
      throw error;
    }
  } catch (error) {
    console.error('Failed to load annotations:', error);
    return createUniversalAnnotationFile(fileId, fileType);
  }
}

/**
 * Saves annotations to disk
 * 
 * @param annotationFile - UniversalAnnotationFile to save
 * @param rootHandle - Root directory handle
 */
export async function saveAnnotationsToDisk(
  annotationFile: UniversalAnnotationFile,
  rootHandle: FileSystemDirectoryHandle
): Promise<void> {
  const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
  const fileName = `${annotationFile.fileId}.json`;
  
  // Update lastModified timestamp
  const fileToSave: UniversalAnnotationFile = {
    ...annotationFile,
    lastModified: Date.now(),
  };
  
  const fileHandle = await annotationsDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  
  try {
    await writable.write(serializeAnnotationFile(fileToSave));
    await writable.close();
  } catch (error) {
    await writable.abort();
    throw error;
  }
}

/**
 * Deletes annotation file from disk
 * 
 * @param fileId - The file ID to delete annotations for
 * @param rootHandle - Root directory handle
 * @returns True if deleted, false if not found
 */
export async function deleteAnnotationsFromDisk(
  fileId: string,
  rootHandle: FileSystemDirectoryHandle
): Promise<boolean> {
  try {
    const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
    const fileName = `${fileId}.json`;
    
    await annotationsDir.removeEntry(fileName);
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') {
      return false;
    }
    throw error;
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Creates a debounced save function
 * 
 * @param delay - Debounce delay in milliseconds
 * @returns Debounced save function
 */
export function createDebouncedSave(delay: number = 1000) {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingPromise: Promise<void> | null = null;
  let pendingResolve: (() => void) | null = null;
  let pendingReject: ((error: Error) => void) | null = null;

  return async function debouncedSave(
    annotationFile: UniversalAnnotationFile,
    rootHandle: FileSystemDirectoryHandle
  ): Promise<void> {
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Create new promise if none pending
    if (!pendingPromise) {
      pendingPromise = new Promise((resolve, reject) => {
        pendingResolve = resolve;
        pendingReject = reject;
      });
    }

    // Set new timeout
    timeoutId = setTimeout(async () => {
      try {
        await saveAnnotationsToDisk(annotationFile, rootHandle);
        pendingResolve?.();
      } catch (error) {
        pendingReject?.(error instanceof Error ? error : new Error('Save failed'));
      } finally {
        pendingPromise = null;
        pendingResolve = null;
        pendingReject = null;
        timeoutId = null;
      }
    }, delay);

    return pendingPromise;
  };
}

/**
 * Saves with retry logic and exponential backoff
 * 
 * @param annotationFile - UniversalAnnotationFile to save
 * @param rootHandle - Root directory handle
 * @param maxRetries - Maximum number of retry attempts
 * @returns True if saved successfully
 */
export async function saveWithRetry(
  annotationFile: UniversalAnnotationFile,
  rootHandle: FileSystemDirectoryHandle,
  maxRetries: number = 3
): Promise<boolean> {
  let delay = 200; // Initial delay in ms

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await saveAnnotationsToDisk(annotationFile, rootHandle);
      return true;
    } catch (error) {
      console.warn(`Save attempt ${attempt + 1} failed:`, error);
      
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      }
    }
  }

  return false;
}

/**
 * Universal Annotation System Hook
 * 
 * Provides centralized annotation state management with auto-save,
 * supporting all file types (PDF, Image, PPTX, Code, HTML).
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { 
  AnnotationItem, 
  UniversalAnnotationFile,
  AnnotationTarget,
  AnnotationFileType
} from '../types/universal-annotation';
import { validateAnnotationItem } from '../types/universal-annotation';
import {
  generateFileId,
  detectFileType,
  createUniversalAnnotationFile,
  saveWithRetry,
  ensureAnnotationsDirectory,
  serializeAnnotationFile,
  deserializeAnnotationFile,
} from '../lib/universal-annotation-storage';
import {
  isLegacyAnnotationFile,
  migrateLegacyAnnotationFile,
} from '../lib/annotation-migration';

// ============================================================================
// Types
// ============================================================================

export interface UseAnnotationSystemOptions {
  /** File handle for the annotated file */
  fileHandle: FileSystemFileHandle;
  /** Root directory handle for storage */
  rootHandle: FileSystemDirectoryHandle;
  /** Optional file type override */
  fileType?: AnnotationFileType;
  /** Debounce delay for auto-save (default: 1000ms) */
  saveDelay?: number;
  /** Author identifier for new annotations */
  author?: string;
}

export interface UseAnnotationSystemReturn {
  // State
  annotations: AnnotationItem[];
  isLoading: boolean;
  error: string | null;
  pendingSave: boolean;
  fileId: string | null;
  
  // Actions
  addAnnotation: (annotation: Omit<AnnotationItem, 'id' | 'createdAt'>) => string | null;
  updateAnnotation: (id: string, updates: Partial<Omit<AnnotationItem, 'id'>>) => boolean;
  deleteAnnotation: (id: string) => boolean;
  
  // Navigation
  scrollToAnnotation: (id: string) => void;
  
  // Selectors
  getAnnotationById: (id: string) => AnnotationItem | undefined;
  getAnnotationsByTarget: <T extends AnnotationTarget['type']>(
    type: T
  ) => AnnotationItem[];
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generates a UUID v4
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Navigation event for scroll-to-annotation
 */
export interface AnnotationNavigationEvent {
  annotationId: string;
  target: AnnotationTarget;
}

/**
 * Custom event name for annotation navigation
 */
export const ANNOTATION_NAVIGATION_EVENT = 'lattice:annotation-navigate';

/**
 * Emits a navigation event for scroll-to-annotation
 */
function emitNavigationEvent(annotation: AnnotationItem): void {
  const event = new CustomEvent<AnnotationNavigationEvent>(ANNOTATION_NAVIGATION_EVENT, {
    detail: {
      annotationId: annotation.id,
      target: annotation.target,
    },
  });
  window.dispatchEvent(event);
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook for managing universal annotations with auto-save
 * 
 * Features:
 * - Polymorphic annotation support (PDF, Image, Code, etc.)
 * - Automatic loading and migration from legacy format
 * - Debounced auto-save with retry logic
 * - Navigation events for scroll-to-annotation
 */
export function useAnnotationSystem({
  fileHandle,
  rootHandle,
  fileType: fileTypeOverride,
  saveDelay = 1000,
  author = 'user',
}: UseAnnotationSystemOptions): UseAnnotationSystemReturn {
  // State
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [detectedFileType, setDetectedFileType] = useState<AnnotationFileType>('unknown');
  
  // Refs for debounced save
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const annotationFileRef = useRef<UniversalAnnotationFile | null>(null);
  
  // Determine file type
  const effectiveFileType = fileTypeOverride || detectedFileType;

  // Load annotations on mount
  useEffect(() => {
    let cancelled = false;
    
    async function loadAnnotations() {
      setIsLoading(true);
      setError(null);
      
      try {
        // Generate file ID from file handle name
        const fileName = fileHandle.name;
        const derivedFileId = generateFileId(fileName);
        setFileId(derivedFileId);
        
        // Detect file type
        const detected = detectFileType(fileName);
        setDetectedFileType(detected);
        
        // Try to load existing annotations
        const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
        const annotationFileName = `${derivedFileId}.json`;
        
        try {
          const annotationFileHandle = await annotationsDir.getFileHandle(annotationFileName);
          const file = await annotationFileHandle.getFile();
          const content = await file.text();
          
          // Try to parse the content
          const parsed = JSON.parse(content);
          
          // Check for legacy format and migrate
          if (isLegacyAnnotationFile(parsed)) {
            const migrated = migrateLegacyAnnotationFile(parsed);
            
            if (!cancelled) {
              annotationFileRef.current = migrated;
              setAnnotations(migrated.annotations);
              
              // Save migrated file
              await saveWithRetry(migrated, rootHandle);
            }
          } else {
            // Try to load as universal format
            const universalFile = deserializeAnnotationFile(content);
            
            if (universalFile && !cancelled) {
              annotationFileRef.current = universalFile;
              setAnnotations(universalFile.annotations);
            } else if (!cancelled) {
              // Invalid file, start fresh
              const newFile = createUniversalAnnotationFile(derivedFileId, fileTypeOverride || detected);
              annotationFileRef.current = newFile;
              setAnnotations([]);
            }
          }
        } catch (err) {
          // File doesn't exist or is corrupted - start fresh
          if (!cancelled) {
            const newFile = createUniversalAnnotationFile(derivedFileId, fileTypeOverride || detected);
            annotationFileRef.current = newFile;
            setAnnotations([]);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load annotations');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    
    loadAnnotations();
    
    return () => {
      cancelled = true;
    };
  }, [fileHandle, rootHandle, fileTypeOverride]);

  // Debounced save function
  const scheduleSave = useCallback((newAnnotations: AnnotationItem[]) => {
    if (!fileId || !annotationFileRef.current) return;
    
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    setPendingSave(true);
    
    // Update the annotation file reference
    annotationFileRef.current = {
      ...annotationFileRef.current,
      annotations: newAnnotations,
      lastModified: Date.now(),
    };
    
    // Schedule save
    saveTimeoutRef.current = setTimeout(async () => {
      if (!annotationFileRef.current) return;
      
      const success = await saveWithRetry(annotationFileRef.current, rootHandle);
      
      if (!success) {
        setError('Failed to save annotations after multiple retries');
      }
      
      setPendingSave(false);
    }, saveDelay);
  }, [fileId, rootHandle, saveDelay]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Add annotation
  const addAnnotation = useCallback((
    annotation: Omit<AnnotationItem, 'id' | 'createdAt'>
  ): string | null => {
    // Create full annotation with generated fields
    const newAnnotation: AnnotationItem = {
      ...annotation,
      id: generateUUID(),
      createdAt: Date.now(),
    };
    
    // Validate before adding
    const validation = validateAnnotationItem(newAnnotation);
    if (!validation.valid) {
      setError(`Invalid annotation: ${validation.errors.join(', ')}`);
      return null;
    }
    
    setAnnotations(prev => {
      const updated = [...prev, newAnnotation];
      scheduleSave(updated);
      return updated;
    });
    
    return newAnnotation.id;
  }, [scheduleSave]);

  // Update annotation
  const updateAnnotation = useCallback((
    id: string,
    updates: Partial<Omit<AnnotationItem, 'id'>>
  ): boolean => {
    let success = false;
    
    setAnnotations(prev => {
      const index = prev.findIndex(a => a.id === id);
      if (index === -1) return prev;
      
      const updated = { ...prev[index], ...updates };
      
      // Validate updated annotation
      const validation = validateAnnotationItem(updated);
      if (!validation.valid) {
        setError(`Invalid annotation update: ${validation.errors.join(', ')}`);
        return prev;
      }
      
      const newAnnotations = [...prev];
      newAnnotations[index] = updated;
      
      scheduleSave(newAnnotations);
      success = true;
      return newAnnotations;
    });
    
    return success;
  }, [scheduleSave]);

  // Delete annotation
  const deleteAnnotation = useCallback((id: string): boolean => {
    let success = false;
    
    setAnnotations(prev => {
      const index = prev.findIndex(a => a.id === id);
      if (index === -1) return prev;
      
      const newAnnotations = prev.filter(a => a.id !== id);
      scheduleSave(newAnnotations);
      success = true;
      return newAnnotations;
    });
    
    return success;
  }, [scheduleSave]);

  // Scroll to annotation
  const scrollToAnnotation = useCallback((id: string): void => {
    const annotation = annotations.find(a => a.id === id);
    if (annotation) {
      emitNavigationEvent(annotation);
    }
  }, [annotations]);

  // Get annotation by ID
  const getAnnotationById = useCallback((id: string): AnnotationItem | undefined => {
    return annotations.find(a => a.id === id);
  }, [annotations]);

  // Get annotations by target type
  const getAnnotationsByTarget = useCallback(<T extends AnnotationTarget['type']>(
    type: T
  ): AnnotationItem[] => {
    return annotations.filter(a => a.target.type === type);
  }, [annotations]);

  return {
    annotations,
    isLoading,
    error,
    pendingSave,
    fileId,
    addAnnotation,
    updateAnnotation,
    deleteAnnotation,
    scrollToAnnotation,
    getAnnotationById,
    getAnnotationsByTarget,
  };
}

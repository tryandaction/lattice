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
  detectFileType,
  createUniversalAnnotationFile,
  saveWithRetry,
  ensureAnnotationsDirectory,
  deserializeAnnotationFile,
  loadAnnotationsForFileIdentity,
  resolveAnnotationFileCandidates,
} from '../lib/universal-annotation-storage';
import {
  isLegacyAnnotationFile,
  migrateLegacyAnnotationFile,
} from '../lib/annotation-migration';
import { logger } from '../lib/logger';
import { resolveFileIdentity } from '@/lib/file-identity';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { ResolvedPdfDocumentBinding } from '@/lib/pdf-document-binding';

// ============================================================================
// Types
// ============================================================================

/**
 * Deep partial type for annotation updates
 * Allows partial updates to nested objects like style and target
 */
export type AnnotationUpdates = {
  target?: Partial<AnnotationItem['target']>;
  style?: Partial<AnnotationItem['style']>;
  content?: string;
  comment?: string;
  preview?: AnnotationItem['preview'];
  author?: string;
  createdAt?: number;
};

export interface UseAnnotationSystemOptions {
  /** File handle for the annotated file */
  fileHandle: FileSystemFileHandle;
  /** Full path relative to workspace root, used for stable fileId derivation */
  filePath?: string;
  /** Preferred stable storage id, used before path-derived fallback ids */
  storageFileId?: string | null;
  /** Delay loading until prerequisite metadata is ready */
  deferLoad?: boolean;
  /** Root directory handle for storage */
  rootHandle: FileSystemDirectoryHandle;
  /** Optional file type override */
  fileType?: AnnotationFileType;
  /** Optional resolved document binding for PDF annotations */
  binding?: ResolvedPdfDocumentBinding | null;
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
  updateAnnotation: (id: string, updates: AnnotationUpdates) => boolean;
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
  const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
  return `ann-${uuid}`;
}

/**
 * Navigation event for scroll-to-annotation
 */
export interface AnnotationNavigationEvent {
  annotationId: string;
  target: AnnotationTarget;
}

function dedupeAnnotationsById(annotations: AnnotationItem[]): AnnotationItem[] {
  const seen = new Set<string>();
  const deduped: AnnotationItem[] = [];

  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (seen.has(annotation.id)) {
      continue;
    }
    seen.add(annotation.id);
    deduped.unshift(annotation);
  }

  return deduped;
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
  filePath,
  storageFileId = null,
  deferLoad = false,
  rootHandle,
  fileType: fileTypeOverride,
  binding = null,
  saveDelay = 1000,
  author: _author = 'user',
}: UseAnnotationSystemOptions): UseAnnotationSystemReturn {
  const workspaceIdentity = useWorkspaceStore((state) => state.workspaceIdentity);
  // State
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSave, setPendingSave] = useState(false);
  const [fileId, setFileId] = useState<string | null>(null);
  const [_detectedFileType, setDetectedFileType] = useState<AnnotationFileType>('unknown');
  
  // Refs for debounced save
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const annotationFileRef = useRef<UniversalAnnotationFile | null>(null);
  
  // Load annotations on mount
  useEffect(() => {
    let cancelled = false;
    
    async function loadAnnotations() {
      if (deferLoad) {
        setIsLoading(false);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);
      
      try {
        const fileName = filePath || fileHandle.name;
        const preferredPath = (filePath && filePath.trim()) ? filePath : fileHandle.name;
        const candidateIds = binding?.storageCandidates ?? resolveAnnotationFileCandidates(fileHandle.name, filePath, storageFileId);
        const preferredFileId = binding?.canonicalStorageFileId ?? storageFileId ?? candidateIds[0];
        if (!preferredFileId) {
          throw new Error("Unable to derive annotation storage id");
        }
        setFileId(preferredFileId);
        
        // Detect file type
        const detected = detectFileType(fileName);
        setDetectedFileType(detected);
        
        // A resolved binding is the PDF identity source, but not the annotation content source.
        // The binding snapshot can be stale after edits, so always refresh current annotations from disk.
        if (binding && !cancelled) {
          const resolved = await loadAnnotationsForFileIdentity({
            rootHandle,
            fileIdentity: binding.fileIdentity,
            workspaceKey: workspaceIdentity?.workspaceKey ?? null,
            fileType: fileTypeOverride || detected,
          });
          const freshestAnnotationFile = resolved.source
            ? resolved.annotationFile
            : binding.annotationFile;
          const dedupedAnnotations = dedupeAnnotationsById(freshestAnnotationFile.annotations);
          annotationFileRef.current = {
            ...freshestAnnotationFile,
            annotations: dedupedAnnotations,
            fileId: preferredFileId,
            fileType: fileTypeOverride || detected,
          };
          setAnnotations(dedupedAnnotations);
          setError(null);
          return;
        }

        // Try to load existing annotations
        const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
        let loadedExistingFile = false;

        for (const candidateFileId of candidateIds) {
          const annotationFileName = `${candidateFileId}.json`;

          try {
            const annotationFileHandle = await annotationsDir.getFileHandle(annotationFileName);
            const file = await annotationFileHandle.getFile();
            const content = await file.text();

            let parsed: unknown;
            try {
              parsed = JSON.parse(content);
            } catch (parseErr) {
              logger.error(`[Annotations] Failed to parse annotation file ${annotationFileName}:`, parseErr);
              continue;
            }

            if (isLegacyAnnotationFile(parsed)) {
              const migrated = migrateLegacyAnnotationFile(parsed);
              const normalizedMigrated = {
                ...migrated,
                fileId: preferredFileId,
                fileType: fileTypeOverride || detected,
              };

              if (!cancelled) {
                const dedupedAnnotations = dedupeAnnotationsById(normalizedMigrated.annotations);
                annotationFileRef.current = normalizedMigrated;
                annotationFileRef.current = {
                  ...normalizedMigrated,
                  annotations: dedupedAnnotations,
                };
                setAnnotations(dedupedAnnotations);
                await saveWithRetry({
                  ...normalizedMigrated,
                  annotations: dedupedAnnotations,
                }, rootHandle);
              }
              loadedExistingFile = true;
              break;
            }

            const universalFile = deserializeAnnotationFile(content);
            if (universalFile && !cancelled) {
              const dedupedAnnotations = dedupeAnnotationsById(universalFile.annotations);
              const normalizedFile = {
                ...universalFile,
                annotations: dedupedAnnotations,
                fileId: preferredFileId,
                fileType: fileTypeOverride || detected,
              };
              annotationFileRef.current = normalizedFile;
              setAnnotations(dedupedAnnotations);

              if (candidateFileId !== preferredFileId || universalFile.fileId !== preferredFileId) {
                await saveWithRetry(normalizedFile, rootHandle);
              }
              loadedExistingFile = true;
              break;
            }
          } catch {
            // Try next candidate id
          }
        }

        if (!loadedExistingFile && !cancelled) {
          const fileIdentity = await resolveFileIdentity({
            fileHandle,
            fileName,
            filePath: preferredPath,
            workspaceIdentity,
          });
          const resolved = await loadAnnotationsForFileIdentity({
            rootHandle,
            fileIdentity,
            workspaceKey: workspaceIdentity?.workspaceKey ?? null,
            fileType: fileTypeOverride || detected,
          });

          if (resolved.source) {
            const dedupedAnnotations = dedupeAnnotationsById(resolved.annotationFile.annotations);
            const resolvedFile = {
              ...resolved.annotationFile,
              annotations: dedupedAnnotations,
              fileId: preferredFileId,
              fileType: fileTypeOverride || detected,
            };
            annotationFileRef.current = resolvedFile;
            setAnnotations(dedupedAnnotations);
            loadedExistingFile = true;
          }
        }

        if (!loadedExistingFile && !cancelled) {
          const newFile = createUniversalAnnotationFile(preferredFileId, fileTypeOverride || detected);
          annotationFileRef.current = newFile;
          setAnnotations([]);
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
  }, [binding, deferLoad, fileHandle, filePath, rootHandle, fileTypeOverride, storageFileId, workspaceIdentity]);

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
      annotations: dedupeAnnotationsById(newAnnotations),
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
      const deduped = dedupeAnnotationsById(updated);
      scheduleSave(deduped);
      return deduped;
    });
    
    return newAnnotation.id;
  }, [scheduleSave]);

  // Update annotation
  const updateAnnotation = useCallback((
    id: string,
    updates: AnnotationUpdates
  ): boolean => {
    let success = false;
    let validationError: string | null = null;
    
    // Update state using functional update to ensure we have the latest state
    setAnnotations(prev => {
      const index = prev.findIndex(a => a.id === id);
      if (index === -1) {
        console.warn(`[updateAnnotation] Annotation not found: ${id}`);
        return prev;
      }
      
      const existingAnnotation = prev[index];
      
      // Deep merge for nested objects like style and target
      // Use type assertion since we know the merged result will be valid
      const mergedStyle = updates.style 
        ? { ...existingAnnotation.style, ...updates.style }
        : existingAnnotation.style;
      
      const mergedTarget = updates.target
        ? { ...existingAnnotation.target, ...updates.target }
        : existingAnnotation.target;
      
      const updated: AnnotationItem = {
        ...existingAnnotation,
        content: updates.content !== undefined ? updates.content : existingAnnotation.content,
        comment: updates.comment !== undefined ? updates.comment : existingAnnotation.comment,
        preview: updates.preview !== undefined ? updates.preview : existingAnnotation.preview,
        author: updates.author !== undefined ? updates.author : existingAnnotation.author,
        createdAt: updates.createdAt !== undefined ? updates.createdAt : existingAnnotation.createdAt,
        style: mergedStyle as AnnotationItem['style'],
        target: mergedTarget as AnnotationItem['target'],
      };
      
      // Validate updated annotation
      const validation = validateAnnotationItem(updated);
      if (!validation.valid) {
        console.error(`[updateAnnotation] Validation failed:`, validation.errors);
        validationError = `Invalid annotation update: ${validation.errors.join(', ')}`;
        return prev;
      }
      
      const newAnnotations = [...prev];
      newAnnotations[index] = updated;
      const deduped = dedupeAnnotationsById(newAnnotations);
      scheduleSave(deduped);
      success = true;
      return deduped;
    });
    
    // Handle validation error outside of setState
    if (validationError) {
      setError(validationError);
      return false;
    }
    
    // Clear any previous error on success
    if (success) {
      setError(null);
    }
    
    return success;
  }, [scheduleSave]);

  // Delete annotation
  const deleteAnnotation = useCallback((id: string): boolean => {
    let success = false;
    
    setAnnotations(prev => {
      const index = prev.findIndex(a => a.id === id);
      if (index === -1) return prev;
      
      const newAnnotations = prev.filter(a => a.id !== id);
      const deduped = dedupeAnnotationsById(newAnnotations);
      scheduleSave(deduped);
      success = true;
      return deduped;
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

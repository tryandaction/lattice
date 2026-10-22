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

interface AnnotationSession {
  snapshot: UniversalAnnotationFile | null;
  unsavedSnapshot: UniversalAnnotationFile | null;
  listeners: Set<(snapshot: UniversalAnnotationFile) => void>;
  writeQueue: Promise<unknown> | null;
}

// Mounted readers, outstanding writes and failed writes retain a session. Weak roots and
// pruning on release keep this coordination state from becoming a file cache.
const annotationSessions = new WeakMap<FileSystemDirectoryHandle, Map<string, AnnotationSession>>();

function getAnnotationSession(root: FileSystemDirectoryHandle, fileId: string): AnnotationSession {
  let sessions = annotationSessions.get(root);
  if (!sessions) {
    sessions = new Map();
    annotationSessions.set(root, sessions);
  }
  let session = sessions.get(fileId);
  if (!session) {
    session = { snapshot: null, unsavedSnapshot: null, listeners: new Set(), writeQueue: null };
    sessions.set(fileId, session);
  }
  return session;
}

function releaseAnnotationSession(root: FileSystemDirectoryHandle, fileId: string, session: AnnotationSession) {
  if (!session.listeners.size && !session.writeQueue && !session.unsavedSnapshot) {
    const sessions = annotationSessions.get(root);
    if (sessions?.get(fileId) === session) sessions.delete(fileId);
  }
}

function publishAnnotationSnapshot(session: AnnotationSession | null, snapshot: UniversalAnnotationFile) {
  if (!session) return;
  session.snapshot = snapshot;
  session.listeners.forEach((listener) => listener(snapshot));
}

function isDesktopDirectoryTimeout(error: unknown): boolean {
  return error instanceof Error &&
    /Tauri command desktop_read_dir timed out/i.test(error.message);
}

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
  formula?: AnnotationItem['formula'];
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
  upsertAnnotation: (annotation: AnnotationItem) => boolean;
  upsertAnnotations: (annotations: AnnotationItem[]) => number;
  persistAnnotationChanges: (upserts: AnnotationItem[], removeIds?: string[]) => Promise<boolean>;
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
  const annotationSessionRef = useRef<AnnotationSession | null>(null);
  const dirtySnapshotRef = useRef<UniversalAnnotationFile | null>(null);
  const writeQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const persistSnapshot = useCallback((snapshot: UniversalAnnotationFile) => {
    const session = getAnnotationSession(rootHandle, snapshot.fileId);
    session.unsavedSnapshot = session.snapshot ?? snapshot;
    const operation = (session.writeQueue ?? Promise.resolve())
      .then(() => saveWithRetry(snapshot, rootHandle))
      .catch((saveError) => {
        logger.error('[Annotations] Failed to persist annotation snapshot:', saveError);
        return false;
      }).then((success) => {
        if (success && session.unsavedSnapshot === snapshot) session.unsavedSnapshot = null;
        return success;
      });
    session.writeQueue = operation;
    void operation.finally(() => {
      if (session.writeQueue === operation) session.writeQueue = null;
      releaseAnnotationSession(rootHandle, snapshot.fileId, session);
    }).catch(() => undefined);
    writeQueueRef.current = operation.catch(() => undefined);
    return operation;
  }, [rootHandle]);
  
  // Load annotations on mount
  useEffect(() => {
    let cancelled = false;
    const restorationController = new AbortController();
    let activeSession: AnnotationSession | null = null;
    let releaseSession: (() => void) | null = null;

    const applyLoadedFile = (snapshot: UniversalAnnotationFile) => {
      if (cancelled) return;
      const freshest = activeSession?.snapshot ?? snapshot;
      publishAnnotationSnapshot(activeSession, freshest);
    };
    
    async function loadAnnotations() {
      annotationFileRef.current = null;
      annotationSessionRef.current = null;
      dirtySnapshotRef.current = null;
      setFileId(null);
      setAnnotations([]);
      setPendingSave(false);
      if (deferLoad) {
        setIsLoading(true);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);
      // A new identity must never inherit the previous file's writable snapshot.
      // Block mutations and persistence while the source is unknown.
      
      try {
        // A reload of the same file must observe the edit flushed by cleanup.
        await writeQueueRef.current;
        if (cancelled) return;
        const fileName = filePath || fileHandle.name;
        const preferredPath = (filePath && filePath.trim()) ? filePath : fileHandle.name;
        const candidateIds = binding?.storageCandidates ?? resolveAnnotationFileCandidates(fileHandle.name, filePath, storageFileId, rootHandle.name);
        const preferredFileId = binding?.canonicalStorageFileId ?? storageFileId ?? candidateIds[0];
        if (!preferredFileId) {
          throw new Error("Unable to derive annotation storage id");
        }
        setFileId(preferredFileId);
        const session = getAnnotationSession(rootHandle, preferredFileId);
        activeSession = session;
        annotationSessionRef.current = session;
        const receiveSnapshot = (snapshot: UniversalAnnotationFile) => {
          if (cancelled) return;
          annotationFileRef.current = snapshot;
          setAnnotations(snapshot.annotations);
        };
        session.listeners.add(receiveSnapshot);
        releaseSession = () => {
          session.listeners.delete(receiveSnapshot);
          releaseAnnotationSession(rootHandle, preferredFileId, session);
        };
        await session.writeQueue;
        if (cancelled) return;
        if (session.snapshot) {
          receiveSnapshot(session.snapshot);
          dirtySnapshotRef.current = session.unsavedSnapshot;
          setPendingSave(Boolean(session.unsavedSnapshot));
          if (session.unsavedSnapshot) setError('Previous annotation save failed; changes remain pending');
          return;
        }
        
        // Detect file type
        const detected = detectFileType(fileName);
        setDetectedFileType(detected);
        
        // A resolved binding is the PDF identity source, but not the annotation content source.
        // The binding snapshot can be stale after edits, so always refresh current annotations from disk.
        if (binding && !cancelled) {
          const resolved = await loadAnnotationsForFileIdentity({
            rootHandle,
            fileIdentity: binding.fileIdentity,
            workspaceKey: binding.storageWorkspaceKey ?? workspaceIdentity?.workspaceKey ?? null,
            fileType: fileTypeOverride || detected,
            signal: restorationController.signal,
          });
          if (cancelled) return;
          const freshestAnnotationFile = resolved.source
            ? resolved.annotationFile
            : binding.annotationFile;
          const dedupedAnnotations = dedupeAnnotationsById(freshestAnnotationFile.annotations);
          applyLoadedFile({
            ...freshestAnnotationFile,
            annotations: dedupedAnnotations,
            fileId: preferredFileId,
            fileType: fileTypeOverride || detected,
          });
          setError(null);
          return;
        }

        // Try to load existing annotations
        const annotationsDir = await ensureAnnotationsDirectory(rootHandle);
        if (cancelled) return;
        let loadedExistingFile = false;

        for (const candidateFileId of candidateIds) {
          const annotationFileName = `${candidateFileId}.json`;

          try {
            const annotationFileHandle = await annotationsDir.getFileHandle(annotationFileName);
            if (cancelled) return;
            const file = await annotationFileHandle.getFile();
            if (cancelled) return;
            const content = await file.text();
            if (cancelled) return;

            let parsed: unknown;
            try {
              parsed = JSON.parse(content);
            } catch (parseErr) {
              logger.error(`[Annotations] Failed to parse annotation file ${annotationFileName}:`, parseErr);
              throw new Error(`Invalid annotation sidecar: ${annotationFileName}`);
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
                const normalizedSnapshot = {
                  ...normalizedMigrated,
                  annotations: dedupedAnnotations,
                };
                if (!await persistSnapshot(normalizedSnapshot)) throw new Error("Failed to migrate annotation sidecar");
                if (cancelled) return;
                applyLoadedFile(normalizedSnapshot);
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
              if (candidateFileId !== preferredFileId || universalFile.fileId !== preferredFileId) {
                if (!await persistSnapshot(normalizedFile)) throw new Error("Failed to migrate annotation sidecar");
                if (cancelled) return;
              }
              applyLoadedFile(normalizedFile);
              loadedExistingFile = true;
              break;
            }
            if (!universalFile) throw new Error(`Invalid annotation sidecar: ${annotationFileName}`);
          } catch (readError) {
            // Only an absent alias is safe to skip. Permission, I/O and parse
            // failures must leave this identity non-writable.
            if (!(readError instanceof DOMException && readError.name === "NotFoundError")) throw readError;
          }
        }

        if (!loadedExistingFile && !cancelled) {
          const fileIdentity = await resolveFileIdentity({
            fileHandle,
            fileName,
            filePath: preferredPath,
            workspaceIdentity,
          });
          if (cancelled) return;
          const resolved = await loadAnnotationsForFileIdentity({
            rootHandle,
            fileIdentity,
            workspaceKey: workspaceIdentity?.workspaceKey ?? null,
            fileType: fileTypeOverride || detected,
            signal: restorationController.signal,
          });

          if (cancelled) return;

          if (resolved.source) {
            const dedupedAnnotations = dedupeAnnotationsById(resolved.annotationFile.annotations);
            const resolvedFile = {
              ...resolved.annotationFile,
              annotations: dedupedAnnotations,
              fileId: preferredFileId,
              fileType: fileTypeOverride || detected,
            };
            applyLoadedFile(resolvedFile);
            loadedExistingFile = true;
          }
        }

        if (!loadedExistingFile && !cancelled) {
          const newFile = createUniversalAnnotationFile(preferredFileId, fileTypeOverride || detected);
          applyLoadedFile(newFile);
        }
      } catch (err) {
        if (!cancelled) {
          if (isDesktopDirectoryTimeout(err)) {
            logger.warn("[Annotations] Desktop directory read timed out; annotation editing is paused.", err);
            // A timeout means the source is unknown. Do not publish an empty
            // file or allow a later edit to overwrite a recoverable sidecar.
            annotationFileRef.current = null;
            setFileId(null);
            setError('Failed to load annotations: desktop directory read timed out');
            return;
          }
          setError(err instanceof Error || err instanceof DOMException ? err.message : 'Failed to load annotations');
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
      restorationController.abort();
      // A folder switch/unmount must flush the last snapshot to the root that
      // created it. Otherwise the next viewer can reuse the ref and write the
      // previous file into a different root.
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      if (dirtySnapshotRef.current) {
        const pendingSnapshot = annotationFileRef.current;
        if (pendingSnapshot) {
          void persistSnapshot(pendingSnapshot).then((success) => {
            if (!success) logger.error('[Annotations] Failed to flush pending annotation save');
          }).catch((flushError) => {
            logger.error('[Annotations] Failed to flush pending annotation save:', flushError);
          });
        }
      }
      releaseSession?.();
    };
  }, [binding, deferLoad, fileHandle, filePath, rootHandle, fileTypeOverride, storageFileId, workspaceIdentity, persistSnapshot]);

  // Debounced save function
  const scheduleSave = useCallback((newAnnotations: AnnotationItem[]) => {
    if (!fileId || !annotationFileRef.current) return;
    
    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    setPendingSave(true);
    
    // Update the annotation file reference
    const snapshot: UniversalAnnotationFile = {
      ...annotationFileRef.current,
      // All mutation paths below already preserve unique IDs. Avoid scanning the
      // complete annotation list again on every keystroke or drag update.
      annotations: newAnnotations,
      lastModified: Date.now(),
    };
    annotationFileRef.current = snapshot;
    dirtySnapshotRef.current = snapshot;
    if (annotationSessionRef.current) annotationSessionRef.current.unsavedSnapshot = snapshot;
    publishAnnotationSnapshot(annotationSessionRef.current, snapshot);
    
    // Schedule save
    saveTimeoutRef.current = setTimeout(async () => {
      saveTimeoutRef.current = null;
      // Another pane may have added an annotation since this timer was set.
      // Persist the synchronized snapshot, never the timer's older capture.
      const latestSnapshot = annotationFileRef.current;
      if (!latestSnapshot) return;
      const success = await persistSnapshot(latestSnapshot);
      if (success && annotationFileRef.current === latestSnapshot) dirtySnapshotRef.current = null;
      
      if (annotationFileRef.current !== latestSnapshot) return;
      if (!success) {
        setError('Failed to save annotations after multiple retries');
      } else if (annotationFileRef.current === latestSnapshot) {
        setError(null);
      }
      
      if (annotationFileRef.current === latestSnapshot) setPendingSave(!success);
    }, saveDelay);
  }, [fileId, persistSnapshot, saveDelay]);

  // Explicit AI approval waits for durable storage, rather than the debounce timer.
  const persistAnnotationChanges = useCallback(async (upserts: AnnotationItem[], removeIds: string[] = []): Promise<boolean> => {
    const current = annotationFileRef.current;
    if (!current || !fileId) return false;
    for (const annotation of upserts) {
      const validation = validateAnnotationItem(annotation);
      if (!validation.valid) {
        setError(`Invalid annotation: ${validation.errors.join(', ')}`);
        return false;
      }
    }
    const removals = new Set(removeIds);
    const merged = new Map(current.annotations.filter((item) => !removals.has(item.id)).map((item) => [item.id, item]));
    upserts.forEach((item) => merged.set(item.id, item));
    const next = { ...current, annotations: [...merged.values()], lastModified: Date.now() };
    const hadPendingSave = pendingSave || saveTimeoutRef.current !== null;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = null;
    annotationFileRef.current = next;
    dirtySnapshotRef.current = next;
    if (annotationSessionRef.current) annotationSessionRef.current.unsavedSnapshot = next;
    publishAnnotationSnapshot(annotationSessionRef.current, next);
    setPendingSave(true);
    const success = await persistSnapshot(next);
    if (annotationFileRef.current === next) {
      dirtySnapshotRef.current = success ? null : hadPendingSave ? current : null;
      if (annotationSessionRef.current) annotationSessionRef.current.unsavedSnapshot = dirtySnapshotRef.current;
      if (!success) {
        annotationFileRef.current = current;
        publishAnnotationSnapshot(annotationSessionRef.current, current);
      }
      if (!success && hadPendingSave) {
        // The failed AI delta must not cancel an earlier manual edit's save.
        scheduleSave(current.annotations);
      } else {
        setPendingSave(false);
      }
    }
    if (annotationFileRef.current === next || annotationFileRef.current === current) {
      setError(success ? null : 'Failed to save annotations after multiple retries');
    }
    return success;
  }, [fileId, pendingSave, persistSnapshot, scheduleSave]);

  // Add annotation
  const addAnnotation = useCallback((
    annotation: Omit<AnnotationItem, 'id' | 'createdAt'>
  ): string | null => {
    if (!fileId || !annotationFileRef.current) {
      setError('Annotations are not loaded; wait for storage recovery before editing');
      return null;
    }
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
    
    scheduleSave([...annotationFileRef.current.annotations, newAnnotation]);
    
    return newAnnotation.id;
  }, [fileId, scheduleSave]);

  const upsertAnnotation = useCallback((annotation: AnnotationItem): boolean => {
    if (!fileId || !annotationFileRef.current) {
      setError('Annotations are not loaded; wait for storage recovery before editing');
      return false;
    }
    const validation = validateAnnotationItem(annotation);
    if (!validation.valid) {
      setError(`Invalid annotation: ${validation.errors.join(', ')}`);
      return false;
    }

    const prev = annotationFileRef.current.annotations;
    const index = prev.findIndex((candidate) => candidate.id === annotation.id);
    const next = [...prev];
    if (index >= 0) next[index] = annotation;
    else next.push(annotation);
    scheduleSave(next);
    setError(null);
    return true;
  }, [fileId, scheduleSave]);

  const upsertAnnotations = useCallback((nextAnnotations: AnnotationItem[]): number => {
    if (!fileId || !annotationFileRef.current) {
      setError('Annotations are not loaded; wait for storage recovery before editing');
      return 0;
    }
    const validAnnotations: AnnotationItem[] = [];
    for (const annotation of nextAnnotations) {
      const validation = validateAnnotationItem(annotation);
      if (!validation.valid) {
        setError(`Invalid annotation: ${validation.errors.join(', ')}`);
        return 0;
      }
      validAnnotations.push(annotation);
    }

    if (validAnnotations.length === 0) {
      return 0;
    }

    const byId = new Map(annotationFileRef.current.annotations.map((annotation) => [annotation.id, annotation] as const));
    validAnnotations.forEach((annotation) => { byId.set(annotation.id, annotation); });
    scheduleSave(Array.from(byId.values()));
    setError(null);
    return validAnnotations.length;
  }, [fileId, scheduleSave]);

  // Update annotation
  const updateAnnotation = useCallback((
    id: string,
    updates: AnnotationUpdates
  ): boolean => {
    if (!fileId || !annotationFileRef.current) {
      setError('Annotations are not loaded; wait for storage recovery before editing');
      return false;
    }
    // The synchronized ref is current even before React commits a batched render.
    const prev = annotationFileRef.current.annotations;
      const index = prev.findIndex(a => a.id === id);
      if (index === -1) {
        console.warn(`[updateAnnotation] Annotation not found: ${id}`);
        return false;
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
        preview: 'preview' in updates ? updates.preview : existingAnnotation.preview,
        formula: 'formula' in updates ? updates.formula : existingAnnotation.formula,
        author: updates.author !== undefined ? updates.author : existingAnnotation.author,
        createdAt: updates.createdAt !== undefined ? updates.createdAt : existingAnnotation.createdAt,
        style: mergedStyle as AnnotationItem['style'],
        target: mergedTarget as AnnotationItem['target'],
      };
      
      // Validate updated annotation
      const validation = validateAnnotationItem(updated);
      if (!validation.valid) {
        console.error(`[updateAnnotation] Validation failed:`, validation.errors);
        setError(`Invalid annotation update: ${validation.errors.join(', ')}`);
        return false;
      }
      
      const newAnnotations = [...prev];
      newAnnotations[index] = updated;
      scheduleSave(newAnnotations);
    setError(null);
    return true;
  }, [fileId, scheduleSave]);

  // Delete annotation
  const deleteAnnotation = useCallback((id: string): boolean => {
    if (!fileId || !annotationFileRef.current) {
      setError('Annotations are not loaded; wait for storage recovery before editing');
      return false;
    }
    const prev = annotationFileRef.current.annotations;
    if (!prev.some((annotation) => annotation.id === id)) return false;
    scheduleSave(prev.filter((annotation) => annotation.id !== id));
    return true;
  }, [fileId, scheduleSave]);

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
    upsertAnnotation,
    upsertAnnotations,
    persistAnnotationChanges,
    updateAnnotation,
    deleteAnnotation,
    scrollToAnnotation,
    getAnnotationById,
    getAnnotationsByTarget,
  };
}

/**
 * Annotation Store for Lattice PDF Annotations
 * 
 * Zustand store managing annotation state with debounced persistence
 * and in-memory backup for data safety.
 */

import { create } from 'zustand';
import type { LatticeAnnotation, AnnotationFile } from '../types/annotation';
import {
  validateAnnotation,
} from '../lib/annotation-utils';
import {
  deriveFileId,
  loadAnnotationsFromDisk,
  saveWithRetry,
  createDebouncedSave,
} from '../lib/annotation-storage';

// ============================================================================
// Types
// ============================================================================

export interface AnnotationStoreState {
  // State
  annotations: Map<string, LatticeAnnotation[]>;  // fileId -> annotations
  activeFileId: string | null;
  isLoading: boolean;
  error: string | null;
  pendingSave: boolean;
  
  // Backup state for data safety
  backup: Map<string, LatticeAnnotation[]>;
  
  // Internal state
  rootHandle: FileSystemDirectoryHandle | null;
}

export interface AnnotationStoreActions {
  // Core actions
  loadAnnotations: (fileId: string, rootHandle: FileSystemDirectoryHandle) => Promise<void>;
  addAnnotation: (annotation: LatticeAnnotation) => void;
  updateAnnotation: (id: string, updates: Partial<Omit<LatticeAnnotation, 'id' | 'fileId'>>) => void;
  deleteAnnotation: (id: string) => void;
  setActiveFile: (fileId: string | null) => void;
  setRootHandle: (handle: FileSystemDirectoryHandle | null) => void;
  
  // Selectors
  getAnnotationsForFile: (fileId: string) => LatticeAnnotation[];
  getAnnotationsForPage: (fileId: string, page: number) => LatticeAnnotation[];
  getAnnotationById: (id: string) => LatticeAnnotation | undefined;
  
  // Backup actions
  createBackup: () => void;
  restoreFromBackup: () => void;
  
  // Utility
  clearError: () => void;
  forceSave: () => Promise<boolean>;
}

export type AnnotationStore = AnnotationStoreState & AnnotationStoreActions;

// ============================================================================
// Constants
// ============================================================================

const DEBOUNCE_DELAY = 500; // ms
const MAX_RETRIES = 3;

// ============================================================================
// Store Implementation
// ============================================================================

// Create debounced save function outside store to maintain state
const debouncedSave = createDebouncedSave(DEBOUNCE_DELAY);

/**
 * Helper to create AnnotationFile from store state
 */
function createAnnotationFileFromState(
  fileId: string,
  annotations: LatticeAnnotation[]
): AnnotationFile {
  return {
    version: 1,
    fileId,
    annotations,
    lastModified: Date.now(),
  };
}

/**
 * Annotation store using Zustand
 */
export const useAnnotationStore = create<AnnotationStore>((set, get) => ({
  // Initial state
  annotations: new Map(),
  activeFileId: null,
  isLoading: false,
  error: null,
  pendingSave: false,
  backup: new Map(),
  rootHandle: null,

  // Set root handle for file operations
  setRootHandle: (handle) => set({ rootHandle: handle }),

  // Load annotations for a file
  loadAnnotations: async (fileId, rootHandle) => {
    set({ isLoading: true, error: null, rootHandle });

    try {
      const annotationFile = await loadAnnotationsFromDisk(fileId, rootHandle);
      
      set((state) => {
        const newAnnotations = new Map(state.annotations);
        newAnnotations.set(fileId, annotationFile.annotations);
        
        return {
          annotations: newAnnotations,
          activeFileId: fileId,
          isLoading: false,
        };
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to load annotations';
      set({ error: errorMessage, isLoading: false });
    }
  },

  // Add a new annotation
  addAnnotation: (annotation) => {
    const validation = validateAnnotation(annotation);
    if (!validation.valid) {
      console.error('Invalid annotation:', validation.errors);
      set({ error: `Invalid annotation: ${validation.errors.join(', ')}` });
      return;
    }

    set((state) => {
      const newAnnotations = new Map(state.annotations);
      const fileAnnotations = newAnnotations.get(annotation.fileId) ?? [];
      newAnnotations.set(annotation.fileId, [...fileAnnotations, annotation]);
      
      return {
        annotations: newAnnotations,
        pendingSave: true,
      };
    });

    // Trigger debounced save
    const state = get();
    if (state.rootHandle) {
      const fileAnnotations = state.annotations.get(annotation.fileId) ?? [];
      const annotationFile = createAnnotationFileFromState(
        annotation.fileId,
        [...fileAnnotations, annotation]
      );
      
      debouncedSave(annotationFile, state.rootHandle)
        .then(() => set({ pendingSave: false }))
        .catch((error) => {
          console.error('Failed to save annotation:', error);
          set({ error: 'Failed to save annotation' });
        });
    }
  },

  // Update an existing annotation
  updateAnnotation: (id, updates) => {
    const state = get();
    let targetFileId: string | null = null;
    let updatedAnnotation: LatticeAnnotation | null = null;

    // Find the annotation across all files
    for (const [fileId, annotations] of state.annotations) {
      const index = annotations.findIndex((a) => a.id === id);
      if (index !== -1) {
        targetFileId = fileId;
        updatedAnnotation = {
          ...annotations[index],
          ...updates,
          id: annotations[index].id, // Preserve id
          fileId: annotations[index].fileId, // Preserve fileId
        };
        break;
      }
    }

    if (!targetFileId || !updatedAnnotation) {
      console.warn(`Annotation with id ${id} not found`);
      return;
    }

    const validation = validateAnnotation(updatedAnnotation);
    if (!validation.valid) {
      console.error('Invalid annotation update:', validation.errors);
      set({ error: `Invalid annotation update: ${validation.errors.join(', ')}` });
      return;
    }

    set((state) => {
      const newAnnotations = new Map(state.annotations);
      const fileAnnotations = newAnnotations.get(targetFileId!) ?? [];
      const updatedFileAnnotations = fileAnnotations.map((a) =>
        a.id === id ? updatedAnnotation! : a
      );
      newAnnotations.set(targetFileId!, updatedFileAnnotations);
      
      return {
        annotations: newAnnotations,
        pendingSave: true,
      };
    });

    // Trigger debounced save
    if (state.rootHandle && targetFileId) {
      const updatedState = get();
      const fileAnnotations = updatedState.annotations.get(targetFileId) ?? [];
      const annotationFile = createAnnotationFileFromState(targetFileId, fileAnnotations);
      
      debouncedSave(annotationFile, state.rootHandle)
        .then(() => set({ pendingSave: false }))
        .catch((error) => {
          console.error('Failed to save annotation:', error);
          set({ error: 'Failed to save annotation' });
        });
    }
  },

  // Delete an annotation
  deleteAnnotation: (id) => {
    const state = get();
    let targetFileId: string | null = null;

    // Find the annotation across all files
    for (const [fileId, annotations] of state.annotations) {
      if (annotations.some((a) => a.id === id)) {
        targetFileId = fileId;
        break;
      }
    }

    if (!targetFileId) {
      console.warn(`Annotation with id ${id} not found`);
      return;
    }

    set((state) => {
      const newAnnotations = new Map(state.annotations);
      const fileAnnotations = newAnnotations.get(targetFileId!) ?? [];
      const filteredAnnotations = fileAnnotations.filter((a) => a.id !== id);
      newAnnotations.set(targetFileId!, filteredAnnotations);
      
      return {
        annotations: newAnnotations,
        pendingSave: true,
      };
    });

    // Trigger debounced save
    if (state.rootHandle && targetFileId) {
      const updatedState = get();
      const fileAnnotations = updatedState.annotations.get(targetFileId) ?? [];
      const annotationFile = createAnnotationFileFromState(targetFileId, fileAnnotations);
      
      debouncedSave(annotationFile, state.rootHandle)
        .then(() => set({ pendingSave: false }))
        .catch((error) => {
          console.error('Failed to save annotation:', error);
          set({ error: 'Failed to save annotation' });
        });
    }
  },

  // Set active file
  setActiveFile: (fileId) => set({ activeFileId: fileId }),

  // Get annotations for a specific file
  getAnnotationsForFile: (fileId) => {
    const state = get();
    return state.annotations.get(fileId) ?? [];
  },

  // Get annotations for a specific page
  getAnnotationsForPage: (fileId, page) => {
    const state = get();
    const fileAnnotations = state.annotations.get(fileId) ?? [];
    return fileAnnotations.filter((a) => a.page === page);
  },

  // Get annotation by ID
  getAnnotationById: (id) => {
    const state = get();
    for (const annotations of state.annotations.values()) {
      const annotation = annotations.find((a) => a.id === id);
      if (annotation) return annotation;
    }
    return undefined;
  },

  // Create backup of current state
  createBackup: () => {
    set((state) => ({
      backup: new Map(
        Array.from(state.annotations.entries()).map(([fileId, annotations]) => [
          fileId,
          annotations.map((a) => ({ ...a })), // Deep copy annotations
        ])
      ),
    }));
  },

  // Restore from backup
  restoreFromBackup: () => {
    set((state) => ({
      annotations: new Map(
        Array.from(state.backup.entries()).map(([fileId, annotations]) => [
          fileId,
          annotations.map((a) => ({ ...a })), // Deep copy annotations
        ])
      ),
    }));
  },

  // Clear error
  clearError: () => set({ error: null }),

  // Force immediate save (bypasses debounce)
  forceSave: async () => {
    const state = get();
    if (!state.rootHandle || !state.activeFileId) {
      return false;
    }

    const fileAnnotations = state.annotations.get(state.activeFileId) ?? [];
    const annotationFile = createAnnotationFileFromState(
      state.activeFileId,
      fileAnnotations
    );

    const success = await saveWithRetry(annotationFile, state.rootHandle, MAX_RETRIES);
    
    if (success) {
      set({ pendingSave: false });
    } else {
      set({ error: 'Failed to save annotations after multiple retries' });
    }

    return success;
  },
}));

// ============================================================================
// Utility Exports
// ============================================================================

export { deriveFileId };

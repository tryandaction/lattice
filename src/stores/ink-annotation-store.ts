/**
 * Ink Annotation Store
 * 
 * Zustand store for managing ink/handwriting annotations with undo/redo support.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  InkStroke,
  InkAnnotation,
  InkAnnotationFile,
  InkStrokeStyle,
  InkToolType,
  InkPoint,
} from '../types/ink-annotation';
import {
  DEFAULT_INK_STYLE,
  calculateStrokeBounds,
  isInkAnnotationFile,
} from '../types/ink-annotation';

// ============================================================================
// Types
// ============================================================================

/**
 * Undo/redo action types
 */
type UndoAction =
  | { type: 'add_stroke'; annotationId: string; stroke: InkStroke }
  | { type: 'remove_stroke'; annotationId: string; stroke: InkStroke }
  | { type: 'clear_strokes'; annotationId: string; strokes: InkStroke[] };

/**
 * Store state
 */
interface InkAnnotationState {
  /** All ink annotations by file ID */
  annotations: Map<string, InkAnnotation[]>;
  /** Current tool */
  currentTool: InkToolType;
  /** Current stroke style */
  currentStyle: InkStrokeStyle;
  /** Undo stack */
  undoStack: UndoAction[];
  /** Redo stack */
  redoStack: UndoAction[];
  /** Maximum undo history size */
  maxUndoSize: number;
  /** Whether there are unsaved changes */
  hasUnsavedChanges: boolean;
}

/**
 * Store actions
 */
interface InkAnnotationActions {
  // Annotation management
  loadAnnotations: (fileId: string, data: InkAnnotationFile | null) => void;
  getAnnotationsForFile: (fileId: string) => InkAnnotation[];
  getAnnotationForPage: (fileId: string, page: number) => InkAnnotation | undefined;
  
  // Stroke management
  addStroke: (fileId: string, page: number, points: InkPoint[], author?: string) => string;
  removeStroke: (fileId: string, page: number, strokeId: string) => boolean;
  clearStrokes: (fileId: string, page: number) => void;
  
  // Tool and style
  setCurrentTool: (tool: InkToolType) => void;
  setCurrentStyle: (style: Partial<InkStrokeStyle>) => void;
  
  // Undo/redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clearHistory: () => void;
  
  // Persistence
  exportAnnotations: (fileId: string) => InkAnnotationFile | null;
  markSaved: () => void;
}

type InkAnnotationStore = InkAnnotationState & InkAnnotationActions;

// ============================================================================
// Utilities
// ============================================================================

/**
 * Generate a unique ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create a new ink annotation for a page
 */
function createAnnotation(
  fileId: string,
  page: number,
  tool: InkToolType,
  author: string
): InkAnnotation {
  const now = Date.now();
  return {
    id: generateId(),
    fileId,
    page,
    strokes: [],
    tool,
    author,
    createdAt: now,
    lastModified: now,
  };
}

/**
 * Create a stroke from points
 */
function createStroke(points: InkPoint[], style: InkStrokeStyle): InkStroke {
  return {
    id: generateId(),
    points,
    style,
    createdAt: Date.now(),
    bounds: calculateStrokeBounds(points),
  };
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useInkAnnotationStore = create<InkAnnotationStore>()(
  persist(
    (set, get) => ({
      // Initial state
      annotations: new Map(),
      currentTool: 'pen',
      currentStyle: { ...DEFAULT_INK_STYLE },
      undoStack: [],
      redoStack: [],
      maxUndoSize: 50,
      hasUnsavedChanges: false,

      // Load annotations for a file
      loadAnnotations: (fileId, data) => {
        set(state => {
          const newAnnotations = new Map(state.annotations);
          
          if (data && isInkAnnotationFile(data)) {
            newAnnotations.set(fileId, data.annotations);
          } else {
            newAnnotations.set(fileId, []);
          }
          
          return { annotations: newAnnotations };
        });
      },

      // Get all annotations for a file
      getAnnotationsForFile: (fileId) => {
        return get().annotations.get(fileId) || [];
      },

      // Get annotation for a specific page
      getAnnotationForPage: (fileId, page) => {
        const fileAnnotations = get().annotations.get(fileId) || [];
        return fileAnnotations.find(a => a.page === page);
      },

      // Add a stroke
      addStroke: (fileId, page, points, author = 'user') => {
        const { currentStyle, currentTool, maxUndoSize } = get();
        const stroke = createStroke(points, currentStyle);

        set(state => {
          const newAnnotations = new Map(state.annotations);
          const fileAnnotations = [...(newAnnotations.get(fileId) || [])];
          
          // Find or create annotation for this page
          let annotation = fileAnnotations.find(a => a.page === page);
          
          if (!annotation) {
            annotation = createAnnotation(fileId, page, currentTool, author);
            fileAnnotations.push(annotation);
          }
          
          // Add stroke to annotation
          const annotationIndex = fileAnnotations.indexOf(annotation);
          const updatedAnnotation: InkAnnotation = {
            ...annotation,
            strokes: [...annotation.strokes, stroke],
            lastModified: Date.now(),
          };
          fileAnnotations[annotationIndex] = updatedAnnotation;
          
          newAnnotations.set(fileId, fileAnnotations);
          
          // Add to undo stack
          const undoAction: UndoAction = {
            type: 'add_stroke',
            annotationId: updatedAnnotation.id,
            stroke,
          };
          const newUndoStack = [...state.undoStack, undoAction].slice(-maxUndoSize);
          
          return {
            annotations: newAnnotations,
            undoStack: newUndoStack,
            redoStack: [], // Clear redo stack on new action
            hasUnsavedChanges: true,
          };
        });

        return stroke.id;
      },

      // Remove a stroke
      removeStroke: (fileId, page, strokeId) => {
        const { maxUndoSize } = get();
        let removed = false;
        let removedStroke: InkStroke | null = null;
        let annotationId: string | null = null;

        set(state => {
          const newAnnotations = new Map(state.annotations);
          const fileAnnotations = [...(newAnnotations.get(fileId) || [])];
          
          const annotationIndex = fileAnnotations.findIndex(a => a.page === page);
          if (annotationIndex === -1) return state;
          
          const annotation = fileAnnotations[annotationIndex];
          const strokeIndex = annotation.strokes.findIndex(s => s.id === strokeId);
          if (strokeIndex === -1) return state;
          
          removedStroke = annotation.strokes[strokeIndex];
          annotationId = annotation.id;
          
          const updatedAnnotation: InkAnnotation = {
            ...annotation,
            strokes: annotation.strokes.filter(s => s.id !== strokeId),
            lastModified: Date.now(),
          };
          fileAnnotations[annotationIndex] = updatedAnnotation;
          
          newAnnotations.set(fileId, fileAnnotations);
          removed = true;
          
          // Add to undo stack
          const undoAction: UndoAction = {
            type: 'remove_stroke',
            annotationId: annotation.id,
            stroke: removedStroke,
          };
          const newUndoStack = [...state.undoStack, undoAction].slice(-maxUndoSize);
          
          return {
            annotations: newAnnotations,
            undoStack: newUndoStack,
            redoStack: [],
            hasUnsavedChanges: true,
          };
        });

        return removed;
      },

      // Clear all strokes on a page
      clearStrokes: (fileId, page) => {
        const { maxUndoSize } = get();

        set(state => {
          const newAnnotations = new Map(state.annotations);
          const fileAnnotations = [...(newAnnotations.get(fileId) || [])];
          
          const annotationIndex = fileAnnotations.findIndex(a => a.page === page);
          if (annotationIndex === -1) return state;
          
          const annotation = fileAnnotations[annotationIndex];
          if (annotation.strokes.length === 0) return state;
          
          const clearedStrokes = [...annotation.strokes];
          
          const updatedAnnotation: InkAnnotation = {
            ...annotation,
            strokes: [],
            lastModified: Date.now(),
          };
          fileAnnotations[annotationIndex] = updatedAnnotation;
          
          newAnnotations.set(fileId, fileAnnotations);
          
          // Add to undo stack
          const undoAction: UndoAction = {
            type: 'clear_strokes',
            annotationId: annotation.id,
            strokes: clearedStrokes,
          };
          const newUndoStack = [...state.undoStack, undoAction].slice(-maxUndoSize);
          
          return {
            annotations: newAnnotations,
            undoStack: newUndoStack,
            redoStack: [],
            hasUnsavedChanges: true,
          };
        });
      },

      // Set current tool
      setCurrentTool: (tool) => {
        set({ currentTool: tool });
      },

      // Set current style
      setCurrentStyle: (style) => {
        set(state => ({
          currentStyle: { ...state.currentStyle, ...style },
        }));
      },

      // Undo
      undo: () => {
        set(state => {
          if (state.undoStack.length === 0) return state;
          
          const action = state.undoStack[state.undoStack.length - 1];
          const newUndoStack = state.undoStack.slice(0, -1);
          const newAnnotations = new Map(state.annotations);
          
          // Find the annotation
          for (const [fileId, fileAnnotations] of newAnnotations) {
            const annotationIndex = fileAnnotations.findIndex(
              a => a.id === action.annotationId
            );
            if (annotationIndex === -1) continue;
            
            const annotation = fileAnnotations[annotationIndex];
            let updatedAnnotation: InkAnnotation;
            
            switch (action.type) {
              case 'add_stroke':
                // Remove the added stroke
                updatedAnnotation = {
                  ...annotation,
                  strokes: annotation.strokes.filter(s => s.id !== action.stroke.id),
                  lastModified: Date.now(),
                };
                break;
                
              case 'remove_stroke':
                // Re-add the removed stroke
                updatedAnnotation = {
                  ...annotation,
                  strokes: [...annotation.strokes, action.stroke],
                  lastModified: Date.now(),
                };
                break;
                
              case 'clear_strokes':
                // Restore all cleared strokes
                updatedAnnotation = {
                  ...annotation,
                  strokes: action.strokes,
                  lastModified: Date.now(),
                };
                break;
            }
            
            const newFileAnnotations = [...fileAnnotations];
            newFileAnnotations[annotationIndex] = updatedAnnotation;
            newAnnotations.set(fileId, newFileAnnotations);
            break;
          }
          
          return {
            annotations: newAnnotations,
            undoStack: newUndoStack,
            redoStack: [...state.redoStack, action],
            hasUnsavedChanges: true,
          };
        });
      },

      // Redo
      redo: () => {
        set(state => {
          if (state.redoStack.length === 0) return state;
          
          const action = state.redoStack[state.redoStack.length - 1];
          const newRedoStack = state.redoStack.slice(0, -1);
          const newAnnotations = new Map(state.annotations);
          
          // Find the annotation
          for (const [fileId, fileAnnotations] of newAnnotations) {
            const annotationIndex = fileAnnotations.findIndex(
              a => a.id === action.annotationId
            );
            if (annotationIndex === -1) continue;
            
            const annotation = fileAnnotations[annotationIndex];
            let updatedAnnotation: InkAnnotation;
            
            switch (action.type) {
              case 'add_stroke':
                // Re-add the stroke
                updatedAnnotation = {
                  ...annotation,
                  strokes: [...annotation.strokes, action.stroke],
                  lastModified: Date.now(),
                };
                break;
                
              case 'remove_stroke':
                // Remove the stroke again
                updatedAnnotation = {
                  ...annotation,
                  strokes: annotation.strokes.filter(s => s.id !== action.stroke.id),
                  lastModified: Date.now(),
                };
                break;
                
              case 'clear_strokes':
                // Clear strokes again
                updatedAnnotation = {
                  ...annotation,
                  strokes: [],
                  lastModified: Date.now(),
                };
                break;
            }
            
            const newFileAnnotations = [...fileAnnotations];
            newFileAnnotations[annotationIndex] = updatedAnnotation;
            newAnnotations.set(fileId, newFileAnnotations);
            break;
          }
          
          return {
            annotations: newAnnotations,
            undoStack: [...state.undoStack, action],
            redoStack: newRedoStack,
            hasUnsavedChanges: true,
          };
        });
      },

      // Check if can undo
      canUndo: () => get().undoStack.length > 0,

      // Check if can redo
      canRedo: () => get().redoStack.length > 0,

      // Clear undo/redo history
      clearHistory: () => {
        set({ undoStack: [], redoStack: [] });
      },

      // Export annotations for a file
      exportAnnotations: (fileId) => {
        const annotations = get().annotations.get(fileId);
        if (!annotations || annotations.length === 0) return null;
        
        return {
          version: 1 as const,
          fileId,
          annotations,
          lastModified: Date.now(),
        };
      },

      // Mark as saved
      markSaved: () => {
        set({ hasUnsavedChanges: false });
      },
    }),
    {
      name: 'ink-annotation-store',
      // Only persist certain fields
      partialize: (state) => ({
        currentTool: state.currentTool,
        currentStyle: state.currentStyle,
      }),
    }
  )
);

// ============================================================================
// Selectors
// ============================================================================

/**
 * Select strokes for a specific page
 */
export function useStrokesForPage(fileId: string, page: number): InkStroke[] {
  return useInkAnnotationStore(state => {
    const annotation = state.annotations.get(fileId)?.find(a => a.page === page);
    return annotation?.strokes || [];
  });
}

/**
 * Select current tool
 */
export function useCurrentTool(): InkToolType {
  return useInkAnnotationStore(state => state.currentTool);
}

/**
 * Select current style
 */
export function useCurrentStyle(): InkStrokeStyle {
  return useInkAnnotationStore(state => state.currentStyle);
}

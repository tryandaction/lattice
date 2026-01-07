/**
 * Unified Undo Store
 * 
 * Provides a unified undo/redo system that works across different annotation types
 * (text highlights, area selections, ink annotations).
 * 
 * Requirements: 11.1, 11.2, 11.3, 11.6
 */

import { create } from 'zustand';
import { useAnnotationStore } from './annotation-store';
import { useInkAnnotationStore } from './ink-annotation-store';
import type { LatticeAnnotation } from '../types/annotation';
import type { InkStroke } from '../types/ink-annotation';

// ============================================================================
// Types
// ============================================================================

/**
 * Types of undoable actions
 */
export type UnifiedUndoAction =
  | { 
      type: 'add_text_annotation'; 
      annotation: LatticeAnnotation;
    }
  | { 
      type: 'delete_text_annotation'; 
      annotation: LatticeAnnotation;
    }
  | { 
      type: 'update_text_annotation'; 
      id: string;
      oldState: Partial<LatticeAnnotation>;
      newState: Partial<LatticeAnnotation>;
    }
  | { 
      type: 'add_ink_stroke'; 
      fileId: string;
      page: number;
      stroke: InkStroke;
    }
  | { 
      type: 'delete_ink_stroke'; 
      fileId: string;
      page: number;
      stroke: InkStroke;
    }
  | { 
      type: 'clear_ink_strokes'; 
      fileId: string;
      page: number;
      strokes: InkStroke[];
    };

/**
 * Store state
 */
interface UnifiedUndoState {
  /** Undo stack */
  undoStack: UnifiedUndoAction[];
  /** Redo stack */
  redoStack: UnifiedUndoAction[];
  /** Maximum history size */
  maxHistorySize: number;
  /** Whether undo/redo is in progress (to prevent recursive recording) */
  isUndoRedoInProgress: boolean;
}

/**
 * Store actions
 */
interface UnifiedUndoActions {
  /** Record an action for undo */
  recordAction: (action: UnifiedUndoAction) => void;
  /** Undo the last action */
  undo: () => void;
  /** Redo the last undone action */
  redo: () => void;
  /** Check if undo is available */
  canUndo: () => boolean;
  /** Check if redo is available */
  canRedo: () => boolean;
  /** Clear all history */
  clearHistory: () => void;
  /** Get undo stack size */
  getUndoStackSize: () => number;
  /** Get redo stack size */
  getRedoStackSize: () => number;
}

export type UnifiedUndoStore = UnifiedUndoState & UnifiedUndoActions;

// ============================================================================
// Constants
// ============================================================================

const MAX_HISTORY_SIZE = 100;

// ============================================================================
// Store Implementation
// ============================================================================

export const useUnifiedUndoStore = create<UnifiedUndoStore>((set, get) => ({
  // Initial state
  undoStack: [],
  redoStack: [],
  maxHistorySize: MAX_HISTORY_SIZE,
  isUndoRedoInProgress: false,

  // Record an action
  recordAction: (action) => {
    const { isUndoRedoInProgress, maxHistorySize } = get();
    
    // Don't record if we're in the middle of undo/redo
    if (isUndoRedoInProgress) return;
    
    set(state => ({
      undoStack: [...state.undoStack, action].slice(-maxHistorySize),
      redoStack: [], // Clear redo stack on new action
    }));
  },

  // Undo
  undo: () => {
    const state = get();
    if (state.undoStack.length === 0) return;
    
    const action = state.undoStack[state.undoStack.length - 1];
    
    // Set flag to prevent recursive recording
    set({ isUndoRedoInProgress: true });
    
    try {
      // Execute the undo based on action type
      switch (action.type) {
        case 'add_text_annotation': {
          // Undo add = delete
          const annotationStore = useAnnotationStore.getState();
          annotationStore.deleteAnnotation(action.annotation.id);
          break;
        }
        
        case 'delete_text_annotation': {
          // Undo delete = add back
          const annotationStore = useAnnotationStore.getState();
          annotationStore.addAnnotation(action.annotation);
          break;
        }
        
        case 'update_text_annotation': {
          // Undo update = restore old state
          const annotationStore = useAnnotationStore.getState();
          annotationStore.updateAnnotation(action.id, action.oldState);
          break;
        }
        
        case 'add_ink_stroke': {
          // Undo add = remove
          const inkStore = useInkAnnotationStore.getState();
          inkStore.removeStroke(action.fileId, action.page, action.stroke.id);
          break;
        }
        
        case 'delete_ink_stroke': {
          // Undo delete = add back
          // Note: This is handled by ink store's internal undo
          const inkStore = useInkAnnotationStore.getState();
          // We need to manually add the stroke back
          // The ink store's addStroke creates a new stroke, so we need direct manipulation
          // For now, we'll use the ink store's undo if available
          inkStore.undo();
          break;
        }
        
        case 'clear_ink_strokes': {
          // Undo clear = restore all strokes
          const inkStore = useInkAnnotationStore.getState();
          inkStore.undo();
          break;
        }
      }
      
      // Update stacks
      set(state => ({
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, action],
      }));
    } finally {
      set({ isUndoRedoInProgress: false });
    }
  },

  // Redo
  redo: () => {
    const state = get();
    if (state.redoStack.length === 0) return;
    
    const action = state.redoStack[state.redoStack.length - 1];
    
    // Set flag to prevent recursive recording
    set({ isUndoRedoInProgress: true });
    
    try {
      // Execute the redo based on action type
      switch (action.type) {
        case 'add_text_annotation': {
          // Redo add = add again
          const annotationStore = useAnnotationStore.getState();
          annotationStore.addAnnotation(action.annotation);
          break;
        }
        
        case 'delete_text_annotation': {
          // Redo delete = delete again
          const annotationStore = useAnnotationStore.getState();
          annotationStore.deleteAnnotation(action.annotation.id);
          break;
        }
        
        case 'update_text_annotation': {
          // Redo update = apply new state
          const annotationStore = useAnnotationStore.getState();
          annotationStore.updateAnnotation(action.id, action.newState);
          break;
        }
        
        case 'add_ink_stroke':
        case 'delete_ink_stroke':
        case 'clear_ink_strokes': {
          // Use ink store's redo
          const inkStore = useInkAnnotationStore.getState();
          inkStore.redo();
          break;
        }
      }
      
      // Update stacks
      set(state => ({
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, action],
      }));
    } finally {
      set({ isUndoRedoInProgress: false });
    }
  },

  // Check if can undo
  canUndo: () => get().undoStack.length > 0,

  // Check if can redo
  canRedo: () => get().redoStack.length > 0,

  // Clear history
  clearHistory: () => {
    set({ undoStack: [], redoStack: [] });
  },

  // Get undo stack size
  getUndoStackSize: () => get().undoStack.length,

  // Get redo stack size
  getRedoStackSize: () => get().redoStack.length,
}));

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook to get undo/redo state
 */
export function useUndoRedoState() {
  const canUndo = useUnifiedUndoStore(state => state.undoStack.length > 0);
  const canRedo = useUnifiedUndoStore(state => state.redoStack.length > 0);
  const undoCount = useUnifiedUndoStore(state => state.undoStack.length);
  const redoCount = useUnifiedUndoStore(state => state.redoStack.length);
  
  return { canUndo, canRedo, undoCount, redoCount };
}

/**
 * Hook to get undo/redo actions
 */
export function useUndoRedoActions() {
  const undo = useUnifiedUndoStore(state => state.undo);
  const redo = useUnifiedUndoStore(state => state.redo);
  const recordAction = useUnifiedUndoStore(state => state.recordAction);
  const clearHistory = useUnifiedUndoStore(state => state.clearHistory);
  
  return { undo, redo, recordAction, clearHistory };
}

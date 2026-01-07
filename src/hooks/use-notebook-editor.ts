"use client";

import { useState, useCallback, useMemo } from "react";
import {
  parseNotebook,
  serializeNotebook,
  addCellAfter,
  addCellBefore,
  deleteCell,
  updateCellSource,
  setActiveCell,
  changeCellType,
  type NotebookEditorState,
  type NotebookCell,
} from "@/lib/notebook-utils";

/**
 * Hook return type
 */
interface UseNotebookEditorReturn {
  // State
  state: NotebookEditorState;
  isDirty: boolean;

  // Cell operations
  addCellAbove: (cellId: string, type: "markdown" | "code") => void;
  addCellBelow: (cellId: string, type: "markdown" | "code") => void;
  removeCell: (cellId: string) => void;
  updateSource: (cellId: string, source: string) => void;
  activateCell: (cellId: string) => void;
  changeType: (cellId: string, type: "markdown" | "code") => void;

  // Output operations (for Run All)
  updateCellOutputs: (cellId: string, outputs: NotebookCell["outputs"]) => void;
  updateCellExecutionCount: (cellId: string, count: number) => void;
  clearCellOutputs: (cellId: string) => void;

  // Navigation
  activateNextCell: () => void;
  activatePrevCell: () => void;
  addCellAboveActive: (type: "markdown" | "code") => void;
  addCellBelowActive: (type: "markdown" | "code") => void;
  deleteActiveCell: () => void;

  // Serialization
  serialize: () => string;
  markClean: () => void;
  resetState: (content: string) => void;
}

/**
 * Custom hook for managing notebook editor state
 * 
 * @param initialContent - Initial notebook JSON content
 * @returns Notebook editor state and operations
 */
export function useNotebookEditor(initialContent: string): UseNotebookEditorReturn {
  // Parse initial content into editor state
  const [state, setState] = useState<NotebookEditorState>(() =>
    parseNotebook(initialContent)
  );
  
  // Track if notebook has unsaved changes
  const [isDirty, setIsDirty] = useState(false);

  /**
   * Add a cell above the specified cell
   */
  const addCellAbove = useCallback((cellId: string, type: "markdown" | "code") => {
    setState((prev) => addCellBefore(prev, cellId, type));
    setIsDirty(true);
  }, []);

  /**
   * Add a cell below the specified cell
   */
  const addCellBelow = useCallback((cellId: string, type: "markdown" | "code") => {
    setState((prev) => addCellAfter(prev, cellId, type));
    setIsDirty(true);
  }, []);

  /**
   * Remove a cell
   */
  const removeCell = useCallback((cellId: string) => {
    setState((prev) => deleteCell(prev, cellId));
    setIsDirty(true);
  }, []);

  /**
   * Update a cell's source content
   */
  const updateSource = useCallback((cellId: string, source: string) => {
    setState((prev) => updateCellSource(prev, cellId, source));
    setIsDirty(true);
  }, []);

  /**
   * Set the active cell
   */
  const activateCell = useCallback((cellId: string) => {
    setState((prev) => setActiveCell(prev, cellId));
  }, []);

  /**
   * Change a cell's type
   */
  const changeType = useCallback((cellId: string, type: "markdown" | "code") => {
    setState((prev) => changeCellType(prev, cellId, type));
    setIsDirty(true);
  }, []);

  /**
   * Update a cell's outputs (for Run All)
   */
  const updateCellOutputs = useCallback((cellId: string, outputs: NotebookCell["outputs"]) => {
    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) =>
        cell.id === cellId ? { ...cell, outputs } : cell
      ),
    }));
    setIsDirty(true);
  }, []);

  /**
   * Update a cell's execution count
   */
  const updateCellExecutionCount = useCallback((cellId: string, count: number) => {
    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) =>
        cell.id === cellId ? { ...cell, execution_count: count } : cell
      ),
    }));
    setIsDirty(true);
  }, []);

  /**
   * Clear a cell's outputs
   */
  const clearCellOutputs = useCallback((cellId: string) => {
    setState((prev) => ({
      ...prev,
      cells: prev.cells.map((cell) =>
        cell.id === cellId ? { ...cell, outputs: [], execution_count: null } : cell
      ),
    }));
  }, []);

  /**
   * Activate the next cell (move down)
   */
  const activateNextCell = useCallback(() => {
    setState((prev) => {
      const currentIndex = prev.cells.findIndex((c) => c.id === prev.activeCellId);
      if (currentIndex === -1 || currentIndex >= prev.cells.length - 1) {
        return prev;
      }
      return {
        ...prev,
        activeCellId: prev.cells[currentIndex + 1].id,
      };
    });
  }, []);

  /**
   * Activate the previous cell (move up)
   */
  const activatePrevCell = useCallback(() => {
    setState((prev) => {
      const currentIndex = prev.cells.findIndex((c) => c.id === prev.activeCellId);
      if (currentIndex <= 0) {
        return prev;
      }
      return {
        ...prev,
        activeCellId: prev.cells[currentIndex - 1].id,
      };
    });
  }, []);

  /**
   * Add a cell above the active cell
   */
  const addCellAboveActive = useCallback((type: "markdown" | "code") => {
    setState((prev) => {
      if (!prev.activeCellId) return prev;
      const newState = addCellBefore(prev, prev.activeCellId, type);
      return newState;
    });
    setIsDirty(true);
  }, []);

  /**
   * Add a cell below the active cell
   */
  const addCellBelowActive = useCallback((type: "markdown" | "code") => {
    setState((prev) => {
      if (!prev.activeCellId) return prev;
      const newState = addCellAfter(prev, prev.activeCellId, type);
      return newState;
    });
    setIsDirty(true);
  }, []);

  /**
   * Delete the active cell
   */
  const deleteActiveCell = useCallback(() => {
    setState((prev) => {
      if (!prev.activeCellId || prev.cells.length <= 1) return prev;
      return deleteCell(prev, prev.activeCellId);
    });
    setIsDirty(true);
  }, []);

  /**
   * Serialize the notebook to JSON string
   */
  const serialize = useCallback(() => {
    return serializeNotebook(state);
  }, [state]);

  /**
   * Mark the notebook as clean (after saving)
   */
  const markClean = useCallback(() => {
    setIsDirty(false);
  }, []);

  /**
   * Reset state with new content (for file switching)
   */
  const resetState = useCallback((content: string) => {
    setState(parseNotebook(content));
    setIsDirty(false);
  }, []);

  return {
    state,
    isDirty,
    addCellAbove,
    addCellBelow,
    removeCell,
    updateSource,
    activateCell,
    changeType,
    updateCellOutputs,
    updateCellExecutionCount,
    clearCellOutputs,
    activateNextCell,
    activatePrevCell,
    addCellAboveActive,
    addCellBelowActive,
    deleteActiveCell,
    serialize,
    markClean,
    resetState,
  };
}

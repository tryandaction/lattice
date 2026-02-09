"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { Save, Loader2, Check, AlertCircle, Plus, Code, FileText, Play, Square, RotateCcw, ChevronDown } from "lucide-react";
import { useNotebookEditor } from "@/hooks/use-notebook-editor";
import { useNotebookExecutor } from "@/hooks/use-notebook-executor";
import { NotebookCellComponent } from "./notebook-cell";
import { cn } from "@/lib/utils";
import { debounce } from "@/lib/fast-save";

interface NotebookEditorProps {
  content: string;
  fileName: string;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Save indicator component
 */
function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-3 py-2 shadow-lg transition-all",
        status === "saving" && "bg-muted text-muted-foreground",
        status === "saved" && "bg-green-500/10 text-green-600 dark:text-green-400",
        status === "error" && "bg-destructive/10 text-destructive"
      )}
    >
      {status === "saving" && (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Saving...</span>
        </>
      )}
      {status === "saved" && (
        <>
          <Check className="h-4 w-4" />
          <span className="text-sm">Saved</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">Save failed</span>
        </>
      )}
    </div>
  );
}

/**
 * Notebook Editor Component
 * 
 * A block-based editor for Jupyter Notebook files.
 * 
 * Keyboard shortcuts:
 * - Ctrl+S: Save
 * - Ctrl+Shift+A: Add code cell above
 * - Ctrl+Shift+B: Add code cell below
 * - Ctrl+Shift+M: Add markdown cell below
 * - Ctrl+Shift+D: Delete active cell
 * - Ctrl+Shift+Enter: Run all cells
 * - Arrow Up/Down: Navigate between cells (when not editing)
 */
export function NotebookEditor({ content, fileName, onContentChange, onSave }: NotebookEditorProps) {
  const {
    state,
    isDirty,
    addCellAbove,
    addCellBelow,
    removeCell,
    updateSource,
    activateCell,
    changeType,
    activateNextCell,
    activatePrevCell,
    addCellAboveActive,
    addCellBelowActive,
    deleteActiveCell,
    serialize,
    markClean,
    resetState,
    updateCellOutputs,
    updateCellExecutionCount,
    clearCellOutputs,
  } = useNotebookEditor(content);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Notebook executor for Run All functionality
  const {
    executionState,
    progress,
    runAll,
    runAllAbove,
    runAllBelow,
    interrupt,
    restartKernel,
  } = useNotebookExecutor({
    onCellStart: (cellId) => {
      clearCellOutputs(cellId);
    },
    onCellOutput: (cellId, output) => {
      // Append output to cell
      const cell = state.cells.find(c => c.id === cellId);
      if (cell) {
        const newOutputs = [...(cell.outputs || [])];
        if (output.type === "image") {
          newOutputs.push({
            output_type: "display_data",
            data: { "image/png": output.content.replace("data:image/png;base64,", "") },
          });
        } else if (output.type === "error") {
          newOutputs.push({
            output_type: "error",
            ename: "Error",
            evalue: output.content,
            traceback: [output.content],
          });
        } else {
          newOutputs.push({
            output_type: "stream",
            name: "stdout",
            text: output.content,
          });
        }
        updateCellOutputs(cellId, newOutputs);
      }
    },
    onCellComplete: (cellId, result) => {
      updateCellExecutionCount(cellId, result.executionCount);
    },
  });
  
  // Track the current file to detect file switches
  const currentFileRef = useRef(fileName);
  // Track the current content to detect content changes from external sources
  const currentContentRef = useRef(content);
  // Track the last serialized content to avoid unnecessary updates
  const lastSerializedRef = useRef<string | null>(content);

  // Debounced content change notification for better performance
  const debouncedNotifyChange = useMemo(
    () => debounce((serialized: string) => {
      if (onContentChange && serialized !== lastSerializedRef.current) {
        lastSerializedRef.current = serialized;
        onContentChange(serialized);
      }
    }, 300),
    [onContentChange]
  );

  // Reset state when file changes OR when content changes from external source (file reload)
  useEffect(() => {
    const fileChanged = fileName !== currentFileRef.current;
    const contentChanged = content !== currentContentRef.current;
    
    // Only reset if file changed or content changed from external source
    // (not from our own edits which would have updated lastSerializedRef)
    const isExternalContentChange = contentChanged && content !== lastSerializedRef.current;
    
    if (fileChanged || isExternalContentChange) {
      currentFileRef.current = fileName;
      currentContentRef.current = content;
      lastSerializedRef.current = content;
      resetState(content);
    }
  }, [fileName, content, resetState]);

  // Notify parent of content changes (debounced) - triggered by user edits
  useEffect(() => {
    if (!onContentChange) return;
    
    // Only notify if dirty (user made changes)
    if (!isDirty) return;
    
    const serialized = serialize();
    debouncedNotifyChange(serialized);
  }, [state, serialize, debouncedNotifyChange, isDirty, onContentChange]);

  /**
   * Handle save operation
   */
  const handleSave = useCallback(async () => {
    if (!onSave) return;

    setSaveStatus("saving");
    try {
      await onSave();
      markClean();
      setSaveStatus("saved");
      
      // Auto-hide success indicator
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (_error) {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [onSave, markClean]);

  /**
   * Handle Run All
   */
  const handleRunAll = useCallback(async () => {
    const cells = state.cells.map(c => ({
      id: c.id,
      source: c.source,
      type: c.cell_type,
    }));
    await runAll(cells);
  }, [state.cells, runAll]);

  /**
   * Handle Run All Above
   */
  const handleRunAllAbove = useCallback(async () => {
    if (!state.activeCellId) return;
    const cells = state.cells.map(c => ({
      id: c.id,
      source: c.source,
      type: c.cell_type,
    }));
    await runAllAbove(cells, state.activeCellId);
  }, [state.cells, state.activeCellId, runAllAbove]);

  /**
   * Handle Run All Below
   */
  const handleRunAllBelow = useCallback(async () => {
    if (!state.activeCellId) return;
    const cells = state.cells.map(c => ({
      id: c.id,
      source: c.source,
      type: c.cell_type,
    }));
    await runAllBelow(cells, state.activeCellId);
  }, [state.cells, state.activeCellId, runAllBelow]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }

      // Ctrl+Shift+Enter: Run all cells
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        handleRunAll();
        return;
      }

      // Ctrl+Shift+A: Add code cell above
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "A") {
        e.preventDefault();
        addCellAboveActive("code");
        return;
      }

      // Ctrl+Shift+B: Add code cell below
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "B") {
        e.preventDefault();
        addCellBelowActive("code");
        return;
      }

      // Ctrl+Shift+M: Add markdown cell below
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "M") {
        e.preventDefault();
        addCellBelowActive("markdown");
        return;
      }

      // Ctrl+Shift+D: Delete active cell
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
        e.preventDefault();
        deleteActiveCell();
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, handleRunAll, addCellAboveActive, addCellBelowActive, deleteActiveCell]);

  return (
    <div ref={containerRef} className="h-full overflow-auto bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-6 py-3">
          <div>
            <h1 className="font-semibold text-foreground">{fileName}</h1>
            <p className="text-xs text-muted-foreground">
              {state.cells.length} cell{state.cells.length !== 1 ? "s" : ""}
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            {/* Run All dropdown */}
            <div className="relative">
              {executionState === "running" ? (
                <button
                  onClick={interrupt}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                  title="Interrupt execution"
                >
                  <Square className="h-3 w-3" />
                  <span>Stop</span>
                  {progress.total > 0 && (
                    <span className="text-[10px] opacity-70">
                      ({progress.current}/{progress.total})
                    </span>
                  )}
                </button>
              ) : (
                <>
                  <button
                    onClick={handleRunAll}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent transition-colors"
                    title="Run all cells (Ctrl+Shift+Enter)"
                  >
                    <Play className="h-3 w-3" />
                    <span>Run All</span>
                  </button>
                  <button
                    onClick={() => setRunMenuOpen(!runMenuOpen)}
                    className="rounded-md px-1 py-1 text-xs hover:bg-accent transition-colors"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {runMenuOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setRunMenuOpen(false)}
                      />
                      <div className="absolute right-0 top-full z-20 mt-1 rounded-md border border-border bg-popover p-1 shadow-md min-w-[140px]">
                        <button
                          onClick={() => {
                            handleRunAll();
                            setRunMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent"
                        >
                          <Play className="h-3 w-3" />
                          <span>Run All</span>
                        </button>
                        <button
                          onClick={() => {
                            handleRunAllAbove();
                            setRunMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent"
                        >
                          <Play className="h-3 w-3" />
                          <span>Run All Above</span>
                        </button>
                        <button
                          onClick={() => {
                            handleRunAllBelow();
                            setRunMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent"
                        >
                          <Play className="h-3 w-3" />
                          <span>Run All Below</span>
                        </button>
                        <div className="my-1 border-t border-border" />
                        <button
                          onClick={() => {
                            restartKernel();
                            setRunMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent text-destructive"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Restart Kernel</span>
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
            
            <div className="w-px h-4 bg-border" />
            
            {/* Quick add buttons */}
            <button
              onClick={() => addCellBelowActive("code")}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent transition-colors"
              title="Add code cell (Ctrl+Shift+B)"
            >
              <Plus className="h-3 w-3" />
              <Code className="h-3 w-3" />
            </button>
            <button
              onClick={() => addCellBelowActive("markdown")}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs hover:bg-accent transition-colors"
              title="Add markdown cell (Ctrl+Shift+M)"
            >
              <Plus className="h-3 w-3" />
              <FileText className="h-3 w-3" />
            </button>
            
            <div className="w-px h-4 bg-border mx-1" />
            
            {onSave && (
              <button
                onClick={handleSave}
                disabled={saveStatus === "saving"}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                  "hover:bg-accent",
                  saveStatus === "saving" && "opacity-50 cursor-not-allowed"
                )}
              >
                <Save className="h-4 w-4" />
                <span>Save</span>
              </button>
            )}
          </div>
        </div>
        
        {/* Keyboard shortcuts hint */}
        <div className="flex items-center gap-4 px-6 py-1.5 text-[10px] text-muted-foreground border-t border-border/50 bg-muted/30">
          <span><kbd className="px-1 py-0.5 rounded bg-muted text-[9px]">Ctrl+S</kbd> Save</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted text-[9px]">Ctrl+Shift+Enter</kbd> Run All</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted text-[9px]">Ctrl+Shift+B</kbd> Add code</span>
          <span><kbd className="px-1 py-0.5 rounded bg-muted text-[9px]">Ctrl+Shift+M</kbd> Add markdown</span>
        </div>
      </div>

      {/* Cells */}
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        {state.cells.map((cell, index) => (
          <NotebookCellComponent
            key={cell.id}
            cell={cell}
            isActive={cell.id === state.activeCellId}
            canDelete={state.cells.length > 1}
            onActivate={() => activateCell(cell.id)}
            onAddAbove={(type) => addCellAbove(cell.id, type)}
            onAddBelow={(type) => addCellBelow(cell.id, type)}
            onDelete={() => removeCell(cell.id)}
            onSourceChange={(source) => updateSource(cell.id, source)}
            onTypeChange={(type) => changeType(cell.id, type)}
            onNavigateUp={index > 0 ? activatePrevCell : undefined}
            onNavigateDown={index < state.cells.length - 1 ? activateNextCell : undefined}
          />
        ))}
      </div>

      {/* Save indicator */}
      <SaveIndicator status={saveStatus} />
    </div>
  );
}

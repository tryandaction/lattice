"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Save, Loader2, Check, AlertCircle, Plus, Code, FileText, Play, Square, RotateCcw, ChevronDown } from "lucide-react";
import { useNotebookEditor } from "@/hooks/use-notebook-editor";
import { useNotebookExecutor } from "@/hooks/use-notebook-executor";
import { NotebookCellComponent } from "./notebook-cell";
import { KernelSelector } from "./kernel-selector";
import { cn } from "@/lib/utils";
import { debounce } from "@/lib/fast-save";
import type { KernelOption } from "./kernel-selector";
import type { PaneId } from "@/types/layout";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { isSameWorkspacePath } from "@/lib/link-router/path-utils";
import { dirname, resolveWorkspaceFilePath } from "@/lib/runner/path-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";

interface NotebookEditorProps {
  content: string;
  fileName: string;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
  paneId: PaneId;
  filePath: string;
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
export function NotebookEditor({ content, fileName, onContentChange, onSave, paneId, filePath }: NotebookEditorProps) {
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
  const [currentKernel, setCurrentKernel] = useState<KernelOption | null>(null);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const [highlightedCellId, setHighlightedCellId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cellElementRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const highlightTimeoutRef = useRef<number | null>(null);
  const pendingNavigation = useLinkNavigationStore((state) => state.pendingByPane[paneId]);
  const consumePendingNavigation = useLinkNavigationStore((state) => state.consumePendingNavigation);
  const rootName = useWorkspaceStore((workspace) => workspace.rootHandle?.name ?? workspace.fileTree.root?.name ?? null);
  const workspaceRootPath = useWorkspaceStore((workspace) => workspace.workspaceRootPath);
  const notebookAbsolutePath = resolveWorkspaceFilePath(workspaceRootPath, filePath, rootName);
  const notebookCwd = notebookAbsolutePath ? dirname(notebookAbsolutePath) : workspaceRootPath ?? undefined;
  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    containerRef,
    ({ text, eventTarget }) => {
      const sourceElement = eventTarget instanceof HTMLElement ? eventTarget : eventTarget instanceof Node ? eventTarget.parentElement : null;
      const cellElement = sourceElement?.closest<HTMLElement>("[data-cell-id]");
      const cellId = cellElement?.dataset.cellId;
      const cell = state.cells.find((item) => item.id === cellId);
      const cellIndex = cell ? state.cells.findIndex((item) => item.id === cell.id) : undefined;

      return createSelectionContext({
        sourceKind: "notebook",
        paneId,
        fileName,
        filePath,
        selectedText: text,
        documentText: typeof cell?.source === "string" ? cell.source : undefined,
        notebookCellId: cellId,
        notebookCellIndex: typeof cellIndex === "number" && cellIndex >= 0 ? cellIndex : undefined,
      });
    }
  );

  // Notebook executor for Run All functionality
  const {
    executionState,
    progress,
    runAll,
    runAllAbove,
    runAllBelow,
    interrupt,
    restartKernel,
    switchKernel,
  } = useNotebookExecutor({
    runner: currentKernel,
    cwd: notebookCwd,
    onCellStart: (cellId) => {
      clearCellOutputs(cellId);
    },
    onCellOutput: (cellId, output) => {
      const cell = state.cells.find(c => c.id === cellId);
      if (cell) {
        const newOutputs = [...(cell.outputs || [])];
        newOutputs.push(output);
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
  const debouncedNotifyChangeRef = useRef<((serialized: string) => void) | null>(null);

  // Debounced content change notification for better performance
  useEffect(() => {
    if (!onContentChange) {
      debouncedNotifyChangeRef.current = null;
      return;
    }
    debouncedNotifyChangeRef.current = debounce((serialized: string) => {
      if (serialized !== lastSerializedRef.current) {
        lastSerializedRef.current = serialized;
        onContentChange(serialized);
      }
    }, 300);
  }, [onContentChange]);

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

  useEffect(() => {
    if (!pendingNavigation || !isSameWorkspacePath(pendingNavigation.filePath, filePath)) {
      return;
    }

    if (pendingNavigation.target.type !== "notebook_cell") {
      return;
    }

    const targetCellId = pendingNavigation.target.cellId;
    const targetCell = state.cells.find((cell) => cell.id === targetCellId);
    const targetElement = cellElementRefs.current[targetCellId];
    if (!targetCell || !targetElement) {
      return;
    }

    activateCell(targetCell.id);
    targetElement.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimeoutRef.current) {
      window.clearTimeout(highlightTimeoutRef.current);
    }
    const frameId = window.requestAnimationFrame(() => {
      setHighlightedCellId(targetCell.id);
      highlightTimeoutRef.current = window.setTimeout(() => {
        setHighlightedCellId(null);
        highlightTimeoutRef.current = null;
      }, 1800);
    });
    consumePendingNavigation(paneId, filePath);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activateCell, consumePendingNavigation, filePath, paneId, pendingNavigation, state.cells]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  // Notify parent of content changes (debounced) - triggered by user edits
  useEffect(() => {
    if (!onContentChange) return;
    
    // Only notify if dirty (user made changes)
    if (!isDirty) return;
    
    const serialized = serialize();
    debouncedNotifyChangeRef.current?.(serialized);
  }, [state, serialize, isDirty, onContentChange]);

  /**
   * Handle kernel change
   */
  const handleKernelChange = useCallback(async (kernel: KernelOption) => {
    setCurrentKernel(kernel);
    await switchKernel(kernel);
  }, [switchKernel]);

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
      <SelectionContextMenu
        state={selectionMenuState}
        onClose={closeSelectionMenu}
        onOpenHub={(context, mode, returnFocusTo) => setSelectionHubState({ context, mode, returnFocusTo })}
      />

      <SelectionAiHub
        context={selectionHubState?.context ?? null}
        initialMode={selectionHubState?.mode ?? "chat"}
        returnFocusTo={selectionHubState?.returnFocusTo}
        onClose={() => setSelectionHubState(null)}
      />

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
            {/* Kernel Selector */}
            <KernelSelector
              currentKernel={currentKernel}
              onKernelChange={handleKernelChange}
              cwd={notebookCwd}
            />

            <div className="w-px h-4 bg-border" />

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
      </div>

      {/* Cells */}
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        {state.cells.map((cell, index) => (
          <div
            key={cell.id}
            data-cell-id={cell.id}
            ref={(element) => {
              cellElementRefs.current[cell.id] = element;
            }}
          >
            <NotebookCellComponent
              cell={cell}
              isActive={cell.id === state.activeCellId}
              isHighlighted={cell.id === highlightedCellId}
              canDelete={state.cells.length > 1}
              onActivate={() => activateCell(cell.id)}
              onAddAbove={(type) => addCellAbove(cell.id, type)}
              onAddBelow={(type) => addCellBelow(cell.id, type)}
              onDelete={() => removeCell(cell.id)}
              onSourceChange={(source) => updateSource(cell.id, source)}
              onTypeChange={(type) => changeType(cell.id, type)}
              onNavigateUp={index > 0 ? activatePrevCell : undefined}
              onNavigateDown={index < state.cells.length - 1 ? activateNextCell : undefined}
              runner={currentKernel}
              cwd={notebookCwd}
            />
          </div>
        ))}
      </div>

      {/* Save indicator */}
      <SaveIndicator status={saveStatus} />
    </div>
  );
}

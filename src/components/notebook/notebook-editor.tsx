"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Save,
  Loader2,
  Check,
  AlertCircle,
  Plus,
  Code,
  FileText,
  Play,
  Square,
  RotateCcw,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  FileCode2,
} from "lucide-react";
import { useNotebookEditor } from "@/hooks/use-notebook-editor";
import { useNotebookExecutor } from "@/hooks/use-notebook-executor";
import { NotebookCellComponent } from "./notebook-cell";
import { KernelSelector } from "./kernel-selector";
import { KernelStatus } from "./kernel-status";
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
import { useRunnerHealth } from "@/hooks/use-runner-health";
import { jupyterOutputsToExecutionOutputs } from "@/lib/runner/output-utils";
import { diagnosticsToExecutionProblems, mergeExecutionProblems, outputsToExecutionProblems, runnerHealthIssuesToExecutionProblems } from "@/lib/runner/problem-utils";
import { ProblemsPanel } from "@/components/runner/problems-panel";
import { WorkspaceRunnerManager } from "@/components/runner/workspace-runner-manager";

interface NotebookEditorProps {
  content: string;
  fileName: string;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
  paneId: PaneId;
  filePath: string;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-3 py-2 shadow-lg transition-all",
        status === "saving" && "bg-muted text-muted-foreground",
        status === "saved" && "bg-green-500/10 text-green-600 dark:text-green-400",
        status === "error" && "bg-destructive/10 text-destructive",
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

function resolveNotebookLanguage(metadata: ReturnType<typeof useNotebookEditor>["state"]["metadata"]): string {
  return metadata.language_info?.name?.trim()
    || metadata.kernelspec?.language?.trim()
    || "python";
}

function resolveNotebookKernelLabel(metadata: ReturnType<typeof useNotebookEditor>["state"]["metadata"]): string | null {
  return metadata.kernelspec?.display_name?.trim()
    || metadata.kernelspec?.name?.trim()
    || null;
}

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
    appendCellOutput,
    updateCellExecutionCount,
    updateCellExecutionMeta,
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
  const workspaceRootHandle = useWorkspaceStore((workspace) => workspace.rootHandle);
  const workspaceRootPath = useWorkspaceStore((workspace) => workspace.workspaceRootPath);
  const notebookAbsolutePath = resolveWorkspaceFilePath(workspaceRootPath, filePath, rootName);
  const notebookCwd = notebookAbsolutePath ? dirname(notebookAbsolutePath) : workspaceRootPath ?? undefined;
  const notebookLanguage = useMemo(() => resolveNotebookLanguage(state.metadata), [state.metadata]);
  const notebookKernelLabel = useMemo(() => resolveNotebookKernelLabel(state.metadata), [state.metadata]);
  const isPythonNotebook = notebookLanguage.trim().toLowerCase() === "python";
  const healthContext = useMemo(
    () => ({
      kind: "workspace" as const,
      filePath,
      label: "Notebook Runtime",
    }),
    [filePath],
  );
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
    },
  );

  const {
    executionState,
    currentCellId,
    progress,
    runtimeStatus,
    runtimeError,
    runtimeProblems,
    prepareRuntime,
    runAll,
    runAllAbove,
    runAllBelow,
    interrupt,
    restartKernel,
    switchKernel,
    executeCell,
  } = useNotebookExecutor({
    runner: currentKernel,
    cwd: notebookCwd,
    filePath,
    notebookLanguage,
    onCellStart: (cellId) => {
      clearCellOutputs(cellId);
    },
    onCellOutput: (cellId, output) => {
      appendCellOutput(cellId, output);
    },
    onCellComplete: (cellId, result) => {
      updateCellExecutionCount(cellId, result.executionCount);
      updateCellExecutionMeta(cellId, result.panelMeta);
    },
  });
  const {
    runnerHealthSnapshot,
    isRefreshing: isRefreshingRunnerHealth,
    refresh: refreshRunnerHealth,
  } = useRunnerHealth({
    cwd: notebookCwd,
    fileKey: filePath,
    checkPython: currentKernel?.runnerType === "python-local",
    autoRefresh: Boolean(currentKernel && isPythonNotebook),
  });

  const currentFileRef = useRef(fileName);
  const currentContentRef = useRef(content);
  const lastSerializedRef = useRef<string | null>(content);
  const debouncedNotifyChangeRef = useRef<((serialized: string) => void) | null>(null);

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

  useEffect(() => {
    const fileChanged = fileName !== currentFileRef.current;
    const contentChanged = content !== currentContentRef.current;
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

  useEffect(() => {
    if (!onContentChange || !isDirty) return;
    const serialized = serialize();
    debouncedNotifyChangeRef.current?.(serialized);
  }, [state, serialize, isDirty, onContentChange]);

  const handleKernelChange = useCallback(async (kernel: KernelOption) => {
    setCurrentKernel(kernel);
    await switchKernel(kernel);
  }, [switchKernel]);

  const handleSave = useCallback(async () => {
    if (!onSave) return;

    setSaveStatus("saving");
    try {
      await onSave();
      markClean();
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [onSave, markClean]);

  const handleVerifyRuntime = useCallback(async () => {
    await refreshRunnerHealth();
    await prepareRuntime();
  }, [prepareRuntime, refreshRunnerHealth]);

  const handleRunAll = useCallback(async () => {
    const cells = state.cells.map((cell) => ({
      id: cell.id,
      source: cell.source,
      type: cell.cell_type,
    }));
    await runAll(cells);
  }, [state.cells, runAll]);

  const handleRunAllAbove = useCallback(async () => {
    if (!state.activeCellId) return;
    const cells = state.cells.map((cell) => ({
      id: cell.id,
      source: cell.source,
      type: cell.cell_type,
    }));
    await runAllAbove(cells, state.activeCellId);
  }, [state.cells, state.activeCellId, runAllAbove]);

  const handleRunAllBelow = useCallback(async () => {
    if (!state.activeCellId) return;
    const cells = state.cells.map((cell) => ({
      id: cell.id,
      source: cell.source,
      type: cell.cell_type,
    }));
    await runAllBelow(cells, state.activeCellId);
  }, [state.cells, state.activeCellId, runAllBelow]);

  const handleRunCell = useCallback(async (cellId: string, source: string) => {
    clearCellOutputs(cellId);
    const result = await executeCell(cellId, source);
    updateCellExecutionCount(cellId, result.executionCount);
    updateCellExecutionMeta(cellId, result.panelMeta);
    return result;
  }, [clearCellOutputs, executeCell, updateCellExecutionCount, updateCellExecutionMeta]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        if (isPythonNotebook) {
          void handleRunAll();
        }
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "A") {
        e.preventDefault();
        addCellAboveActive("code");
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "B") {
        e.preventDefault();
        addCellBelowActive("code");
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "M") {
        e.preventDefault();
        addCellBelowActive("markdown");
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "R") {
        e.preventDefault();
        addCellBelowActive("raw");
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
        e.preventDefault();
        deleteActiveCell();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleSave, handleRunAll, isPythonNotebook, addCellAboveActive, addCellBelowActive, deleteActiveCell]);

  const healthProblems = useMemo(
    () => runnerHealthIssuesToExecutionProblems(runnerHealthSnapshot.issues, healthContext),
    [healthContext, runnerHealthSnapshot.issues],
  );

  const cellProblems = useMemo(
    () => state.cells.flatMap((cell) => {
      if (cell.cell_type !== "code") {
        return [];
      }

      const context = {
        kind: "notebook-cell" as const,
        filePath,
        cellId: cell.id,
        label: `Cell [${cell.execution_count ?? " "}]`,
        language: notebookLanguage,
      };

      return mergeExecutionProblems(
        diagnosticsToExecutionProblems(cell.execution_meta?.diagnostics ?? [], "preflight", context),
        outputsToExecutionProblems(jupyterOutputsToExecutionOutputs(cell.outputs), context),
      );
    }),
    [filePath, notebookLanguage, state.cells],
  );

  const notebookProblems = useMemo(
    () => mergeExecutionProblems(runtimeProblems, healthProblems, cellProblems),
    [runtimeProblems, healthProblems, cellProblems],
  );

  const canExecuteNotebook = isPythonNotebook
    && Boolean(currentKernel)
    && (
      currentKernel?.runnerType === "python-pyodide"
      || runtimeStatus === "ready"
      || executionState === "running"
    );

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

      <div className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between px-6 py-3">
          <div>
            <h1 className="font-semibold text-foreground">{fileName}</h1>
            <p className="text-xs text-muted-foreground">
              {state.cells.length} cell{state.cells.length !== 1 ? "s" : ""} · {notebookKernelLabel ?? notebookLanguage}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <KernelSelector
              currentKernel={currentKernel}
              onKernelChange={handleKernelChange}
              cwd={notebookCwd}
              filePath={filePath}
              notebookLanguage={notebookLanguage}
              notebookKernelLabel={notebookKernelLabel}
            />

            <div className="h-4 w-px bg-border" />

            <div className="relative">
              {executionState === "running" ? (
                <button
                  onClick={() => void interrupt()}
                  className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive transition-colors hover:bg-destructive/20"
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
                    onClick={() => void handleRunAll()}
                    disabled={!canExecuteNotebook}
                    className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                    title="Run all cells (Ctrl+Shift+Enter)"
                  >
                    <Play className="h-3 w-3" />
                    <span>Run All</span>
                  </button>
                  <button
                    onClick={() => setRunMenuOpen(!runMenuOpen)}
                    disabled={!isPythonNotebook}
                    className="rounded-md px-1 py-1 text-xs transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {runMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setRunMenuOpen(false)} />
                      <div className="absolute right-0 top-full z-20 mt-1 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md">
                        <button
                          onClick={() => {
                            void handleRunAll();
                            setRunMenuOpen(false);
                          }}
                          disabled={!canExecuteNotebook}
                          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                        >
                          <Play className="h-3 w-3" />
                          <span>Run All</span>
                        </button>
                        <button
                          onClick={() => {
                            void handleRunAllAbove();
                            setRunMenuOpen(false);
                          }}
                          disabled={!canExecuteNotebook}
                          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                        >
                          <Play className="h-3 w-3" />
                          <span>Run All Above</span>
                        </button>
                        <button
                          onClick={() => {
                            void handleRunAllBelow();
                            setRunMenuOpen(false);
                          }}
                          disabled={!canExecuteNotebook}
                          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
                        >
                          <Play className="h-3 w-3" />
                          <span>Run All Below</span>
                        </button>
                        <div className="my-1 border-t border-border" />
                        <button
                          onClick={() => {
                            void restartKernel();
                            setRunMenuOpen(false);
                          }}
                          disabled={!isPythonNotebook || !currentKernel}
                          className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs text-destructive hover:bg-accent disabled:opacity-50"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Restart Runtime</span>
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="h-4 w-px bg-border" />

            <button
              onClick={() => addCellBelowActive("code")}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent"
              title="Add code cell (Ctrl+Shift+B)"
            >
              <Plus className="h-3 w-3" />
              <Code className="h-3 w-3" />
            </button>
            <button
              onClick={() => addCellBelowActive("markdown")}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent"
              title="Add markdown cell (Ctrl+Shift+M)"
            >
              <Plus className="h-3 w-3" />
              <FileText className="h-3 w-3" />
            </button>
            <button
              onClick={() => addCellBelowActive("raw")}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent"
              title="Add raw cell (Ctrl+Shift+R)"
            >
              <Plus className="h-3 w-3" />
              <FileCode2 className="h-3 w-3" />
            </button>

            <div className="mx-1 h-4 w-px bg-border" />

            {onSave && (
              <button
                onClick={handleSave}
                disabled={saveStatus === "saving"}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent",
                  saveStatus === "saving" && "cursor-not-allowed opacity-50",
                )}
              >
                <Save className="h-4 w-4" />
                <span>Save</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="sticky top-[61px] z-10 border-b border-border bg-muted/40 backdrop-blur">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-full bg-background px-2 py-0.5 font-medium text-foreground">
                {currentKernel?.displayName ?? (isPythonNotebook ? "未选择运行环境" : "当前内核不支持执行")}
              </span>
              {currentKernel?.sourceLabel ? (
                <span className="rounded-full border border-border px-2 py-0.5">
                  {currentKernel.sourceLabel}
                </span>
              ) : null}
              {runnerHealthSnapshot.selectedPythonPath ? (
                <span className="truncate">{runnerHealthSnapshot.selectedPythonPath}</span>
              ) : null}
            </div>
            {!isPythonNotebook ? (
              <div className="mt-2 text-sm text-yellow-700 dark:text-yellow-300">
                当前 Notebook 内核为 {notebookKernelLabel ?? notebookLanguage}，本轮仅支持 Python Notebook 执行。
              </div>
            ) : null}
            {runtimeError ? (
              <div className="mt-2 text-sm text-destructive">{runtimeError}</div>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <KernelStatus status={runtimeStatus} error={runtimeError} />
            <button
              onClick={() => void handleVerifyRuntime()}
              disabled={!isPythonNotebook || isRefreshingRunnerHealth || runtimeStatus === "loading"}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", (isRefreshingRunnerHealth || runtimeStatus === "loading") && "animate-spin")} />
              <span>验证环境</span>
            </button>
            <WorkspaceRunnerManager
              cwd={notebookCwd}
              fileKey={filePath}
              title="Notebook Runner Manager"
              triggerLabel="Runner"
            />
          </div>
        </div>

        {notebookProblems.length > 0 ? (
          <div className="mx-auto max-w-4xl px-6 pb-3">
            <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Notebook Problems</span>
              <span>{notebookProblems.length}</span>
            </div>
            <ProblemsPanel problems={notebookProblems} variant="compact" />
          </div>
        ) : null}
      </div>

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
              rootHandle={workspaceRootHandle}
              notebookFilePath={filePath}
              onRunCell={isPythonNotebook ? handleRunCell : undefined}
              isExecuting={executionState === "running" && currentCellId === cell.id}
              canRunCell={canExecuteNotebook}
            />
          </div>
        ))}
      </div>

      <SaveIndicator status={saveStatus} />
    </div>
  );
}

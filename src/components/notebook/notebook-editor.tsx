"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  Loader2,
  Check,
  AlertCircle,
  AlertTriangle,
  Code2,
  FileText,
  Play,
  RotateCw,
  Square,
} from "lucide-react";
import { useNotebookEditor } from "@/hooks/use-notebook-editor";
import { useNotebookExecutor } from "@/hooks/use-notebook-executor";
import { NotebookCellComponent } from "./notebook-cell";
import { KernelSelector } from "./kernel-selector";
import { KernelStatus } from "./kernel-status";
import { cn } from "@/lib/utils";
import { debounce } from "@/lib/fast-save";
import type { KernelOption } from "./kernel-selector";
import type { CommandBarState, PaneId } from "@/types/layout";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { resolveNotebookReference } from "@/lib/reference-navigation";
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
import { isTauriHost } from "@/lib/storage-adapter";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { useI18n } from "@/hooks/use-i18n";
import { buildPersistedFileViewStateKey } from "@/lib/file-view-state";
import { usePersistedViewState } from "@/hooks/use-persisted-view-state";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import {
  resolveNotebookCodeEditorLanguage,
  resolveNotebookKernelLabel,
  resolveNotebookLanguage,
} from "@/lib/notebook-utils";

interface NotebookEditorProps {
  content: string;
  fileName: string;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
  paneId: PaneId;
  tabId: string;
  filePath: string;
  executionScopeId: string;
  executionMode?: "workspace-file" | "inline-only";
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function SaveIndicator({
  status,
  savingLabel,
  savedLabel,
  errorLabel,
}: {
  status: SaveStatus;
  savingLabel: string;
  savedLabel: string;
  errorLabel: string;
}) {
  if (status === "idle") return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg px-3 py-2 shadow-lg transition-all",
        status === "saving" && "code-workbench-pill",
        status === "saved" && "code-workbench-status-success",
        status === "error" && "code-workbench-status-error",
      )}
    >
      {status === "saving" && (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">{savingLabel}</span>
        </>
      )}
      {status === "saved" && (
        <>
          <Check className="h-4 w-4" />
          <span className="text-sm">{savedLabel}</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">{errorLabel}</span>
        </>
      )}
    </div>
  );
}

function isKernelOption(value: unknown): value is KernelOption {
  return Boolean(value && typeof value === "object" && "runnerType" in (value as Record<string, unknown>));
}

function notebookCellVirtualExtension(language: string): string {
  switch (language) {
    case "typescript": return "ts";
    case "javascript": return "js";
    case "rust": return "rs";
    case "cpp": return "cpp";
    case "c": return "c";
    case "java": return "java";
    default: return "py";
  }
}

function buildNotebookCellDocumentPath(
  notebookAbsolutePath: string | null,
  cellId: string,
  language: string,
): string | undefined {
  if (!notebookAbsolutePath) return undefined;
  const safeCellId = cellId.replace(/[^a-zA-Z0-9._-]/g, "-");
  const basePath = notebookAbsolutePath.replace(/\.ipynb$/i, "");
  return `${basePath}.cell-${safeCellId}.${notebookCellVirtualExtension(language)}`;
}

export function NotebookEditor({ content, fileName, onContentChange, onSave, paneId, tabId, filePath, executionScopeId, executionMode = "workspace-file" }: NotebookEditorProps) {
  const { t } = useI18n();
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
    syncExecutionState,
  } = useNotebookEditor(content);

  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
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
  const completePendingNavigation = useLinkNavigationStore((state) => state.completePendingNavigation);
  const rootName = useWorkspaceStore((workspace) => workspace.rootHandle?.name ?? workspace.fileTree.root?.name ?? null);
  const workspaceRootHandle = useWorkspaceStore((workspace) => executionMode === "inline-only" ? null : workspace.rootHandle);
  const workspaceRootPath = useWorkspaceStore((workspace) => executionMode === "inline-only" ? null : workspace.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((workspace) => workspace.workspaceIdentity?.workspaceKey ?? null);
  const runnerPreferences = useWorkspaceStore((workspace) => workspace.runnerPreferences);
  const persistedViewStateKey = useMemo(
    () => buildPersistedFileViewStateKey({
      kind: "notebook",
      workspaceKey,
      workspaceRootPath,
      filePath,
      fallbackName: fileName,
    }),
    [fileName, filePath, workspaceKey, workspaceRootPath],
  );
  const notebookAbsolutePath = executionMode === "inline-only" ? null : resolveWorkspaceFilePath(workspaceRootPath, filePath, rootName);
  const notebookCwd = notebookAbsolutePath ? dirname(notebookAbsolutePath) : workspaceRootPath ?? undefined;
  const notebookLanguage = useMemo(() => resolveNotebookLanguage(state.metadata), [state.metadata]);
  const codeEditorLanguage = useMemo(
    () => resolveNotebookCodeEditorLanguage(notebookLanguage),
    [notebookLanguage],
  );
  const notebookKernelLabel = useMemo(() => resolveNotebookKernelLabel(state.metadata), [state.metadata]);
  const isPythonNotebook = notebookLanguage.trim().toLowerCase() === "python";
  const isDesktopHost = useMemo(() => isTauriHost(), []);
  const [notebookProblemsState, setNotebookProblemsState] = useState<{ filePath: string; open: boolean }>({
    filePath,
    open: false,
  });
  const [activeCodeCellCommands, setActiveCodeCellCommands] = useState<{
    cellId: string;
    openSearch: () => void;
    openGotoLine: () => void;
  } | null>(null);
  const showNotebookProblems = notebookProblemsState.filePath === filePath && notebookProblemsState.open;
  const healthContext = useMemo(
    () => ({
      kind: "workspace" as const,
      filePath,
      label: t("workbench.runner.currentNotebookEnv"),
    }),
    [filePath, t],
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

  const preferredKernel = useMemo<KernelOption | null>(() => {
    const fileKey = filePath ?? "__notebook__";
    const recent = runnerPreferences.recentRunByFile[fileKey];

    if (recent?.runnerType === "python-pyodide") {
      return {
        id: "pyodide",
        runnerType: "python-pyodide",
        displayName: isDesktopHost ? t("workbench.notebook.kernel.pyodideFallback") : t("workbench.notebook.kernel.pyodideBrowser"),
        description: isDesktopHost
          ? t("workbench.notebook.kernel.localFallback")
          : t("workbench.notebook.kernel.browserPython"),
        selectionSource: "current-entry",
        sourceLabel: t("workbench.notebook.kernel.currentEntry"),
        supported: true,
        unsupportedReason: null,
      };
    }

    if (recent?.runnerType === "python-local" && recent.command) {
      const displayName = notebookKernelLabel ?? `Python (${recent.command.split(/[\\/]/).pop() ?? "local"})`;
      return {
        id: `python-local:recent:${recent.command}`,
        runnerType: "python-local",
        displayName,
        description: recent.command,
        command: recent.command,
        selectionSource: "current-entry",
        sourceLabel: t("workbench.notebook.kernel.currentEntry"),
        supported: true,
        unsupportedReason: null,
      };
    }

    if (!isPythonNotebook) {
      return null;
    }

    if (isDesktopHost) {
      const defaultPythonPath = runnerPreferences.defaultPythonPath;
      return {
        id: defaultPythonPath ? `python-local:workspace:${defaultPythonPath}` : "python-local:metadata",
        runnerType: "python-local",
        displayName: notebookKernelLabel ?? "Python 3",
        description: defaultPythonPath ?? t("workbench.notebook.runtime.unverified"),
        command: defaultPythonPath ?? undefined,
        selectionSource: defaultPythonPath ? "workspace-default" : "metadata",
        sourceLabel: defaultPythonPath ? t("workbench.notebook.kernel.workspaceDefault") : t("workbench.notebook.kernel.metadata", { kernel: notebookKernelLabel ?? "Python" }),
        supported: true,
        unsupportedReason: null,
      };
    }

    return {
      id: "pyodide:web-default",
      runnerType: "python-pyodide",
      displayName: t("workbench.notebook.kernel.pyodideBrowser"),
      description: t("workbench.notebook.kernel.browserDescription"),
      selectionSource: "fallback",
      sourceLabel: t("workbench.notebook.kernel.browser"),
      supported: true,
      unsupportedReason: null,
    };
  }, [filePath, isDesktopHost, isPythonNotebook, notebookKernelLabel, runnerPreferences, t]);

  const {
    executionState,
    currentCellId,
    runtimeStatus,
    runtimeAvailability,
    runtimeError,
    runtimeProblems,
    hasValidatedRuntime,
    prepareRuntime,
    runAll,
    interrupt,
    restartKernel,
    switchKernel,
    executeCell,
    kernel: selectedKernel,
    cellStates,
    commandState,
  } = useNotebookExecutor({
    scope: {
      scopeId: executionScopeId,
      kind: "notebook",
      paneId,
      tabId,
      filePath,
      fileName,
    },
    runner: preferredKernel,
    cwd: notebookCwd,
    filePath,
    notebookLanguage,
  });
  const currentKernel = isKernelOption(selectedKernel) ? selectedKernel : preferredKernel;
  const {
    runnerHealthSnapshot,
    isRefreshing: isRefreshingRunnerHealth,
    refresh: refreshRunnerHealth,
  } = useRunnerHealth({
    cwd: notebookCwd,
    fileKey: filePath,
    checkPython: currentKernel?.runnerType === "python-local",
    autoRefresh: false,
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

    const resolution = resolveNotebookReference(
      pendingNavigation.target,
      state.cells.map((cell) => cell.id),
    );
    if (!resolution) return;
    if (resolution.status !== "success") {
      completePendingNavigation(paneId, pendingNavigation.requestId, { status: resolution.status });
      return;
    }
    const targetCellId = resolution.cellId;
    if (!targetCellId) return;
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
      completePendingNavigation(paneId, pendingNavigation.requestId, { status: "success" });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [activateCell, completePendingNavigation, filePath, paneId, pendingNavigation, state.cells]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        window.clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  usePersistedViewState({
    storageKey: persistedViewStateKey,
    containerRef,
    viewState: {
      activeCellId: state.activeCellId,
    },
    applyViewState: (persisted) => {
      if (typeof persisted?.activeCellId === "string") {
        activateCell(persisted.activeCellId);
      }
    },
  });

  // Only serialize when cells content actually changes, not on activeCellId or other state changes
  const cellsFingerprint = useMemo(
    () => state.cells.map(c => `${c.id}:${c.cell_type}:${c.source.length}`).join("|"),
    [state.cells],
  );

  useEffect(() => {
    if (!onContentChange || !isDirty) return;
    const serialized = serialize();
    debouncedNotifyChangeRef.current?.(serialized);
  }, [cellsFingerprint, serialize, isDirty, onContentChange]);

  useEffect(() => {
    syncExecutionState(cellStates);
  }, [cellStates, syncExecutionState]);

  const handleKernelChange = useCallback(async (kernel: KernelOption) => {
    setNotebookProblemsState({
      filePath,
      open: false,
    });
    await switchKernel(kernel);
  }, [filePath, switchKernel]);

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
    setNotebookProblemsState({
      filePath,
      open: false,
    });
    await refreshRunnerHealth();
    const ok = await prepareRuntime();
    if (!ok) {
      setNotebookProblemsState({
        filePath,
        open: true,
      });
    }
  }, [filePath, prepareRuntime, refreshRunnerHealth]);

  const handleRunAll = useCallback(async () => {
    if (!commandState.canRun) {
      return;
    }
    setNotebookProblemsState({
      filePath,
      open: false,
    });
    const cells = state.cells.map((cell) => ({
      id: cell.id,
      source: cell.source,
      type: cell.cell_type,
    }));
    await runAll(cells);
  }, [commandState.canRun, filePath, state.cells, runAll]);

  const handleRunCell = useCallback(async (cellId: string, source: string) => {
    if (!commandState.canRun) {
      return {
        cellId,
        outputs: [],
        executionCount: 0,
        success: false,
      };
    }
    setNotebookProblemsState({
      filePath,
      open: false,
    });
    const result = await executeCell(cellId, source);
    if (!result.success) {
      setNotebookProblemsState({
        filePath,
        open: true,
      });
    }
    return result;
  }, [commandState.canRun, executeCell, filePath]);

  const handleLinkNavigate = useCallback((target: string) => {
    void navigateLink(target, {
      paneId,
      rootHandle: workspaceRootHandle,
      currentFilePath: filePath,
    });
  }, [filePath, paneId, workspaceRootHandle]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "Enter") {
        e.preventDefault();
        if (isPythonNotebook && commandState.canRun) {
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
  }, [handleSave, handleRunAll, isPythonNotebook, addCellAboveActive, addCellBelowActive, deleteActiveCell, commandState.canRun]);

  const healthProblems = useMemo(
    () => runnerHealthIssuesToExecutionProblems(runnerHealthSnapshot.issues, healthContext),
    [healthContext, runnerHealthSnapshot.issues],
  );

  // Only recompute cell problems when code cells' outputs/diagnostics actually change
  const codeCellProblemFingerprint = useMemo(
    () => state.cells
      .filter(c => c.cell_type === "code")
      .map(c => `${c.id}:${c.execution_count ?? ""}:${(c.outputs?.length ?? 0)}:${(c.execution_meta?.diagnostics?.length ?? 0)}`)
      .join("|"),
    [state.cells],
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filePath, notebookLanguage, codeCellProblemFingerprint],
  );

  const notebookProblems = useMemo(
    () => mergeExecutionProblems(runtimeProblems, healthProblems, cellProblems),
    [runtimeProblems, healthProblems, cellProblems],
  );

  const canExecuteNotebook = isPythonNotebook
    && Boolean(currentKernel)
    && commandState.canRun;

  const commandBarState = useMemo<CommandBarState>(() => {
    const breadcrumbs = filePath.split("/").filter(Boolean).map((segment) => ({ label: segment }));
    return {
      breadcrumbs,
      actions: [
        {
          id: "save",
          label: t("common.save"),
          priority: 10,
          group: "primary",
          disabled: !onSave || saveStatus === "saving",
          onTrigger: () => { void handleSave(); },
        },
        {
          id: "search-active-cell",
          label: t("workbench.commandBar.searchInFile"),
          icon: "search",
          tooltip: t("workbench.commandBar.searchInFile"),
          priority: 15,
          group: "secondary",
          disabled: !activeCodeCellCommands,
          onTrigger: () => activeCodeCellCommands?.openSearch(),
        },
        {
          id: "goto-active-cell-line",
          label: t("workbench.commandBar.gotoLine"),
          icon: "scan-search",
          tooltip: t("workbench.commandBar.gotoLine"),
          priority: 16,
          group: "secondary",
          disabled: !activeCodeCellCommands,
          onTrigger: () => activeCodeCellCommands?.openGotoLine(),
        },
        {
          id: executionState === "running" ? "stop" : "verify",
          label: executionState === "running" ? t("workbench.commandBar.stop") : t("workbench.commandBar.verify"),
          priority: 20,
          group: "primary",
          disabled: executionState === "running"
            ? !commandState.canInterrupt
            : !commandState.canVerifyRuntime || !isPythonNotebook || isRefreshingRunnerHealth || runtimeStatus === "loading",
          onTrigger: executionState === "running"
            ? () => { void interrupt(); }
            : () => { void handleVerifyRuntime(); },
        },
        {
          id: "run-all",
          label: t("workbench.commandBar.runAll"),
          priority: 21,
          group: "primary",
          disabled: !commandState.canRun || !canExecuteNotebook || executionState === "running",
          onTrigger: () => { void handleRunAll(); },
        },
        {
          id: "restart-kernel",
          label: t("workbench.notebook.command.restartKernel"),
          priority: 22,
          group: "secondary",
          disabled: !commandState.canRestart,
          onTrigger: () => { void restartKernel(); },
        },
        {
          id: "add-code-cell",
          label: t("workbench.notebook.command.newCode"),
          priority: 30,
          group: "secondary",
          onTrigger: () => addCellBelowActive("code"),
        },
        {
          id: "add-markdown-cell",
          label: t("workbench.notebook.command.newMarkdown"),
          priority: 31,
          group: "secondary",
          onTrigger: () => addCellBelowActive("markdown"),
        },
        {
          id: "add-raw-cell",
          label: t("workbench.notebook.command.newRaw"),
          priority: 32,
          group: "secondary",
          onTrigger: () => addCellBelowActive("raw"),
        },
      ],
    };
  }, [
    activeCodeCellCommands,
    canExecuteNotebook,
    executionState,
    filePath,
    handleRunAll,
    handleSave,
    handleVerifyRuntime,
    interrupt,
    addCellBelowActive,
    isPythonNotebook,
    isRefreshingRunnerHealth,
    onSave,
    commandState.canInterrupt,
    commandState.canRestart,
    commandState.canRun,
    commandState.canVerifyRuntime,
    restartKernel,
    runtimeStatus,
    saveStatus,
    t,
  ]);

  usePaneCommandBar({
    paneId,
    scopeId: executionScopeId,
    state: commandBarState,
  });

  const runtimeStatusLabel = runtimeAvailability === "ready"
    ? t("workbench.notebook.runtime.ready")
    : runtimeAvailability === "checking"
      ? t("workbench.notebook.runtime.checking")
      : runtimeAvailability === "error"
        ? t("workbench.notebook.runtime.error")
        : runtimeAvailability === "unsupported"
          ? t("workbench.notebook.runtime.unsupportedShort")
          : t("workbench.notebook.runtime.unverified");

  const notebookKernelStatus = executionState === "running" ? "running" : runtimeStatus;

  // Stable cell callbacks — avoid creating new closures per cell per render
  const handleCellActivate = useCallback((cellId: string) => {
    activateCell(cellId);
  }, [activateCell]);

  const handleCellAddAbove = useCallback((cellId: string, type: "markdown" | "code" | "raw") => {
    addCellAbove(cellId, type);
  }, [addCellAbove]);

  const handleCellAddBelow = useCallback((cellId: string, type: "markdown" | "code" | "raw") => {
    addCellBelow(cellId, type);
  }, [addCellBelow]);

  const handleCellDelete = useCallback((cellId: string) => {
    removeCell(cellId);
  }, [removeCell]);

  const handleCellSourceChange = useCallback((cellId: string, source: string) => {
    updateSource(cellId, source);
  }, [updateSource]);

  const handleCellTypeChange = useCallback((cellId: string, type: "markdown" | "code" | "raw") => {
    changeType(cellId, type);
  }, [changeType]);

  const handleCodeCellEditorCommandsChange = useCallback((
    cellId: string,
    commands: { openSearch: () => void; openGotoLine: () => void } | null,
  ) => {
    setActiveCodeCellCommands((current) => {
      if (!commands) {
        return current?.cellId === cellId ? null : current;
      }
      return { cellId, ...commands };
    });
  }, []);

  const cellCount = state.cells.length;
  const codeCells = useMemo(
    () => state.cells.filter((cell) => cell.cell_type === "code"),
    [state.cells],
  );
  const firstCodeCellId = codeCells[0]?.id ?? null;
  const handleJumpToFirstCodeCell = useCallback(() => {
    if (!firstCodeCellId) return;
    const targetElement = cellElementRefs.current[firstCodeCellId];
    if (!targetElement) return;

    activateCell(firstCodeCellId);
    targetElement.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => {
      targetElement.querySelector<HTMLElement>('[contenteditable="true"], textarea')?.focus();
    });
  }, [activateCell, firstCodeCellId]);
  const canDeleteCell = cellCount > 1;
  const canRunCellValue = isPythonNotebook && commandState.canRun;
  const runCellHandler = isPythonNotebook ? handleRunCell : undefined;

  return (
    <div ref={containerRef} className="code-workbench-shell h-full overflow-auto">
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

      <div className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex min-h-10 max-w-[1280px] items-center gap-1 px-3 py-1.5">
          <button
            type="button"
            onClick={() => void handleRunAll()}
            disabled={!commandState.canRun || !canExecuteNotebook || executionState === "running"}
            className="flex h-7 items-center gap-1.5 px-2 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
            title={t("workbench.commandBar.runAll")}
          >
            <Play className="h-3.5 w-3.5 fill-current" />
            <span>{t("workbench.commandBar.runAll")}</span>
          </button>
          <button
            type="button"
            onClick={() => void interrupt()}
            disabled={!commandState.canInterrupt}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            title={t("workbench.commandBar.stop")}
            aria-label={t("workbench.commandBar.stop")}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
          <button
            type="button"
            onClick={() => void restartKernel()}
            disabled={!commandState.canRestart}
            className="flex h-7 w-7 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
            title={t("workbench.notebook.command.restartKernel")}
            aria-label={t("workbench.notebook.command.restartKernel")}
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <div className="mx-1 h-5 w-px bg-border" />
          <button
            type="button"
            onClick={() => addCellBelowActive("code")}
            className="flex h-7 items-center gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title={t("workbench.notebook.command.newCode")}
          >
            <Code2 className="h-3.5 w-3.5" />
            <span>{t("notebook.cell.code")}</span>
          </button>
          <button
            type="button"
            onClick={() => addCellBelowActive("markdown")}
            className="flex h-7 items-center gap-1.5 px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            title={t("workbench.notebook.command.newMarkdown")}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Markdown</span>
          </button>

          <div className="min-w-4 flex-1" />
          <KernelStatus status={notebookKernelStatus} error={runtimeError} />
          <WorkspaceRunnerManager
            cwd={notebookCwd}
            fileKey={filePath}
            title={t("workbench.runner.managerNotebook")}
            triggerLabel={t("workbench.runner.trigger")}
            triggerClassName="h-7 px-2 text-xs hover:bg-muted"
          />
          <KernelSelector
            currentKernel={currentKernel}
            onKernelChange={handleKernelChange}
            cwd={notebookCwd}
            filePath={filePath}
            notebookLanguage={notebookLanguage}
            notebookKernelLabel={notebookKernelLabel}
          />
        </div>

        <div className="border-t border-border/70 bg-muted/30">
          <div className="mx-auto flex min-h-7 max-w-[1280px] items-center gap-3 px-4 text-[11px] text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${runtimeAvailability === "ready" ? "bg-emerald-500" : runtimeAvailability === "error" ? "bg-red-500" : runtimeAvailability === "checking" ? "bg-blue-500" : "bg-amber-500"}`} />
            <span className="font-medium text-foreground">{runtimeStatusLabel}</span>
            <span className="truncate">{currentKernel?.description ?? currentKernel?.displayName ?? t("workbench.notebook.runtime.unselected")}</span>
            {currentKernel?.sourceLabel ? <span className="border-l border-border pl-3">{currentKernel.sourceLabel}</span> : null}
            {firstCodeCellId ? (
              <button
                type="button"
                aria-label={t("workbench.notebook.jumpToFirstCode")}
                title={t("workbench.notebook.jumpToFirstCode")}
                onClick={handleJumpToFirstCodeCell}
                className="ml-auto flex h-6 shrink-0 items-center gap-1.5 px-1.5 text-foreground hover:bg-muted"
              >
                <Code2 className="h-3.5 w-3.5" />
                <span className="capitalize">{codeEditorLanguage}</span>
                <span aria-hidden="true">·</span>
                <span>{t("workbench.notebook.codeCells", { count: codeCells.length })}</span>
              </button>
            ) : null}
            <span className={cn("shrink-0", firstCodeCellId ? "border-l border-border pl-3" : "ml-auto")}>
              {state.cells.length} cell{state.cells.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>

        {!isPythonNotebook ? (
          <div className="mx-auto max-w-[1280px] border-t border-border px-4 py-2 text-sm text-amber-700 dark:text-amber-300">
            {t("workbench.notebook.runtime.unsupported", { kernel: notebookKernelLabel ?? notebookLanguage })}
          </div>
        ) : null}
        {hasValidatedRuntime && runtimeError ? (
          <div className="mx-auto max-w-[1280px] border-t border-border px-4 py-2 text-sm text-destructive">{runtimeError}</div>
        ) : null}
        {showNotebookProblems && notebookProblems.length > 0 ? (
          <div className="mx-auto max-w-[1280px] border-t border-border px-4 py-2">
            <div className="code-workbench-soft-text mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wide">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{t("workbench.notebook.problems")}</span>
              <span>{notebookProblems.length}</span>
            </div>
            <ProblemsPanel problems={notebookProblems} variant="compact" />
          </div>
        ) : null}
      </div>

      <div className="mx-auto w-full max-w-[1280px] space-y-1 px-3 py-3 md:px-4">
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
              cellId={cell.id}
              isActive={cell.id === state.activeCellId}
              isHighlighted={cell.id === highlightedCellId}
              canDelete={canDeleteCell}
              onActivate={handleCellActivate}
              onAddAbove={handleCellAddAbove}
              onAddBelow={handleCellAddBelow}
              onDelete={handleCellDelete}
              onSourceChange={handleCellSourceChange}
              onTypeChange={handleCellTypeChange}
              onNavigateUp={index > 0 ? activatePrevCell : undefined}
              onNavigateDown={index < cellCount - 1 ? activateNextCell : undefined}
              onLinkNavigate={handleLinkNavigate}
              rootHandle={workspaceRootHandle}
              notebookFilePath={filePath}
              vscodeDocumentPath={buildNotebookCellDocumentPath(notebookAbsolutePath, cell.id, codeEditorLanguage)}
              codeLanguage={codeEditorLanguage}
              onRunCell={runCellHandler}
              isExecuting={executionState === "running" && currentCellId === cell.id}
              canRunCell={canRunCellValue}
              onCodeCellEditorCommandsChange={handleCodeCellEditorCommandsChange}
            />
          </div>
        ))}
      </div>

      <SaveIndicator
        status={saveStatus}
        savingLabel={t("workbench.notebook.saving")}
        savedLabel={t("workbench.notebook.saved")}
        errorLabel={t("workbench.notebook.saveFailed")}
      />
    </div>
  );
}

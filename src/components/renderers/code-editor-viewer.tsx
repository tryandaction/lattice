"use client";

import { useCallback, useMemo, useRef, useEffect, useState, startTransition } from "react";
import {
  Trash2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import {
  CodeEditor,
  CodeEditorLanguage,
  CodeEditorRef,
} from "@/components/editor/codemirror/code-editor";
import { getCodeEditorLanguage, getFileExtension } from "@/lib/file-utils";
import { useAnnotationNavigation } from "../../hooks/use-annotation-navigation";
import { OutputArea } from "@/components/notebook/output-area";
import { KernelStatus } from "@/components/notebook/kernel-status";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import type { CommandBarAction, CommandBarState, PaneId } from "@/types/layout";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { isSameWorkspacePath } from "@/lib/link-router/path-utils";
import { getRunnerDefinition } from "@/lib/runner/extension-map";
import { dirname, resolveWorkspaceFilePath } from "@/lib/runner/path-utils";
import type { ExecutionDiagnostic, ExecutionOrigin, ExecutionProblem, RunnerExecutionRequest } from "@/lib/runner/types";
import {
  buildRunnerPreferenceCommit,
  getLanguagePreferenceKey,
  resolveRunnerExecutionRequest,
} from "@/lib/runner/preferences";
import { useExecutionRunner } from "@/hooks/use-execution-runner";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
import { ProblemsPanel } from "@/components/runner/problems-panel";
import { diagnosticsToExecutionProblems, mergeExecutionProblems, runnerHealthIssuesToExecutionProblems } from "@/lib/runner/problem-utils";
import { useRunnerHealth } from "@/hooks/use-runner-health";
import { WorkspaceRunnerManager } from "@/components/runner/workspace-runner-manager";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useExecutionDockLayout } from "@/hooks/use-execution-dock-layout";
import { HorizontalScrollStrip } from "@/components/ui/horizontal-scroll-strip";
import { useI18n } from "@/hooks/use-i18n";
import { buildPersistedFileViewStateKey, loadPersistedFileViewState, savePersistedFileViewState } from "@/lib/file-view-state";
import { setExecutionHealthSnapshot } from "@/stores/execution-session-store";
import { extractCodeOutlineSymbols } from "@/lib/code-outline";
import { CodeOutlinePanel } from "@/components/renderers/code-outline-panel";

interface CodeEditorViewerProps {
  content: string;
  fileName: string;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
  isReadOnly?: boolean;
  paneId: PaneId;
  tabId: string;
  filePath: string;
  executionScopeId: string;
  extraCommandActions?: CommandBarAction[];
}

const DEBOUNCE_DELAY = 500;
const HEAVY_EDITOR_FEATURE_CHAR_LIMIT = 150_000;
const DEFAULT_EXTRA_COMMAND_ACTIONS: CommandBarAction[] = [];

function messageFromUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

export function CodeEditorViewer({
  content,
  fileName,
  onContentChange,
  onSave,
  isReadOnly = false,
  paneId,
  tabId,
  filePath,
  executionScopeId,
  extraCommandActions = DEFAULT_EXTRA_COMMAND_ACTIONS,
}: CodeEditorViewerProps) {
  const { t } = useI18n();
  const extension = getFileExtension(fileName);
  const language = useMemo<CodeEditorLanguage>(
    () => getCodeEditorLanguage(extension),
    [extension],
  );
  const runnerDefinition = useMemo(
    () => getRunnerDefinition(extension),
    [extension],
  );
  const rootName = useWorkspaceStore((state) => state.rootHandle?.name ?? state.fileTree.root?.name ?? null);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const setRecentRunConfig = useWorkspaceStore((state) => state.setRecentRunConfig);
  const setRunnerPreferences = useWorkspaceStore((state) => state.setRunnerPreferences);
  const saveCachedEditorState = useContentCacheStore((state) => state.saveEditorState);
  const getCachedEditorState = useContentCacheStore((state) => state.getEditorState);
  const persistedViewStateKey = useMemo(
    () => buildPersistedFileViewStateKey({
      kind: "code",
      workspaceKey,
      workspaceRootPath,
      filePath,
      fallbackName: fileName,
    }),
    [fileName, filePath, workspaceKey, workspaceRootPath],
  );

  const {
    status: runnerStatus,
    outputs,
    panelMeta,
    error: runnerError,
    summary,
    problems,
    run,
    terminate,
    clearOutputs,
    setPanelMeta,
    setExternalProblems,
    isRunning,
    isLoading,
    lastRequest,
    commandState,
  } = useExecutionRunner({
    scope: {
      scopeId: executionScopeId,
      kind: "code",
      paneId,
      tabId,
      filePath,
      fileName,
    },
    capability: {
      supportsSelection: Boolean(runnerDefinition?.supportsInlineCode),
      supportsPersistentSession: false,
      supportsNotebook: false,
      supportsLocalExecution: true,
      supportsPyodide: false,
      canRun: Boolean(runnerDefinition) && !isReadOnly,
      canStop: Boolean(runnerDefinition) && !isReadOnly,
      canInterrupt: false,
      canRestart: false,
    },
  });

  const [syntaxProblems, setSyntaxProblems] = useState<ExecutionProblem[]>([]);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const currentContentRef = useRef(content);
  const editorRef = useRef<CodeEditorRef | null>(null);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    editorContainerRef,
    ({ text, inputOffsets, lineStart, lineEnd }) => createSelectionContext({
      sourceKind: "code",
      paneId,
      fileName,
      filePath,
      selectedText: text,
      documentText: currentContentRef.current,
      selectionRange: inputOffsets
        ? {
            start: inputOffsets.start,
            end: inputOffsets.end,
            lineStart,
            lineEnd,
          }
        : undefined,
    }),
    {
      getSelectionSnapshot: () => {
        const details = editorRef.current?.getSelectionDetails();
        if (!details) {
          return null;
        }
        return {
          text: details.text,
          inputOffsets: {
            start: details.start,
            end: details.end,
          },
          lineStart: details.lineStart,
          lineEnd: details.lineEnd,
        };
      },
    }
  );
  const pendingNavigation = useLinkNavigationStore((state) => state.pendingByPane[paneId]);
  const consumePendingNavigation = useLinkNavigationStore((state) => state.consumePendingNavigation);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasChangedRef = useRef(false);
  const {
    dockSize,
    isDockOpen: showOutput,
    activeDockTab,
    setDockSize,
    setIsDockOpen: setShowOutput,
    setActiveDockTab,
  } = useExecutionDockLayout({
    paneId,
    surfaceId: "code-execution",
    defaultSize: 38,
    defaultOpen: false,
    defaultTab: "run",
  });

  const absoluteFilePath = useMemo(
    () => resolveWorkspaceFilePath(workspaceRootPath, filePath, rootName),
    [workspaceRootPath, filePath, rootName],
  );
  const executionContext = useMemo(() => ({
    kind: "file" as const,
    filePath: absoluteFilePath ?? filePath,
    fileName,
    language,
    label: fileName,
  }), [absoluteFilePath, fileName, filePath, language]);
  const runCwd = useMemo(
    () => (absoluteFilePath ? dirname(absoluteFilePath) : workspaceRootPath ?? undefined),
    [absoluteFilePath, workspaceRootPath],
  );
  const {
    runnerHealthSnapshot,
    refresh: refreshRunnerHealth,
  } = useRunnerHealth({
    cwd: runCwd,
    fileKey: filePath,
    commands: runnerDefinition?.command ? [runnerDefinition.command] : [],
    checkPython: runnerDefinition?.runnerType === "python-local",
    autoRefresh: false,
  });
  const healthContext = useMemo(
    () => ({
      kind: "workspace" as const,
      filePath: absoluteFilePath ?? filePath,
      fileName,
      label: t("workbench.runner.currentFileEnv"),
    }),
    [absoluteFilePath, fileName, filePath, t],
  );

  useAnnotationNavigation({
    handlers: {
      onCodeLineNavigate: (line) => {
        editorRef.current?.scrollToLine(line);
        window.setTimeout(() => {
          editorRef.current?.flashLine(line);
        }, 120);
      },
    },
  });

  useEffect(() => {
    currentContentRef.current = content;
  }, [content]);

  useEffect(() => {
    const editor = editorRef.current;
    let cancelled = false;
    const restore = async () => {
      const cachedState = getCachedEditorState(filePath);
      if (
        cachedState &&
        typeof cachedState.cursorPosition === "number" &&
        typeof cachedState.scrollTop === "number"
      ) {
        requestAnimationFrame(() => {
          editorRef.current?.restoreEditorState(cachedState as {
            cursorPosition: number;
            scrollTop: number;
            scrollLeft?: number;
            selection?: { from: number; to: number };
          });
        });
        return;
      }

      const persistedState = await loadPersistedFileViewState(persistedViewStateKey);
      if (
        cancelled ||
        !persistedState ||
        typeof persistedState.cursorPosition !== "number" ||
        typeof persistedState.scrollTop !== "number"
      ) {
        return;
      }

      requestAnimationFrame(() => {
        editorRef.current?.restoreEditorState(persistedState as {
          cursorPosition: number;
          scrollTop: number;
          scrollLeft?: number;
          selection?: { from: number; to: number };
        });
      });
      saveCachedEditorState(filePath, persistedState as {
        cursorPosition: number;
        scrollTop: number;
        scrollLeft?: number;
        selection?: { from: number; to: number };
      });
    };

    void restore();

    return () => {
      cancelled = true;
      const editorState = editor?.getEditorState();
      if (editorState) {
        saveCachedEditorState(filePath, editorState);
        void savePersistedFileViewState(persistedViewStateKey, editorState);
      }
    };
  }, [filePath, getCachedEditorState, persistedViewStateKey, saveCachedEditorState]);

  useEffect(() => {
    if (!pendingNavigation || !isSameWorkspacePath(pendingNavigation.filePath, filePath)) {
      return;
    }

    if (pendingNavigation.target.type !== "code_line") {
      return;
    }

    const line = pendingNavigation.target.line;
    editorRef.current?.scrollToLine(line);
    window.setTimeout(() => {
      editorRef.current?.flashLine(line);
    }, 120);
    consumePendingNavigation(paneId, filePath);
  }, [consumePendingNavigation, filePath, paneId, pendingNavigation]);

  useEffect(() => {
    if (outputs.some((output) => output.type === "error")) {
      startTransition(() => {
        setShowOutput(true);
        setActiveDockTab("problems");
      });
    }
  }, [outputs, setActiveDockTab, setShowOutput]);

  useEffect(() => {
    if (syntaxProblems.length > 0) {
      startTransition(() => {
        setShowOutput(true);
        setActiveDockTab("problems");
      });
    }
  }, [setActiveDockTab, setShowOutput, syntaxProblems.length]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  const handleChange = useCallback((newContent: string) => {
    currentContentRef.current = newContent;
    onContentChange?.(newContent);
    hasChangedRef.current = true;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (onSave) {
      debounceTimerRef.current = setTimeout(() => {
        if (hasChangedRef.current) {
          onSave().catch((error) => {
            console.error("Failed to save file:", error);
          });
          hasChangedRef.current = false;
        }
      }, DEBOUNCE_DELAY);
    }
  }, [onContentChange, onSave]);

  const flushPendingSave = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (!onSave) {
      hasChangedRef.current = false;
      return;
    }

    await onSave();
    hasChangedRef.current = false;
  }, [onSave]);

  const buildRunRequest = useCallback(async (
    mode: RunnerExecutionRequest["mode"],
    codeOverride?: string,
  ): Promise<{
    request: RunnerExecutionRequest | null;
    origin: ExecutionOrigin | null;
    diagnostics: ExecutionDiagnostic[];
    context: typeof executionContext;
  }> => {
    if (!runnerDefinition) {
      return { request: null, origin: null, diagnostics: [], context: executionContext };
    }

    const code = codeOverride ?? currentContentRef.current;
    const languageKey = getLanguagePreferenceKey(extension);

    if (mode === "file") {
      try {
        await flushPendingSave();
      } catch (error) {
        const message = messageFromUnknownError(error);
        return {
          request: null,
          origin: null,
          diagnostics: [
            {
              severity: "error",
              title: "保存失败，已阻止运行",
              message,
              hint: "请先解决保存问题，再重新运行当前文件。",
              stage: "request-build",
            },
          ],
          context: executionContext,
        };
      }
    }

    const resolved = await resolveRunnerExecutionRequest({
      runnerDefinition,
      mode,
      code,
      cwd: runCwd,
      absoluteFilePath: absoluteFilePath ?? undefined,
      fileKey: filePath,
      language: languageKey,
      preferences: runnerPreferences,
    });

    return {
      request: resolved.request,
      origin: resolved.meta.origin,
      diagnostics: resolved.meta.diagnostics,
      context: executionContext,
    };
  }, [absoluteFilePath, executionContext, extension, filePath, flushPendingSave, runCwd, runnerDefinition, runnerPreferences]);

  const handleRun = useCallback(async () => {
    if (!runnerDefinition || !commandState.canRun) {
      return;
    }
    await refreshRunnerHealth();
    const { request, origin, diagnostics, context } = await buildRunRequest("file");
    clearOutputs();
    setPanelMeta({ origin, diagnostics, context });
    setShowOutput(true);
    setActiveDockTab(diagnostics.length > 0 ? "problems" : "run");
    if (!request) {
      return;
    }

    const result = await run(request);
    if (result.success && runnerDefinition) {
      const commit = buildRunnerPreferenceCommit({
        fileKey: filePath,
        language: extension,
        request,
        preferences: runnerPreferences,
      });
      setRecentRunConfig(commit.fileKey, commit.recentRunConfig);
      setRunnerPreferences(commit.preferences);
    }
  }, [buildRunRequest, clearOutputs, commandState.canRun, extension, filePath, refreshRunnerHealth, run, runnerDefinition, runnerPreferences, setActiveDockTab, setPanelMeta, setRecentRunConfig, setRunnerPreferences, setShowOutput]);

  const handleRunSelection = useCallback(async () => {
    if (!runnerDefinition || !commandState.canRun) {
      return;
    }
    const selection = editorRef.current?.getSelection();
    if (!selection?.trim()) return;

    await refreshRunnerHealth();
    const { request, origin, diagnostics, context } = await buildRunRequest("selection", selection);
    clearOutputs();
    setPanelMeta({ origin, diagnostics, context });
    setShowOutput(true);
    setActiveDockTab(diagnostics.length > 0 ? "problems" : "run");
    if (!request) {
      closeSelectionMenu();
      return;
    }

    closeSelectionMenu();
    await run(request);
  }, [buildRunRequest, clearOutputs, closeSelectionMenu, commandState.canRun, refreshRunnerHealth, run, runnerDefinition, setActiveDockTab, setPanelMeta, setShowOutput]);

  const handleRerun = useCallback(async () => {
    if (!lastRequest || !commandState.canRerun) {
      return;
    }

    if (lastRequest.mode === "file") {
      try {
        await flushPendingSave();
      } catch (error) {
        const message = messageFromUnknownError(error);
        clearOutputs();
        setPanelMeta({
          origin: null,
          diagnostics: [
            {
              severity: "error",
              title: "保存失败，已阻止重新运行",
              message,
              hint: "请先解决保存问题，再重新运行当前文件。",
              stage: "request-build",
            },
          ],
          context: executionContext,
        });
        setShowOutput(true);
        setActiveDockTab("problems");
        return;
      }
    }

    clearOutputs();
    setShowOutput(true);
    setActiveDockTab("run");
    await run(lastRequest);
  }, [clearOutputs, commandState.canRerun, executionContext, flushPendingSave, lastRequest, run, setActiveDockTab, setPanelMeta, setShowOutput]);

  const healthProblems = useMemo(
    () => runnerHealthIssuesToExecutionProblems(runnerHealthSnapshot.issues, healthContext),
    [healthContext, runnerHealthSnapshot.issues],
  );

  const externalProblems = useMemo(
    () => mergeExecutionProblems(
      syntaxProblems,
      diagnosticsToExecutionProblems(panelMeta.diagnostics, "preflight", panelMeta.context ?? executionContext),
    ),
    [executionContext, panelMeta.context, panelMeta.diagnostics, syntaxProblems],
  );

  useEffect(() => {
    setExternalProblems(externalProblems);
  }, [externalProblems, setExternalProblems]);

  useEffect(() => {
    setExecutionHealthSnapshot(executionScopeId, runnerHealthSnapshot, healthProblems);
  }, [executionScopeId, healthProblems, runnerHealthSnapshot]);

  const navigateToProblem = useCallback((problem: ExecutionProblem) => {
    const line = problem.context?.line;
    if (!line) {
      return;
    }

    editorRef.current?.scrollToLine(line);
    window.setTimeout(() => {
      editorRef.current?.flashLine(line);
    }, 120);
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (runnerDefinition && event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      if (commandState.canRun) {
        void handleRun();
      }
    }
  }, [commandState.canRun, handleRun, runnerDefinition]);

  const canRun = Boolean(runnerDefinition) && !isReadOnly;
  const enableHeavyEditorFeatures = canRun && content.length <= HEAVY_EDITOR_FEATURE_CHAR_LIMIT;
  const durationLabel = formatDuration(summary.durationMs);
  const shouldRenderDock = showOutput || outputs.length > 0 || problems.length > 0 || isRunning || isLoading;
  const runnerCommand = runnerDefinition?.command;
  const outlineSymbols = useMemo(
    () => (outlineOpen ? extractCodeOutlineSymbols(content, language) : []),
    [content, language, outlineOpen],
  );

  const navigateToOutlineSymbol = useCallback((line: number) => {
    editorRef.current?.scrollToLine(line);
    window.setTimeout(() => {
      editorRef.current?.flashLine(line);
    }, 120);
  }, []);

  const commandBarState = useMemo<CommandBarState>(() => {
    const breadcrumbs = filePath.split("/").filter(Boolean).map((segment) => ({ label: segment }));
    return {
      breadcrumbs,
      actions: [
        {
          id: "save",
          label: t("common.save"),
          icon: "save",
          priority: 10,
          group: "primary",
          disabled: !onSave || isReadOnly,
          onTrigger: () => { void onSave?.(); },
        },
        {
          id: "search",
          label: t("workbench.commandBar.searchInFile"),
          icon: "search",
          tooltip: t("workbench.commandBar.searchInFile"),
          priority: 15,
          group: "secondary",
          onTrigger: () => editorRef.current?.openSearch(),
        },
        {
          id: "goto-line",
          label: t("workbench.commandBar.gotoLine"),
          icon: "scan-search",
          tooltip: t("workbench.commandBar.gotoLine"),
          priority: 16,
          group: "secondary",
          onTrigger: () => editorRef.current?.openGotoLine(),
        },
        {
          id: "outline",
          label: outlineOpen ? t("workbench.commandBar.hideOutline") : t("workbench.commandBar.showOutline"),
          icon: "list-tree",
          tooltip: outlineOpen ? t("workbench.commandBar.hideOutline") : t("workbench.commandBar.showOutline"),
          priority: 17,
          group: "secondary",
          active: outlineOpen,
          onTrigger: () => setOutlineOpen((value) => !value),
        },
        ...extraCommandActions,
        {
          id: isRunning ? "stop" : "run",
          label: isRunning ? t("workbench.commandBar.stop") : t("workbench.commandBar.run"),
          icon: isRunning ? "square" : "play",
          priority: 20,
          group: "primary",
          disabled: !canRun || (isRunning ? !commandState.canStop : !commandState.canRun),
          onTrigger: isRunning ? () => { void terminate(); } : () => { void handleRun(); },
        },
        {
          id: "rerun",
          label: t("workbench.commandBar.rerun"),
          icon: "rotate-cw",
          priority: 21,
          group: "secondary",
          disabled: !commandState.canRerun,
          onTrigger: () => { void handleRerun(); },
        },
        {
          id: "show-run-output",
          label: t("workbench.commandBar.showRun"),
          icon: "file-output",
          priority: 30,
          group: "secondary",
          active: showOutput && activeDockTab === "run",
          onTrigger: () => {
            setActiveDockTab("run");
            setShowOutput(true);
          },
        },
        {
          id: "show-problems",
          label: t("workbench.commandBar.showProblems"),
          icon: "check-circle",
          priority: 31,
          group: "secondary",
          active: showOutput && activeDockTab === "problems",
          onTrigger: () => {
            setActiveDockTab("problems");
            setShowOutput(true);
          },
        },
        {
          id: "verify",
          label: t("workbench.commandBar.verify"),
          icon: "check-circle",
          priority: 40,
          group: "utility",
          disabled: !canRun,
          onTrigger: () => {
            void refreshRunnerHealth();
            setActiveDockTab("problems");
            setShowOutput(true);
          },
        },
      ],
    };
  }, [
    activeDockTab,
    canRun,
    filePath,
    handleRerun,
    handleRun,
    extraCommandActions,
    isReadOnly,
    isRunning,
    onSave,
    outlineOpen,
    refreshRunnerHealth,
    setActiveDockTab,
    setShowOutput,
    showOutput,
    t,
    terminate,
    commandState.canRun,
    commandState.canRerun,
    commandState.canStop,
  ]);

  usePaneCommandBar({
    paneId,
    scopeId: executionScopeId,
    state: commandBarState,
  });

  const renderEditorSurface = useCallback(() => (
    <div className="flex h-full min-h-0 overflow-hidden">
      <CodeOutlinePanel
        symbols={outlineSymbols}
        isOpen={outlineOpen}
        onClose={() => setOutlineOpen(false)}
        onNavigate={navigateToOutlineSymbol}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <CodeEditor
          initialValue={content}
          language={language}
          onChange={handleChange}
          isReadOnly={isReadOnly || !onContentChange}
          autoHeight={false}
          fileId={fileName}
          className="h-full"
          editorRef={editorRef}
          basicCompletion={enableHeavyEditorFeatures}
          syntaxDiagnostics={enableHeavyEditorFeatures}
          problemContext={executionContext}
          onProblemsChange={setSyntaxProblems}
        />
      </div>
    </div>
  ), [
    content,
    enableHeavyEditorFeatures,
    executionContext,
    fileName,
    handleChange,
    isReadOnly,
    language,
    navigateToOutlineSymbol,
    onContentChange,
    outlineOpen,
    outlineSymbols,
  ]);

  const renderDock = useCallback((expanded: boolean) => (
    <div className={expanded ? "code-workbench-elevated flex h-full min-h-0 flex-col border-t" : "code-workbench-elevated border-t"}>
      <HorizontalScrollStrip
        className="border-b border-border bg-[var(--code-surface-muted)]"
        viewportClassName="px-3 py-1.5"
        contentClassName="min-w-full w-max justify-between gap-3"
        ariaLabel={t("workbench.runner.managerCode")}
      >
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={() => setShowOutput((value) => !value)}
            className="code-workbench-inline-button flex items-center gap-1 text-xs transition-colors"
          >
            {showOutput ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
            <span>{showOutput ? t("workbench.dock.hide") : t("workbench.dock.show")}</span>
          </button>
          <div className="code-workbench-panel flex items-center gap-1 rounded-md p-0.5">
            <button
              type="button"
              onClick={() => {
                setActiveDockTab("run");
                setShowOutput(true);
              }}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${activeDockTab === "run" ? "code-workbench-status-info" : "code-workbench-inline-button"}`}
            >
              {t("workbench.dock.run")}
              {outputs.length > 0 ? (
                <span className="code-workbench-status-info ml-1 rounded px-1 py-0.5 text-[10px]">{outputs.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveDockTab("problems");
                setShowOutput(true);
              }}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${activeDockTab === "problems" ? "code-workbench-status-error" : "code-workbench-inline-button"}`}
            >
              {t("workbench.dock.problems")}
              {problems.length > 0 ? (
                <span className="code-workbench-status-error ml-1 rounded px-1 py-0.5 text-[10px]">{problems.length}</span>
              ) : null}
            </button>
          </div>
        </div>

        <div className="code-workbench-soft-text flex shrink-0 items-center gap-2 text-[10px]">
          {summary.startedAt && <span>{t("workbench.runner.started")}</span>}
          {durationLabel && <span>{durationLabel}</span>}
          {summary.exitCode !== null && <span>{t("workbench.runner.exit", { code: summary.exitCode })}</span>}
          {runnerHealthSnapshot.issues.length > 0 && (
            <span className="code-workbench-status-warning inline-flex items-center gap-1 rounded px-2 py-1">
              <AlertTriangle className="h-3 w-3" />
              <span>{t("workbench.runner.health", { count: runnerHealthSnapshot.issues.length })}</span>
            </span>
          )}
          <WorkspaceRunnerManager
            cwd={runCwd}
            fileKey={filePath}
            commands={runnerCommand ? [runnerCommand] : []}
            title={t("workbench.runner.managerCode")}
            triggerLabel={t("workbench.runner.trigger")}
          />
          {expanded && (outputs.length > 0 || problems.length > 0) && (
            <button
              onClick={clearOutputs}
              className="code-workbench-inline-button rounded p-1 transition-colors"
              title={t("workbench.dock.clearFeedback")}
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </HorizontalScrollStrip>

      {expanded ? (
          <div className="h-full min-h-0 overflow-auto p-3">
            <KernelStatus status={runnerStatus} error={runnerError} />
            {activeDockTab === "run" ? (
            <>
              <OutputArea
                outputs={outputs}
                meta={panelMeta}
                context={panelMeta.context ?? executionContext}
                showDiagnosticsInline={false}
                onSelectProblem={navigateToProblem}
              />
              {outputs.length === 0 && !runnerError && runnerStatus !== "loading" && runnerStatus !== "running" && (
                <p className="code-workbench-muted-text py-4 text-center text-xs">
                  {t("workbench.runner.noOutput")}
                </p>
              )}
            </>
          ) : (
            <>
              <ProblemsPanel problems={problems} onSelectProblem={navigateToProblem} />
              {problems.length === 0 ? (
                <p className="code-workbench-muted-text py-4 text-center text-xs">
                  {t("workbench.runner.noProblems")}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  ), [
    activeDockTab,
    clearOutputs,
    durationLabel,
    filePath,
    navigateToProblem,
    outputs,
    panelMeta,
    problems,
    runCwd,
    runnerCommand,
    runnerError,
    runnerHealthSnapshot.issues.length,
    runnerStatus,
    setActiveDockTab,
    setShowOutput,
    showOutput,
    summary.exitCode,
    summary.startedAt,
    t,
  ]);

  return (
    <div
      ref={editorContainerRef}
      className="code-workbench-shell h-full flex flex-col overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      <SelectionContextMenu
        state={selectionMenuState}
        onClose={closeSelectionMenu}
        onOpenHub={(context, mode, returnFocusTo) => setSelectionHubState({ context, mode, returnFocusTo })}
        extraActions={runnerDefinition?.supportsInlineCode ? [{
          id: "run-selection",
          label: t("workbench.runner.runSelection"),
          onSelect: () => {
            void handleRunSelection();
          },
        }] : []}
      />

      <SelectionAiHub
        context={selectionHubState?.context ?? null}
        initialMode={selectionHubState?.mode ?? "chat"}
        returnFocusTo={selectionHubState?.returnFocusTo}
        onClose={() => setSelectionHubState(null)}
      />

      {canRun && shouldRenderDock && showOutput ? (
        <ResizablePanelGroup
          direction="vertical"
          className="flex-1 min-h-0"
          sizes={[100 - dockSize, dockSize]}
          onSizesChange={(sizes) => {
            if (sizes[1]) {
              setDockSize(sizes[1]);
            }
          }}
        >
          <ResizablePanel index={0} defaultSize={100 - dockSize} minSize={30} className="min-h-0 overflow-hidden">
            {renderEditorSurface()}
          </ResizablePanel>
          <ResizableHandle withHandle index={0} />
          <ResizablePanel index={1} defaultSize={dockSize} minSize={18} className="min-h-0 overflow-hidden">
            {renderDock(true)}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-hidden">
            {renderEditorSurface()}
          </div>
          {canRun && shouldRenderDock ? renderDock(false) : null}
        </>
      )}
    </div>
  );
}

export default CodeEditorViewer;

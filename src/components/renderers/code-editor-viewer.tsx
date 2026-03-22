"use client";

import { useCallback, useMemo, useRef, useEffect, useState, startTransition } from "react";
import {
  Play,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronUp,
  Square,
  RotateCcw,
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
import { useTextSelection } from "@/hooks/use-text-selection";
import { AiInlineMenu } from "@/components/ai/ai-inline-menu";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import type { PaneId } from "@/types/layout";
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
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { ProblemsPanel } from "@/components/runner/problems-panel";
import { diagnosticsToExecutionProblems, mergeExecutionProblems, outputsToExecutionProblems, runnerHealthIssuesToExecutionProblems } from "@/lib/runner/problem-utils";
import { useRunnerHealth } from "@/hooks/use-runner-health";
import { WorkspaceRunnerManager } from "@/components/runner/workspace-runner-manager";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useExecutionDockLayout } from "@/hooks/use-execution-dock-layout";

interface CodeEditorViewerProps {
  content: string;
  fileName: string;
  onContentChange?: (content: string) => void;
  onSave?: () => Promise<void>;
  isReadOnly?: boolean;
  paneId: PaneId;
  filePath: string;
}

const DEBOUNCE_DELAY = 500;

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
  filePath,
}: CodeEditorViewerProps) {
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
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const setRecentRunConfig = useWorkspaceStore((state) => state.setRecentRunConfig);
  const setRunnerPreferences = useWorkspaceStore((state) => state.setRunnerPreferences);

  const {
    status: runnerStatus,
    outputs,
    panelMeta,
    error: runnerError,
    summary,
    run,
    terminate,
    clearOutputs,
    setPanelMeta,
    isRunning,
    isLoading,
    lastRequest,
  } = useExecutionRunner();

  const [syntaxProblems, setSyntaxProblems] = useState<ExecutionProblem[]>([]);
  const currentContentRef = useRef(content);
  const editorRef = useRef<CodeEditorRef | null>(null);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const { selection: aiSelection, dismiss: dismissAiMenu } = useTextSelection(editorContainerRef);
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
    autoRefresh: Boolean(runnerDefinition),
  });
  const healthContext = useMemo(
    () => ({
      kind: "workspace" as const,
      filePath: absoluteFilePath ?? filePath,
      fileName,
      label: "当前文件运行环境",
    }),
    [absoluteFilePath, fileName, filePath],
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

    if (mode === "file" && absoluteFilePath) {
      await onSave?.();
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
  }, [absoluteFilePath, executionContext, extension, filePath, onSave, runCwd, runnerDefinition, runnerPreferences]);

  const handleRun = useCallback(async () => {
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
  }, [buildRunRequest, clearOutputs, extension, filePath, refreshRunnerHealth, run, runnerDefinition, runnerPreferences, setActiveDockTab, setPanelMeta, setRecentRunConfig, setRunnerPreferences, setShowOutput]);

  const handleRunSelection = useCallback(async () => {
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
  }, [buildRunRequest, clearOutputs, closeSelectionMenu, refreshRunnerHealth, run, setActiveDockTab, setPanelMeta, setShowOutput]);

  const handleRerun = useCallback(async () => {
    if (!lastRequest) {
      return;
    }
    clearOutputs();
    setShowOutput(true);
    setActiveDockTab("run");
    await run(lastRequest);
  }, [clearOutputs, lastRequest, run, setActiveDockTab, setShowOutput]);

  const problems = useMemo(
    () =>
      mergeExecutionProblems(
        syntaxProblems,
        diagnosticsToExecutionProblems(panelMeta.diagnostics, "preflight", panelMeta.context ?? executionContext),
        outputsToExecutionProblems(outputs, panelMeta.context ?? executionContext),
        runnerHealthIssuesToExecutionProblems(runnerHealthSnapshot.issues, healthContext),
      ),
    [executionContext, healthContext, outputs, panelMeta.context, panelMeta.diagnostics, runnerHealthSnapshot.issues, syntaxProblems],
  );

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

  const handleAiInsert = useCallback((text: string) => {
    const current = currentContentRef.current;
    handleChange(`${current}\n\n${text}`);
  }, [handleChange]);

  const handleAiReplace = useCallback((text: string) => {
    const selection = window.getSelection();
    const selectedText = selection?.toString() ?? "";
    const current = currentContentRef.current;
    if (selectedText && current.includes(selectedText)) {
      handleChange(current.replace(selectedText, text));
    }
  }, [handleChange]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (runnerDefinition && event.shiftKey && event.key === "Enter") {
      event.preventDefault();
      void handleRun();
    }
  }, [handleRun, runnerDefinition]);

  const canRun = Boolean(runnerDefinition) && !isReadOnly;
  const durationLabel = formatDuration(summary.durationMs);
  const shouldRenderDock = showOutput || outputs.length > 0 || problems.length > 0 || isRunning || isLoading;
  const runnerCommand = runnerDefinition?.command;

  const renderDock = useCallback((expanded: boolean) => (
    <div className={expanded ? "flex h-full min-h-0 flex-col border-t border-border bg-background" : "border-t border-border bg-background"}>
      <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowOutput((value) => !value)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showOutput ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronUp className="h-3 w-3" />
            )}
            <span>{showOutput ? "Hide Dock" : "Show Dock"}</span>
          </button>
          <div className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => {
                setActiveDockTab("run");
                setShowOutput(true);
              }}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${activeDockTab === "run" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
            >
              Run
              {outputs.length > 0 ? (
                <span className="ml-1 rounded bg-primary/10 px-1 py-0.5 text-[10px]">{outputs.length}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveDockTab("problems");
                setShowOutput(true);
              }}
              className={`rounded px-2 py-1 text-[11px] transition-colors ${activeDockTab === "problems" ? "bg-destructive/10 text-destructive" : "text-muted-foreground hover:text-foreground"}`}
            >
              Problems
              {problems.length > 0 ? (
                <span className="ml-1 rounded bg-destructive/10 px-1 py-0.5 text-[10px]">{problems.length}</span>
              ) : null}
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {summary.startedAt && <span>Started</span>}
          {durationLabel && <span>{durationLabel}</span>}
          {summary.exitCode !== null && <span>Exit {summary.exitCode}</span>}
          {runnerHealthSnapshot.issues.length > 0 && (
            <span className="inline-flex items-center gap-1 text-yellow-700 dark:text-yellow-300">
              <AlertTriangle className="h-3 w-3" />
              <span>{runnerHealthSnapshot.issues.length} health</span>
            </span>
          )}
          <WorkspaceRunnerManager
            cwd={runCwd}
            fileKey={filePath}
            commands={runnerCommand ? [runnerCommand] : []}
            title="Code File Runner Manager"
            triggerLabel="Runner"
          />
          {expanded && (outputs.length > 0 || problems.length > 0) && (
            <button
              onClick={clearOutputs}
              className="p-1 text-muted-foreground transition-colors hover:text-foreground"
              title="Clear execution feedback"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {expanded ? (
        <div className="h-full min-h-0 overflow-auto p-3">
          <KernelStatus status={runnerStatus} error={runnerError} />
          {activeDockTab === "run" ? (
            <>
              <OutputArea outputs={outputs} meta={panelMeta} showDiagnosticsInline={false} />
              {outputs.length === 0 && !runnerError && runnerStatus !== "loading" && runnerStatus !== "running" && (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No output yet. Click Run or press Shift+Enter to execute.
                </p>
              )}
            </>
          ) : (
            <>
              <ProblemsPanel problems={problems} onSelectProblem={navigateToProblem} />
              {problems.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No problems detected.
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
  ]);

  return (
    <div
      ref={editorContainerRef}
      className="h-full flex flex-col overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      {aiSelection && (
        <AiInlineMenu
          selectedText={aiSelection.text}
          position={aiSelection.position}
          onInsert={handleAiInsert}
          onReplace={handleAiReplace}
          onClose={dismissAiMenu}
        />
      )}

      <SelectionContextMenu
        state={selectionMenuState}
        onClose={closeSelectionMenu}
        onOpenHub={(context, mode, returnFocusTo) => setSelectionHubState({ context, mode, returnFocusTo })}
        extraActions={runnerDefinition?.supportsInlineCode ? [{
          id: "run-selection",
          label: "Run Selection",
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

      <div className="sticky top-0 z-10 border-b border-border bg-muted/90 px-4 py-2 backdrop-blur flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-foreground">{fileName}</span>
          <span className="ml-2 text-xs text-muted-foreground">({language})</span>
          {runnerDefinition && (
            <span className="ml-2 text-xs text-muted-foreground">
              Runner: {runnerDefinition.displayName}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {canRun && (
            <>
              {isRunning ? (
                <button
                  onClick={() => void terminate()}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md bg-destructive/10 hover:bg-destructive/20 text-destructive transition-colors"
                  title="Stop current run"
                >
                  <Square className="w-3 h-3" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  onClick={() => void handleRun()}
                  disabled={isLoading}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md bg-primary/10 hover:bg-primary/20 text-primary disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="Run file (Shift+Enter)"
                >
                  {isLoading ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Play className="w-3 h-3" />
                  )}
                  <span>Run</span>
                </button>
              )}

              <button
                onClick={() => void handleRerun()}
                disabled={!lastRequest || isRunning || isLoading}
                className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Rerun last task"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Rerun</span>
              </button>
            </>
          )}

          {isReadOnly && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              Read-only
            </span>
          )}
        </div>
      </div>

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
            <CodeEditor
              initialValue={content}
              language={language}
              onChange={handleChange}
              isReadOnly={isReadOnly || !onContentChange}
              autoHeight={false}
              fileId={fileName}
              className="h-full"
              editorRef={editorRef}
              basicCompletion={canRun}
              syntaxDiagnostics={canRun}
              problemContext={executionContext}
              onProblemsChange={setSyntaxProblems}
            />
          </ResizablePanel>
          <ResizableHandle withHandle index={0} />
          <ResizablePanel index={1} defaultSize={dockSize} minSize={18} className="min-h-0 overflow-hidden">
            {renderDock(true)}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <>
          <div className="flex-1 min-h-0 overflow-hidden">
            <CodeEditor
              initialValue={content}
              language={language}
              onChange={handleChange}
              isReadOnly={isReadOnly || !onContentChange}
              autoHeight={false}
              fileId={fileName}
              className="h-full"
              editorRef={editorRef}
              basicCompletion={canRun}
              syntaxDiagnostics={canRun}
              problemContext={executionContext}
              onProblemsChange={setSyntaxProblems}
            />
          </div>
          {canRun && shouldRenderDock ? renderDock(false) : null}
        </>
      )}
    </div>
  );
}

export default CodeEditorViewer;

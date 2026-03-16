"use client";

import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import {
  Play,
  Loader2,
  Trash2,
  ChevronDown,
  ChevronUp,
  PlayCircle,
  Square,
  RotateCcw,
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
import type { PaneId } from "@/types/layout";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { isSameWorkspacePath } from "@/lib/link-router/path-utils";
import { getRunnerDefinition } from "@/lib/runner/extension-map";
import { dirname, resolveWorkspaceFilePath } from "@/lib/runner/path-utils";
import type { RunnerExecutionRequest } from "@/lib/runner/types";
import { useExecutionRunner } from "@/hooks/use-execution-runner";
import { useWorkspaceStore } from "@/stores/workspace-store";

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
  const setRecentRunConfig = useWorkspaceStore((state) => state.setRecentRunConfig);

  const {
    status: runnerStatus,
    outputs,
    error: runnerError,
    summary,
    run,
    terminate,
    clearOutputs,
    isRunning,
    isLoading,
    lastRequest,
  } = useExecutionRunner();

  const [showOutput, setShowOutput] = useState(false);
  const currentContentRef = useRef(content);
  const editorRef = useRef<CodeEditorRef | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const { selection: aiSelection, dismiss: dismissAiMenu } = useTextSelection(editorContainerRef);
  const pendingNavigation = useLinkNavigationStore((state) => state.pendingByPane[paneId]);
  const consumePendingNavigation = useLinkNavigationStore((state) => state.consumePendingNavigation);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasChangedRef = useRef(false);

  const absoluteFilePath = useMemo(
    () => resolveWorkspaceFilePath(workspaceRootPath, filePath, rootName),
    [workspaceRootPath, filePath, rootName],
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
  ): Promise<RunnerExecutionRequest | null> => {
    if (!runnerDefinition) {
      return null;
    }

    const cwd = absoluteFilePath ? dirname(absoluteFilePath) : workspaceRootPath ?? undefined;
    const code = codeOverride ?? currentContentRef.current;

    if (mode === "file" && absoluteFilePath) {
      await onSave?.();

      return {
        runnerType: runnerDefinition.runnerType,
        command: runnerDefinition.command,
        filePath: absoluteFilePath,
        cwd,
        args: runnerDefinition.buildArgs({
          filePath: absoluteFilePath,
          mode,
        }),
        mode,
        allowPyodideFallback: true,
      };
    }

    if (!runnerDefinition.supportsInlineCode || !code.trim()) {
      return null;
    }

    return {
      runnerType: runnerDefinition.runnerType,
      command: runnerDefinition.command,
      cwd,
      code,
      args: runnerDefinition.buildArgs({
        code,
        mode,
      }),
      mode,
      allowPyodideFallback: true,
    };
  }, [absoluteFilePath, onSave, runnerDefinition, workspaceRootPath]);

  const handleRun = useCallback(async () => {
    const request = await buildRunRequest("file");
    if (!request) return;

    clearOutputs();
    setShowOutput(true);
    const result = await run(request);
    if (result.success && runnerDefinition) {
      setRecentRunConfig(filePath, {
        runnerType: request.runnerType,
        command: request.command,
        args: request.args,
      });
    }
  }, [buildRunRequest, clearOutputs, filePath, run, runnerDefinition, setRecentRunConfig]);

  const handleRunSelection = useCallback(async () => {
    const selection = editorRef.current?.getSelection();
    if (!selection?.trim()) return;

    const request = await buildRunRequest("selection", selection);
    if (!request) return;

    clearOutputs();
    setShowOutput(true);
    setContextMenu(null);
    await run(request);
  }, [buildRunRequest, clearOutputs, run]);

  const handleRerun = useCallback(async () => {
    if (!lastRequest) {
      return;
    }
    clearOutputs();
    setShowOutput(true);
    await run(lastRequest);
  }, [clearOutputs, lastRequest, run]);

  const handleContextMenu = useCallback((event: React.MouseEvent) => {
    if (!runnerDefinition?.supportsInlineCode) return;
    if (editorRef.current?.hasSelection()) {
      event.preventDefault();
      setContextMenu({ x: event.clientX, y: event.clientY });
    }
  }, [runnerDefinition]);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClick = () => setContextMenu(null);
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [contextMenu]);

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

      {contextMenu && runnerDefinition?.supportsInlineCode && (
        <div
          className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => void handleRunSelection()}
            disabled={isRunning || isLoading}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlayCircle className="w-4 h-4" />
            <span>Run Selection</span>
          </button>
        </div>
      )}

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

      <div
        className={`flex-1 overflow-hidden ${showOutput && canRun ? "h-1/2" : ""}`}
        onContextMenu={handleContextMenu}
      >
        <CodeEditor
          initialValue={content}
          language={language}
          onChange={handleChange}
          isReadOnly={isReadOnly || !onContentChange}
          autoHeight={false}
          fileId={fileName}
          className="h-full"
          editorRef={editorRef}
        />
      </div>

      {canRun && (
        <div className={`border-t border-border bg-background ${showOutput ? "h-1/2" : ""}`}>
          <div className="flex items-center justify-between px-3 py-1.5 bg-muted/50 border-b border-border">
            <button
              onClick={() => setShowOutput(!showOutput)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {showOutput ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronUp className="w-3 h-3" />
              )}
              <span>Run Panel</span>
              {outputs.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">
                  {outputs.length}
                </span>
              )}
            </button>

            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              {summary.startedAt && <span>Started</span>}
              {durationLabel && <span>{durationLabel}</span>}
              {summary.exitCode !== null && <span>Exit {summary.exitCode}</span>}
              {showOutput && outputs.length > 0 && (
                <button
                  onClick={clearOutputs}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Clear output"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {showOutput && (
            <div className="h-[calc(100%-32px)] overflow-auto p-3">
              <KernelStatus status={runnerStatus} error={runnerError} />
              <OutputArea outputs={outputs} />
              {outputs.length === 0 && !runnerError && runnerStatus !== "loading" && runnerStatus !== "running" && (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No output yet. Click Run or press Shift+Enter to execute.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CodeEditorViewer;

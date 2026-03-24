"use client";

/**
 * Obsidian Markdown Viewer
 * Complete Obsidian-like markdown editing experience with Live Preview
 * 
 * Features:
 * - Live Preview mode (default) - renders markdown with cursor-based syntax reveal
 * - Source mode - raw markdown with syntax highlighting
 * - Reading mode - fully rendered, non-editable
 * - Outline panel for navigation
 * - Keyboard shortcuts (Ctrl+E to cycle modes, Ctrl+S to save)
 */

import { useState, useCallback, useEffect, useRef, useMemo, startTransition } from "react";
import {
  Eye,
  Save,
  Loader2,
  Check,
  AlertCircle,
  Code2,
  PanelLeftClose,
  PanelLeft,
  Sparkles,
  Download,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useTextSelection } from "@/hooks/use-text-selection";
import { AiInlineMenu } from "@/components/ai/ai-inline-menu";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import type {
  ViewMode,
  OutlineItem,
  LivePreviewCodeBlockRunRequest,
} from "./codemirror/live-preview/types";
import type { LivePreviewEditorRef } from "./codemirror/live-preview/live-preview-editor";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { clearDecorationCache } from "./codemirror/live-preview/decoration-coordinator";
import { emitFileSave } from "@/lib/plugins/runtime";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { parseHeadings, buildOutlineTree } from "./codemirror/live-preview/markdown-parser";
import type { PaneId } from "@/types/layout";
import { MarkdownExportDialog } from "./markdown-export-dialog";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { useExecutionRunner } from "@/hooks/use-execution-runner";
import { OutputArea } from "@/components/notebook/output-area";
import { ProblemsPanel } from "@/components/runner/problems-panel";
import { KernelStatus } from "@/components/notebook/kernel-status";
import { buildRunnerPreferenceCommit, getRunnerDefinitionForLanguage, resolveRunnerExecutionRequest } from "@/lib/runner/preferences";
import { diagnosticsToExecutionProblems, mergeExecutionProblems, outputsToExecutionProblems, runnerHealthIssuesToExecutionProblems } from "@/lib/runner/problem-utils";
import { dirname, resolveWorkspaceFilePath } from "@/lib/runner/path-utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useRunnerHealth } from "@/hooks/use-runner-health";
import { WorkspaceRunnerManager } from "@/components/runner/workspace-runner-manager";
import type { ExecutionProblem } from "@/lib/runner/types";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { useExecutionDockLayout } from "@/hooks/use-execution-dock-layout";
import { HorizontalScrollStrip } from "@/components/ui/horizontal-scroll-strip";
import { stripLeadingFrontmatter } from "@/lib/markdown-reading";

// Lazy load components
const LivePreviewEditor = dynamic(
  () => import("./codemirror/live-preview/live-preview-editor").then((mod) => mod.LivePreviewEditor),
  { ssr: false }
);

const OutlinePanel = dynamic(
  () => import("./codemirror/live-preview/outline-panel").then((mod) => mod.OutlinePanel),
  { ssr: false }
);

const MarkdownRenderer = dynamic(
  () => import("@/components/renderers/markdown-renderer").then((mod) => mod.MarkdownRenderer),
  { ssr: false }
);

type SaveStatus = "idle" | "saving" | "saved" | "error";

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
}

function normalizeHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
}

function findHeadingLine(items: OutlineItem[], target: string): number | undefined {
  const normalizedTarget = normalizeHeading(target);
  const stack = [...items];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current) continue;
    if (normalizeHeading(current.text) === normalizedTarget) {
      return current.line;
    }
    if (current.children?.length) {
      stack.push(...current.children);
    }
  }
  return undefined;
}

interface ObsidianMarkdownViewerProps {
  content: string;
  onChange: (content: string) => void;
  fileName: string;
  onSave?: () => Promise<void>;
  /** Callback for wiki link navigation */
  onNavigateToFile?: (filename: string) => void;
  /** Current pane identifier for in-app navigation */
  paneId: PaneId;
  /** Initial view mode */
  initialMode?: ViewMode;
  /** Unique file identifier for proper re-mounting */
  fileId?: string;
  /** Workspace root handle for resolving local image paths */
  rootHandle?: FileSystemDirectoryHandle | null;
  /** File path relative to workspace root (for resolving relative image paths) */
  filePath?: string;
  /** Render behavior variant for system-managed markdown */
  variant?: "document" | "system-index";
}

/**
 * Save indicator component
 */
function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs transition-all",
        status === "saving" && "text-muted-foreground",
        status === "saved" && "text-green-600 dark:text-green-400",
        status === "error" && "text-destructive"
      )}
    >
      {status === "saving" && (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>Saving...</span>
        </>
      )}
      {status === "saved" && (
        <>
          <Check className="h-3 w-3" />
          <span>Saved</span>
        </>
      )}
      {status === "error" && (
        <>
          <AlertCircle className="h-3 w-3" />
          <span>Failed</span>
        </>
      )}
    </div>
  );
}

/**
 * Mode button component
 */
function ModeButton({
  mode,
  currentMode,
  onClick,
  icon: Icon,
  label,
  shortcut,
}: {
  mode: ViewMode;
  currentMode: ViewMode;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  shortcut?: string;
}) {
  const isActive = mode === currentMode;
  
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
        isActive 
          ? "bg-background text-foreground shadow-sm" 
          : "text-muted-foreground hover:text-foreground"
      )}
      title={shortcut ? `${label} (${shortcut})` : label}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/**
 * ObsidianMarkdownViewer - Obsidian-like Markdown editing experience
 */
export function ObsidianMarkdownViewer({
  content,
  onChange,
  fileName,
  onSave,
  onNavigateToFile,
  paneId,
  initialMode = "live",
  fileId, // Unique file identifier
  rootHandle,
  filePath,
  variant = "document",
}: ObsidianMarkdownViewerProps) {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [localContent, setLocalContent] = useState(content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [showOutline, setShowOutline] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const [activeHeading, setActiveHeading] = useState<number | undefined>();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LivePreviewEditorRef>(null);
  const resolvedFileId = fileId || fileName;
  const prevFileIdRef = useRef(resolvedFileId);
  const fileChangeCounterRef = useRef(0);
  const localContentRef = useRef(localContent);
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { localContentRef.current = localContent; }, [localContent]);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
  const { selection: aiSelection, dismiss: dismissAiMenu } = useTextSelection(containerRef);
  const { menuState: selectionMenuState, closeMenu: closeSelectionMenu } = useSelectionContextMenu(
    containerRef,
    ({ text }) => createSelectionContext({
      sourceKind: "markdown",
      paneId,
      fileName,
      filePath,
      selectedText: text,
      documentText: localContentRef.current,
    })
  );
  const saveEditorState = useContentCacheStore((state) => state.saveEditorState);
  const getEditorState = useContentCacheStore((state) => state.getEditorState);
  const pendingNavigation = useLinkNavigationStore((state) => state.pendingByPane[paneId]);
  const consumePendingNavigation = useLinkNavigationStore((state) => state.consumePendingNavigation);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceRootName = useWorkspaceStore((state) => state.rootHandle?.name ?? state.fileTree.root?.name ?? null);
  const runnerPreferences = useWorkspaceStore((state) => state.runnerPreferences);
  const setRecentRunConfig = useWorkspaceStore((state) => state.setRecentRunConfig);
  const setRunnerPreferences = useWorkspaceStore((state) => state.setRunnerPreferences);
  const absoluteFilePath = useMemo(
    () => (filePath ? resolveWorkspaceFilePath(workspaceRootPath, filePath, workspaceRootName) : null),
    [filePath, workspaceRootName, workspaceRootPath],
  );
  const runCwd = useMemo(
    () => (absoluteFilePath ? dirname(absoluteFilePath) : workspaceRootPath ?? undefined),
    [absoluteFilePath, workspaceRootPath],
  );
  const {
    status: runnerStatus,
    outputs,
    panelMeta,
    error: runnerError,
    summary,
    run,
    clearOutputs,
    setPanelMeta,
    isRunning,
    isLoading,
  } = useExecutionRunner();
  const currentDockFileKey = panelMeta.context?.blockKey ?? filePath ?? fileName;
  const currentDockCommand = panelMeta.context?.language
    ? getRunnerDefinitionForLanguage(panelMeta.context.language)?.command
    : undefined;
  const {
    runnerHealthSnapshot,
    refresh: refreshRunnerHealth,
  } = useRunnerHealth({
    cwd: runCwd,
    fileKey: currentDockFileKey,
    commands: currentDockCommand ? [currentDockCommand] : [],
    checkPython: panelMeta.context?.language
      ? getRunnerDefinitionForLanguage(panelMeta.context.language)?.runnerType === "python-local"
      : false,
    autoRefresh: false,
  });
  const healthContext = useMemo(
    () => ({
      kind: "workspace" as const,
      filePath: absoluteFilePath ?? filePath,
      fileName,
      label: "当前文档运行环境",
    }),
    [absoluteFilePath, fileName, filePath],
  );
  const {
    dockSize,
    isDockOpen: showRunDock,
    activeDockTab,
    setDockSize,
    setIsDockOpen: setShowRunDock,
    setActiveDockTab,
  } = useExecutionDockLayout({
    paneId,
    surfaceId: "markdown-execution",
    defaultSize: 38,
    defaultOpen: false,
    defaultTab: "run",
  });

  // CRITICAL: Force content update when file changes
  // Use fileId instead of fileName for more reliable detection
  useEffect(() => {
    if (resolvedFileId !== prevFileIdRef.current) {
      const previousFileId = prevFileIdRef.current;
      if (previousFileId) {
        const editorState = editorRef.current?.getEditorState();
        if (editorState) {
          saveEditorState(previousFileId, editorState);
        }
      }

      // File changed - force update
      prevFileIdRef.current = resolvedFileId;
      fileChangeCounterRef.current += 1;
      const changeId = fileChangeCounterRef.current;

      // Clear stale decoration cache from previous file
      clearDecorationCache();

      /* eslint-disable react-hooks/set-state-in-effect */
      setLocalContent(content);
      setIsDirty(false);
      setSaveStatus('idle');
      setOutline([]);
      setActiveHeading(undefined);
      /* eslint-enable react-hooks/set-state-in-effect */

      // Restore editor state if cached (with race condition guard)
      const cachedState = getEditorState(resolvedFileId);
      if (cachedState && fileChangeCounterRef.current === changeId) {
        editorRef.current?.restoreEditorState(cachedState);
      }
    } else if (content !== localContentRef.current && !isDirtyRef.current) {
      // Content changed externally (not by user editing)
      setLocalContent(content);
    }
  }, [content, resolvedFileId, getEditorState, saveEditorState]);

  // Persist editor state on unmount
  useEffect(() => {
    const editorInstance = editorRef.current;
    return () => {
      const currentFileId = resolvedFileId;
      const editorState = editorInstance?.getEditorState();
      if (editorState) {
        saveEditorState(currentFileId, editorState);
      }
    };
  }, [resolvedFileId, saveEditorState]);

  // Handle content changes from editor
  const handleContentChange = useCallback((newContent: string) => {
    setLocalContent(newContent);
    setIsDirty(true);
    onChange(newContent);
  }, [onChange]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!onSave) return;
    
    setSaveStatus("saving");
    try {
      await onSave();
      setIsDirty(false);
      setSaveStatus("saved");
      // Notify plugins that file was saved
      emitFileSave(resolvedFileId);
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [onSave, resolvedFileId]);

  // Handle mode change
  const handleModeChange = useCallback((newMode: ViewMode) => {
    setMode(newMode);
  }, []);

  // Handle outline navigation
  const handleOutlineNavigate = useCallback((line: number) => {
    setActiveHeading(line);
    // Scroll to line in editor via ref
    editorRef.current?.scrollToLine(line);
  }, []);

  // Handle outline update
  const handleOutlineChange = useCallback((newOutline: OutlineItem[]) => {
    setOutline(newOutline);
  }, []);

  // Handle AI inline insert (append after selection)
  const handleAiInsert = useCallback((text: string) => {
    const newContent = localContent + "\n\n" + text;
    handleContentChange(newContent);
  }, [localContent, handleContentChange]);

  // Handle AI inline replace (replace selected text)
  const handleAiReplace = useCallback((text: string) => {
    const sel = window.getSelection();
    const selectedText = sel?.toString() ?? "";
    if (selectedText && localContent.includes(selectedText)) {
      const newContent = localContent.replace(selectedText, text);
      handleContentChange(newContent);
    }
  }, [localContent, handleContentChange]);

  useEffect(() => {
    if (!filePath || !pendingNavigation) return;
    if (pendingNavigation.filePath !== filePath) return;
    let line: number | undefined;
    if (pendingNavigation.target.type === "workspace_heading") {
      const headingOutline = outline.length > 0
        ? outline
        : buildOutlineTree(parseHeadings(localContent));
      line = findHeadingLine(headingOutline, pendingNavigation.target.heading);
    } else if (pendingNavigation.target.type === "code_line") {
      line = pendingNavigation.target.line;
    } else {
      return;
    }

    if (!line) return;
    editorRef.current?.scrollToLine(line);
    window.setTimeout(() => {
      editorRef.current?.flashLine(line);
    }, 120);
    consumePendingNavigation(paneId, filePath);
  }, [consumePendingNavigation, filePath, localContent, outline, paneId, pendingNavigation]);

  const handleLinkNavigate = useCallback((target: string) => {
    void navigateLink(target, {
      paneId,
      rootHandle,
      currentFilePath: filePath,
    });
    onNavigateToFile?.(target);
  }, [filePath, onNavigateToFile, paneId, rootHandle]);

  useEffect(() => {
    if (outputs.some((output) => output.type === "error")) {
      startTransition(() => {
        setShowRunDock(true);
        setActiveDockTab("problems");
      });
    }
  }, [outputs, setActiveDockTab, setShowRunDock]);

  const problems = useMemo(
    () =>
      mergeExecutionProblems(
        diagnosticsToExecutionProblems(panelMeta.diagnostics, "preflight", panelMeta.context ?? null),
        outputsToExecutionProblems(outputs, panelMeta.context ?? null),
        runnerHealthIssuesToExecutionProblems(runnerHealthSnapshot.issues, healthContext),
      ),
    [healthContext, outputs, panelMeta.context, panelMeta.diagnostics, runnerHealthSnapshot.issues],
  );

  const handleCodeBlockRun = useCallback(async (request: LivePreviewCodeBlockRunRequest) => {
    const runnerDefinition = getRunnerDefinitionForLanguage(request.language);
    if (!runnerDefinition) {
      return;
    }

    await refreshRunnerHealth();
    const context = {
      kind: "markdown-block" as const,
      filePath,
      fileName,
      language: request.language,
      blockKey: request.blockKey,
      label: `${request.language || "text"} block`,
      range: request.range,
    };
    const resolved = await resolveRunnerExecutionRequest({
      runnerDefinition,
      mode: "inline",
      code: request.code,
      cwd: runCwd,
      absoluteFilePath: absoluteFilePath ?? undefined,
      fileKey: request.blockKey,
      language: request.language,
      preferences: runnerPreferences,
    });

    clearOutputs();
    setPanelMeta({
      origin: resolved.meta.origin,
      diagnostics: resolved.meta.diagnostics,
      context,
    });
    setShowRunDock(true);
    setActiveDockTab(resolved.meta.diagnostics.length > 0 ? "problems" : "run");

    if (!resolved.request) {
      return;
    }

    const result = await run(resolved.request);
    if (result.success) {
      const commit = buildRunnerPreferenceCommit({
        fileKey: request.blockKey,
        language: request.language,
        request: resolved.request,
        preferences: runnerPreferences,
      });
      setRecentRunConfig(commit.fileKey, commit.recentRunConfig);
      setRunnerPreferences(commit.preferences);
    }
  }, [
    absoluteFilePath,
    clearOutputs,
    fileName,
    filePath,
    refreshRunnerHealth,
    run,
    runCwd,
    runnerPreferences,
    setActiveDockTab,
    setPanelMeta,
    setRecentRunConfig,
    setRunnerPreferences,
    setShowRunDock,
  ]);

  const navigateToProblem = useCallback((problem: ExecutionProblem) => {
    const context = problem.context;
    if (!context) {
      return;
    }

    if (context.kind === "markdown-block" && context.range) {
      if (typeof context.range.startLine !== "number" || typeof context.range.endLine !== "number") {
        return;
      }
      editorRef.current?.revealCodeBlockLine({
        range: {
          from: context.range.from,
          to: context.range.to,
          startLine: context.range.startLine,
          endLine: context.range.endLine,
        },
        line: context.line,
      });
      return;
    }

    if (context.line) {
      editorRef.current?.scrollToLine(context.line);
      window.setTimeout(() => {
        editorRef.current?.flashLine(context.line!);
      }, 120);
    }
  }, []);

  const readingModeContent = useMemo(() => stripLeadingFrontmatter(localContent), [localContent]);

  const durationLabel = formatDuration(summary.durationMs);
  const shouldRenderRunDock = showRunDock || outputs.length > 0 || problems.length > 0 || isRunning || isLoading;
  const renderEditorPane = useCallback(() => (
    <div className="flex h-full min-h-0 overflow-hidden">
      {showOutline && (
        <div className="w-56 border-r border-border overflow-auto bg-muted/20 flex-shrink-0">
          <OutlinePanel
            items={outline}
            onNavigate={handleOutlineNavigate}
            activeHeading={activeHeading}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {mode === "reading" || (variant === "system-index" && mode !== "source") ? (
          <div className="h-full overflow-auto px-6 py-4">
            <MarkdownRenderer
              content={readingModeContent}
              fileName={fileName}
              paneId={paneId}
              filePath={filePath}
              rootHandle={rootHandle}
              variant="system-index"
            />
          </div>
        ) : (
          <LivePreviewEditor
            key={fileId || fileName}
            ref={editorRef}
            content={localContent}
            onChange={handleContentChange}
            mode={mode}
            onModeChange={handleModeChange}
            showLineNumbers={mode === 'source'}
            showFoldGutter={mode === 'live'}
            readOnly={variant === "system-index" && mode === "live"}
            onOutlineChange={handleOutlineChange}
            onWikiLinkClick={handleLinkNavigate}
            onLinkNavigate={handleLinkNavigate}
            onSave={handleSave}
            fileId={fileId || fileName}
            className="min-h-full"
            rootHandle={rootHandle}
            filePath={filePath}
            onCodeBlockRun={handleCodeBlockRun}
          />
        )}
      </div>
    </div>
  ), [
    activeHeading,
    fileId,
    fileName,
    filePath,
    handleCodeBlockRun,
    handleContentChange,
    handleLinkNavigate,
    handleModeChange,
    handleOutlineChange,
    handleOutlineNavigate,
    handleSave,
    localContent,
    mode,
    outline,
    paneId,
    readingModeContent,
    rootHandle,
    showOutline,
    variant,
  ]);

  const renderRunDock = useCallback((expanded: boolean) => (
    <div className={expanded ? "flex h-full min-h-0 flex-col border-t border-border bg-background" : "border-t border-border bg-background"}>
      <HorizontalScrollStrip
        className="border-b border-border bg-muted/50"
        viewportClassName="px-3 py-1.5"
        contentClassName="min-w-full w-max justify-between gap-3"
        ariaLabel="Markdown 执行停靠栏"
      >
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRunDock((value) => !value)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showRunDock ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            <span>{showRunDock ? "Hide Dock" : "Show Dock"}</span>
          </button>
          <div className="flex items-center rounded-md border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => {
                setActiveDockTab("run");
                setShowRunDock(true);
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
                setShowRunDock(true);
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

        <div className="flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground">
          {panelMeta.context?.language ? <span>{panelMeta.context.language}</span> : null}
          {panelMeta.context?.range?.startLine ? (
            <span>
              L{panelMeta.context.range.startLine}
              {panelMeta.context.range.endLine && panelMeta.context.range.endLine !== panelMeta.context.range.startLine
                ? `-L${panelMeta.context.range.endLine}`
                : ""}
            </span>
          ) : null}
          {durationLabel ? <span>{durationLabel}</span> : null}
          {summary.exitCode !== null ? <span>Exit {summary.exitCode}</span> : null}
          {runnerHealthSnapshot.issues.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-yellow-700 dark:text-yellow-300">
              <AlertTriangle className="h-3 w-3" />
              <span>{runnerHealthSnapshot.issues.length} health</span>
            </span>
          ) : null}
          <WorkspaceRunnerManager
            cwd={runCwd}
            fileKey={currentDockFileKey}
            commands={currentDockCommand ? [currentDockCommand] : []}
            title="Markdown Runner Manager"
            triggerLabel="Runner"
          />
        </div>
      </HorizontalScrollStrip>

      {expanded ? (
        <div className="h-full min-h-0 overflow-auto p-3">
          <KernelStatus status={runnerStatus} error={runnerError} />
          {activeDockTab === "run" ? (
            <>
              <OutputArea outputs={outputs} meta={panelMeta} showDiagnosticsInline={false} />
              {outputs.length === 0 && !runnerError && runnerStatus !== "loading" && runnerStatus !== "running" ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
                  No output yet. Use the Run button on a fenced code block to execute.
                </p>
              ) : null}
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
    currentDockCommand,
    currentDockFileKey,
    durationLabel,
    navigateToProblem,
    outputs,
    panelMeta,
    problems,
    runCwd,
    runnerError,
    runnerHealthSnapshot.issues.length,
    runnerStatus,
    setActiveDockTab,
    setShowRunDock,
    showRunDock,
    summary.exitCode,
  ]);

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <HorizontalScrollStrip
        className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur"
        viewportClassName="px-4 py-2"
        contentClassName="min-w-full w-max justify-between gap-3"
        ariaLabel={`${fileName} Markdown 工具栏`}
      >
        <div className="flex shrink-0 items-center gap-2">
          <span className="max-w-[18rem] truncate text-sm font-medium text-foreground">
            {fileName}
          </span>
          {isDirty && (
            <span className="text-xs text-muted-foreground">•</span>
          )}
          <SaveIndicator status={saveStatus} />
        </div>
        
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setShowOutline(!showOutline)}
            className={cn(
              "rounded p-1.5 transition-colors",
              showOutline ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            title={showOutline ? "Hide outline" : "Show outline"}
          >
            {showOutline ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeft className="h-4 w-4" />
            )}
          </button>
          
          <div className="mx-1 h-4 w-px bg-border" />
          
          <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5">
            <ModeButton
              mode="live"
              currentMode={mode}
              onClick={() => setMode("live")}
              icon={Sparkles}
              label="Live"
              shortcut="Ctrl+E"
            />
            <ModeButton
              mode="source"
              currentMode={mode}
              onClick={() => setMode("source")}
              icon={Code2}
              label="Source"
            />
            <ModeButton
              mode="reading"
              currentMode={mode}
              onClick={() => setMode("reading")}
              icon={Eye}
              label="Read"
            />
          </div>
          
          {onSave && (
            <button
              onClick={handleSave}
              disabled={saveStatus === "saving" || !isDirty}
              className={cn(
                "ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors",
                "hover:bg-accent",
                (saveStatus === "saving" || !isDirty) && "cursor-not-allowed opacity-50"
              )}
              title="Save (Ctrl+S)"
            >
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Save</span>
            </button>
          )}

          <button
            onClick={() => setShowExportDialog(true)}
            className="ml-1 flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-accent"
            title="导出 Markdown"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </HorizontalScrollStrip>

      {shouldRenderRunDock && showRunDock ? (
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
            {renderEditorPane()}
          </ResizablePanel>
          <ResizableHandle withHandle index={0} />
          <ResizablePanel index={1} defaultSize={dockSize} minSize={18} className="min-h-0 overflow-hidden">
            {renderRunDock(true)}
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            {renderEditorPane()}
          </div>
          {shouldRenderRunDock ? renderRunDock(false) : null}
        </div>
      )}

      {/* AI Inline Menu */}
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
      />

      <SelectionAiHub
        context={selectionHubState?.context ?? null}
        initialMode={selectionHubState?.mode ?? "chat"}
        returnFocusTo={selectionHubState?.returnFocusTo}
        onClose={() => setSelectionHubState(null)}
      />

      <MarkdownExportDialog
        isOpen={showExportDialog}
        onClose={() => setShowExportDialog(false)}
        content={localContent}
        fileName={fileName}
        filePath={filePath}
        rootHandle={rootHandle}
      />

    </div>
  );
}

export default ObsidianMarkdownViewer;

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

import { useState, useCallback, useDeferredValue, useEffect, useRef, useMemo, startTransition, type MouseEvent as ReactMouseEvent } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bold,
  Braces,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Code2,
  Copy,
  FileCode2,
  Hash,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  ListChecks,
  Mic,
  PanelTop,
  Pilcrow,
  Quote,
  Smile,
  Sparkles,
  Table2,
  Tags,
  Trash2,
} from "lucide-react";
import { SelectionContextMenu } from "@/components/ai/selection-context-menu";
import { SelectionAiHub } from "@/components/ai/selection-ai-hub";
import dynamic from "next/dynamic";
import type {
  ViewMode,
  OutlineItem,
  LivePreviewCodeBlockRunRequest,
} from "./codemirror/live-preview/types";
import type { LivePreviewEditorRef } from "./codemirror/live-preview/live-preview-editor";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { clearDecorationCache } from "./codemirror/live-preview/decoration-coordinator";
import { emitFileSave, emitVaultChange } from "@/lib/plugins/runtime";
import { navigateLinkWithFeedback } from "@/lib/link-router/navigate-link-with-feedback";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { parseHeadings, buildOutlineTree } from "./codemirror/live-preview/markdown-parser";
import type { CommandBarState, PaneId } from "@/types/layout";
import { MarkdownExportDialog } from "./markdown-export-dialog";
import { createSelectionContext, type SelectionAiMode, type SelectionContext } from "@/lib/ai/selection-context";
import { useSelectionContextMenu } from "@/hooks/use-selection-context-menu";
import { usePaneCommandBar } from "@/hooks/use-pane-command-bar";
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
import { MarkdownLinksPanel } from "@/components/editor/markdown-links-panel";
import type { ExecutionProblem } from "@/lib/runner/types";
import type { IndexedMarkdownLink } from "@/lib/markdown/link-index";
import type { MarkdownAttachmentCleanupCandidate } from "@/lib/markdown/attachment-cleanup";
import type { MarkdownUnlinkedMention } from "@/lib/markdown/workspace-link-index";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { WorkbenchContextMenu, type WorkbenchMenuAction } from "@/components/ui/workbench-context-menu";
import { useExecutionDockLayout } from "@/hooks/use-execution-dock-layout";
import { HorizontalScrollStrip } from "@/components/ui/horizontal-scroll-strip";
import { prepareMarkdownForReading } from "@/lib/markdown-reading";
import { findUnreferencedMarkdownAttachments } from "@/lib/markdown/attachment-cleanup";
import { ignoreWorkspaceMarkdownUnlinkedMention, getWorkspaceMarkdownLinkIndex, upsertWorkspaceMarkdownFile } from "@/lib/markdown/workspace-link-index";
import { convertMarkdownLinkToWikiInContent, linkUnlinkedMentionInContent, linkUnlinkedMentionsInContent, repairMarkdownLinkTargetInContent } from "@/lib/markdown/link-maintenance";
import { normalizeWorkspacePath } from "@/lib/link-router/path-utils";
import { findMarkdownHeadingLine, isPendingNavigationForFile } from "@/lib/markdown-navigation";
import { useI18n } from "@/hooks/use-i18n";
import { buildPersistedFileViewStateKey, loadPersistedFileViewState, savePersistedFileViewState } from "@/lib/file-view-state";
import type {
  MarkdownCommandPayload,
  MarkdownEditingCommandId,
  MarkdownEditorContext,
} from "./codemirror/live-preview/markdown-editing-commands";

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

type MarkdownMenuState = {
  x: number;
  y: number;
  context: MarkdownEditorContext;
};

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
};

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
};

function formatDuration(durationMs: number | null): string | null {
  if (durationMs === null) return null;
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(2)} s`;
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

function ensureMarkdownExtension(path: string): string {
  if (/\.(md|markdown)$/i.test(path)) {
    return path;
  }
  return `${path}.md`;
}

function buildMissingNoteTitle(path: string): string {
  const fileName = path.split("/").pop() || "New Note";
  return fileName.replace(/\.(md|markdown)$/i, "").replace(/[-_]+/g, " ").trim() || "New Note";
}

async function resolveWorkspaceFileHandle(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemFileHandle> {
  const parts = normalizeWorkspacePath(path).split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error("Invalid file path");
  }

  let directory = rootHandle;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part);
  }
  return directory.getFileHandle(fileName);
}

async function createWorkspaceMarkdownFile(
  rootHandle: FileSystemDirectoryHandle,
  path: string,
  content: string,
): Promise<void> {
  const normalized = normalizeWorkspacePath(path);
  const parts = normalized.split("/").filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) {
    throw new Error("Invalid note path");
  }

  let directory = rootHandle;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create: true });
  }

  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const existing = await fileHandle.getFile();
  if (existing.size > 0) {
    return;
  }

  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
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
  const { t } = useI18n();
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [localContent, setLocalContent] = useState(content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [showOutline, setShowOutline] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [markdownMenuState, setMarkdownMenuState] = useState<MarkdownMenuState | null>(null);
  const [markdownToolsMenuState, setMarkdownToolsMenuState] = useState<{ x: number; y: number } | null>(null);
  const [recentEmoji, setRecentEmoji] = useState<string[]>([]);
  const [selectionHubState, setSelectionHubState] = useState<{
    context: SelectionContext;
    mode: SelectionAiMode;
    returnFocusTo?: HTMLElement | null;
  } | null>(null);
  const [activeHeading, setActiveHeading] = useState<number | undefined>();
  const deferredLocalContent = useDeferredValue(localContent);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LivePreviewEditorRef>(null);
  const markdownToolsActionsRef = useRef<WorkbenchMenuAction[]>([]);
  const resolvedFileId = fileId || fileName;
  const prevFileIdRef = useRef(resolvedFileId);
  const workspaceRootPath = useWorkspaceStore((state) => state.workspaceRootPath);
  const workspaceKey = useWorkspaceStore((state) => state.workspaceIdentity?.workspaceKey ?? null);
  const workspaceRootName = useWorkspaceStore((state) => state.rootHandle?.name ?? state.fileTree.root?.name ?? null);
  const workspaceFileTreeRoot = useWorkspaceStore((state) => state.fileTree.root);
  const persistedViewStateKey = useMemo(
    () => buildPersistedFileViewStateKey({
      kind: "markdown",
      workspaceKey,
      workspaceRootPath,
      filePath,
      fallbackName: fileName,
    }),
    [fileName, filePath, workspaceKey, workspaceRootPath],
  );
  const prevPersistedViewStateKeyRef = useRef(persistedViewStateKey);
  const fileChangeCounterRef = useRef(0);
  const localContentRef = useRef(localContent);
  const isDirtyRef = useRef(isDirty);
  useEffect(() => { localContentRef.current = localContent; }, [localContent]);
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);
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
      label: t("workbench.runner.currentDocumentEnv"),
    }),
    [absoluteFilePath, fileName, filePath, t],
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

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("lattice.markdown.recentEmoji");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          setRecentEmoji(parsed.filter((value): value is string => typeof value === "string").slice(0, 8));
        }
      }
    } catch {
      setRecentEmoji([]);
    }
  }, []);

  const rememberEmoji = useCallback((emoji: string) => {
    setRecentEmoji((current) => {
      const next = [emoji, ...current.filter((item) => item !== emoji)].slice(0, 8);
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem("lattice.markdown.recentEmoji", JSON.stringify(next));
        } catch {}
      }
      return next;
    });
  }, []);

  const promptText = useCallback((label: string, fallback = ""): string | null => {
    if (typeof window === "undefined") return fallback || null;
    const value = window.prompt(label, fallback);
    if (value === null) return null;
    return value;
  }, []);

  const runMarkdownCommand = useCallback((
    commandId: MarkdownEditingCommandId,
    payload?: MarkdownCommandPayload,
  ) => {
    const handled = editorRef.current?.runMarkdownCommand(commandId, payload) ?? false;
    if (!handled) {
      toast.error("Markdown editor is not ready");
    }
    return handled;
  }, []);

  const copyText = useCallback(async (text: string, successMessage = "Copied") => {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      toast.error("Clipboard is not available");
      return false;
    }
    await navigator.clipboard.writeText(text);
    toast.success(successMessage);
    return true;
  }, []);

  const insertPromptedImage = useCallback((kind: "image" | "gif") => {
    const url = promptText(kind === "gif" ? "GIF URL" : "Image URL", kind === "gif" ? "https://example.com/animation.gif" : "");
    if (url === null) return;
    const alt = promptText("Alt text", kind === "gif" ? "gif" : "image");
    runMarkdownCommand(kind === "gif" ? "insert.gif" : "insert.image", {
      url,
      alt: alt ?? (kind === "gif" ? "gif" : "image"),
    });
  }, [promptText, runMarkdownCommand]);

  const replacePromptedImagePath = useCallback((context?: MarkdownEditorContext) => {
    const url = promptText("Image path", context?.imageUrl ?? "");
    if (url === null) return;
    runMarkdownCommand("image.replacePath", { url });
  }, [promptText, runMarkdownCommand]);

  const setPromptedImageAlt = useCallback((context?: MarkdownEditorContext) => {
    const alt = promptText("Alt text", context?.imageAlt ?? "");
    if (alt === null) return;
    runMarkdownCommand("image.setAlt", { alt });
  }, [promptText, runMarkdownCommand]);

  const setPromptedImageWidth = useCallback((context?: MarkdownEditorContext) => {
    const width = promptText("Image width", context?.imageWidth ? String(context.imageWidth) : "320");
    if (width === null) return;
    const parsed = Number(width);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      runMarkdownCommand("image.clearWidth");
      return;
    }
    runMarkdownCommand("image.setWidth", { width: parsed });
  }, [promptText, runMarkdownCommand]);

  const insertPromptedCodeBlock = useCallback(() => {
    const language = promptText("Code language", "typescript");
    if (language === null) return;
    runMarkdownCommand("insert.codeBlock", { language });
  }, [promptText, runMarkdownCommand]);

  const insertPromptedCallout = useCallback(() => {
    const calloutType = promptText("Callout type", "note");
    if (calloutType === null) return;
    const calloutTitle = promptText("Callout title", "");
    if (calloutTitle === null) return;
    runMarkdownCommand("insert.callout", { calloutType, calloutTitle });
  }, [promptText, runMarkdownCommand]);

  const setPromptedProperty = useCallback(() => {
    const propertyKey = promptText("Property key", "status");
    if (propertyKey === null) return;
    const propertyValue = promptText("Property value", "draft");
    if (propertyValue === null) return;
    runMarkdownCommand("properties.set", { propertyKey, propertyValue });
  }, [promptText, runMarkdownCommand]);

  const insertProperties = useCallback(() => {
    const propertyKey = promptText("Property key", "status");
    if (propertyKey === null) return;
    const propertyValue = promptText("Property value", "draft");
    if (propertyValue === null) return;
    runMarkdownCommand("insert.properties", { propertyKey, propertyValue });
  }, [promptText, runMarkdownCommand]);

  const updatePromptedCallout = useCallback((context?: MarkdownEditorContext) => {
    const calloutType = promptText("Callout type", context?.calloutType ?? "note");
    if (calloutType === null) return;
    const calloutTitle = promptText("Callout title", context?.calloutTitle ?? "");
    if (calloutTitle === null) return;
    runMarkdownCommand("callout.update", { calloutType, calloutTitle });
  }, [promptText, runMarkdownCommand]);

  const insertPromptedWikiLink = useCallback(() => {
    const target = promptText("Wiki link target", "");
    if (target === null) return;
    const alias = promptText("Alias", "");
    if (alias === null) return;
    runMarkdownCommand("insert.wikiLink", { target, alias });
  }, [promptText, runMarkdownCommand]);

  const insertPromptedHeadingAnchorLink = useCallback(() => {
    const target = promptText("Wiki link target", filePath?.replace(/\.(md|markdown)$/i, "") ?? "");
    if (target === null) return;
    const heading = promptText("Heading", "");
    if (heading === null) return;
    const alias = promptText("Alias", heading);
    if (alias === null) return;
    runMarkdownCommand("insert.headingAnchorLink", { target, heading, alias });
  }, [filePath, promptText, runMarkdownCommand]);

  const insertPromptedBlockAnchorLink = useCallback(() => {
    const target = promptText("Wiki link target", filePath?.replace(/\.(md|markdown)$/i, "") ?? "");
    if (target === null) return;
    const blockId = promptText("Block ID", "");
    if (blockId === null) return;
    const alias = promptText("Alias", "");
    if (alias === null) return;
    runMarkdownCommand("insert.blockAnchorLink", { target, blockId, alias });
  }, [filePath, promptText, runMarkdownCommand]);

  const insertPromptedEmbed = useCallback(() => {
    const target = promptText("Embed target", "");
    if (target === null) return;
    runMarkdownCommand("insert.embed", { target });
  }, [promptText, runMarkdownCommand]);

  const startVoiceInput = useCallback(() => {
    if (typeof window === "undefined") return;
    const recognitionWindow = window as SpeechRecognitionWindow;
    const Recognition = recognitionWindow.SpeechRecognition ?? recognitionWindow.webkitSpeechRecognition;
    if (!Recognition) {
      toast.error("Voice input is not supported in this browser");
      return;
    }

    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const transcript = event.results?.[0]?.[0]?.transcript;
      if (transcript) {
        runMarkdownCommand("insert.text", { text: transcript });
      }
    };
    recognition.onerror = () => toast.error("Voice input failed");
    recognition.start();
  }, [runMarkdownCommand]);

  // CRITICAL: Force content update when file changes
  // Use fileId instead of fileName for more reliable detection
  useEffect(() => {
    if (resolvedFileId !== prevFileIdRef.current) {
      const previousFileId = prevFileIdRef.current;
      if (previousFileId) {
        const editorState = editorRef.current?.getEditorState();
        if (editorState) {
          saveEditorState(previousFileId, editorState);
          void savePersistedFileViewState(prevPersistedViewStateKeyRef.current, editorState);
        }
      }

      // File changed - force update
      prevFileIdRef.current = resolvedFileId;
      prevPersistedViewStateKeyRef.current = persistedViewStateKey;
      fileChangeCounterRef.current += 1;
      const changeId = fileChangeCounterRef.current;

      // Clear stale decoration cache from previous file
      clearDecorationCache();

      setLocalContent(content);
      setIsDirty(false);
      setSaveStatus('idle');
      setOutline([]);
      setActiveHeading(undefined);

      // Restore editor state if cached (with race condition guard)
      const cachedState = getEditorState(resolvedFileId);
      if (cachedState && fileChangeCounterRef.current === changeId) {
        editorRef.current?.restoreEditorState(cachedState);
      }
    } else if (content !== localContentRef.current && !isDirtyRef.current) {
      // Content changed externally (not by user editing)
      setLocalContent(content);
    }
  }, [content, resolvedFileId, persistedViewStateKey, getEditorState, saveEditorState]);

  useEffect(() => {
    if (!persistedViewStateKey || getEditorState(resolvedFileId)) {
      return;
    }

    let cancelled = false;
    void loadPersistedFileViewState(persistedViewStateKey).then((persistedState) => {
      if (
        cancelled ||
        !persistedState ||
        typeof persistedState.cursorPosition !== "number" ||
        typeof persistedState.scrollTop !== "number"
      ) {
        return;
      }

      const restoredState = persistedState as {
        cursorPosition: number;
        scrollTop: number;
        selection?: { from: number; to: number };
      };
      editorRef.current?.restoreEditorState(restoredState);
      saveEditorState(resolvedFileId, restoredState);
    });

    return () => {
      cancelled = true;
    };
  }, [getEditorState, persistedViewStateKey, resolvedFileId, saveEditorState]);

  // Persist editor state on unmount
  useEffect(() => {
    const editorInstance = editorRef.current;
    return () => {
      const currentFileId = resolvedFileId;
      const editorState = editorInstance?.getEditorState();
      if (editorState) {
        saveEditorState(currentFileId, editorState);
        void savePersistedFileViewState(persistedViewStateKey, editorState);
      }
    };
  }, [persistedViewStateKey, resolvedFileId, saveEditorState]);

  // Handle content changes from editor
  const handleContentChange = useCallback((newContent: string) => {
    setLocalContent(newContent);
    setIsDirty(true);
    startTransition(() => {
      onChange(newContent);
    });
  }, [onChange]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!onSave) return;
    
    setSaveStatus("saving");
    try {
      await onSave();
      setIsDirty(false);
      setSaveStatus("saved");
      if (filePath) {
        upsertWorkspaceMarkdownFile(filePath, localContent);
      }
      // Notify plugins that file was saved
      emitFileSave(resolvedFileId);
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [filePath, localContent, onSave, resolvedFileId]);

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

  useEffect(() => {
    if (!filePath || !pendingNavigation) return;
    if (!isPendingNavigationForFile(pendingNavigation.filePath, filePath, rootHandle?.name)) return;
    let line: number | undefined;
    if (pendingNavigation.target.type === "workspace_heading") {
      const headingOutline = outline.length > 0
        ? outline
        : buildOutlineTree(parseHeadings(localContent));
      line = findMarkdownHeadingLine(headingOutline, pendingNavigation.target.heading);
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
  }, [consumePendingNavigation, filePath, localContent, outline, paneId, pendingNavigation, rootHandle?.name]);

  const handleLinkNavigate = useCallback((target: string) => {
    void navigateLinkWithFeedback(target, {
      paneId,
      rootHandle,
      currentFilePath: filePath,
    }).then((success) => {
      if (success) {
        onNavigateToFile?.(target);
      }
    });
  }, [filePath, onNavigateToFile, paneId, rootHandle]);

  const handleSourceLinkNavigate = useCallback((targetFile: string, line: number) => {
    void navigateLinkWithFeedback(`${targetFile}#line=${line}`, {
      paneId,
      rootHandle,
      currentFilePath: filePath,
    }).then((success) => {
      if (success) {
        onNavigateToFile?.(targetFile);
      }
    });
  }, [filePath, onNavigateToFile, paneId, rootHandle]);

  const handleCreateMissingNote = useCallback(async (link: IndexedMarkdownLink) => {
    if (!rootHandle || !link.parsedTarget || !("path" in link.parsedTarget)) {
      return;
    }

    const targetPath = ensureMarkdownExtension(normalizeWorkspacePath(link.parsedTarget.path));
    const title = buildMissingNoteTitle(targetPath);
    const initialContent = `# ${title}\n\n`;

    try {
      await createWorkspaceMarkdownFile(rootHandle, targetPath, initialContent);
      upsertWorkspaceMarkdownFile(targetPath, initialContent);
      emitVaultChange(targetPath);
      toast.success(t("markdown.links.toast.created"), {
        description: targetPath,
      });
      handleLinkNavigate(targetPath);
    } catch (error) {
      toast.error(t("markdown.links.toast.createFailed"), {
        description: error instanceof Error ? error.message : t("markdown.links.toast.createFailedDescription"),
      });
    }
  }, [handleLinkNavigate, rootHandle, t]);

  const handleLinkUnlinkedMention = useCallback(async (mention: MarkdownUnlinkedMention) => {
    if (!rootHandle) {
      return;
    }

    try {
      const fileHandle = await resolveWorkspaceFileHandle(rootHandle, mention.sourceFile);
      const content = await (await fileHandle.getFile()).text();
      const result = linkUnlinkedMentionInContent(content, mention);
      if (!result.changed) {
        throw new Error("Mention text is no longer available");
      }

      const writable = await fileHandle.createWritable();
      await writable.write(result.content);
      await writable.close();
      upsertWorkspaceMarkdownFile(mention.sourceFile, result.content);
      emitVaultChange(mention.sourceFile);
      toast.success(t("markdown.links.toast.linkedMention"), {
        description: mention.sourceFile,
      });
    } catch (error) {
      toast.error(t("markdown.links.toast.linkMentionFailed"), {
        description: error instanceof Error ? error.message : t("markdown.links.toast.createFailedDescription"),
      });
    }
  }, [rootHandle, t]);

  const handleLinkUnlinkedMentions = useCallback(async (mentions: MarkdownUnlinkedMention[]) => {
    if (!rootHandle || mentions.length === 0) {
      return;
    }

    const mentionsByFile = new Map<string, MarkdownUnlinkedMention[]>();
    for (const mention of mentions) {
      const items = mentionsByFile.get(mention.sourceFile) ?? [];
      items.push(mention);
      mentionsByFile.set(mention.sourceFile, items);
    }

    try {
      let linkedCount = 0;
      for (const [sourceFile, sourceMentions] of mentionsByFile) {
        const fileHandle = await resolveWorkspaceFileHandle(rootHandle, sourceFile);
        const content = await (await fileHandle.getFile()).text();
        const result = linkUnlinkedMentionsInContent(content, sourceMentions);
        if (!result.changed) {
          continue;
        }

        const writable = await fileHandle.createWritable();
        await writable.write(result.content);
        await writable.close();
        upsertWorkspaceMarkdownFile(sourceFile, result.content);
        emitVaultChange(sourceFile);
        linkedCount += result.linkedCount;
      }

      if (linkedCount === 0) {
        throw new Error("Mention text is no longer available");
      }

      toast.success(t("markdown.links.toast.linkedMentions"), {
        description: String(linkedCount),
      });
    } catch (error) {
      toast.error(t("markdown.links.toast.linkMentionFailed"), {
        description: error instanceof Error ? error.message : t("markdown.links.toast.createFailedDescription"),
      });
    }
  }, [rootHandle, t]);

  const handleIgnoreUnlinkedMention = useCallback((mention: MarkdownUnlinkedMention) => {
    ignoreWorkspaceMarkdownUnlinkedMention(mention);
    toast.success(t("markdown.links.toast.ignoredMention"), {
      description: mention.sourceFile,
    });
  }, [t]);

  const handleRepairBrokenLink = useCallback(async (link: IndexedMarkdownLink, targetFile: string) => {
    if (!rootHandle) {
      return;
    }

    try {
      const fileHandle = await resolveWorkspaceFileHandle(rootHandle, link.sourceFile);
      const content = await (await fileHandle.getFile()).text();
      const result = repairMarkdownLinkTargetInContent(content, link, targetFile);
      if (!result.changed) {
        throw new Error("Link text is no longer available");
      }

      const writable = await fileHandle.createWritable();
      await writable.write(result.content);
      await writable.close();
      upsertWorkspaceMarkdownFile(link.sourceFile, result.content);
      emitVaultChange(link.sourceFile);
      toast.success(t("markdown.links.toast.repairedLink"), {
        description: link.sourceFile,
      });
    } catch (error) {
      toast.error(t("markdown.links.toast.repairLinkFailed"), {
        description: error instanceof Error ? error.message : t("markdown.links.toast.createFailedDescription"),
      });
    }
  }, [rootHandle, t]);

  const handleConvertMarkdownLinkToWiki = useCallback(async (link: IndexedMarkdownLink) => {
    if (!rootHandle) {
      return;
    }

    try {
      const fileHandle = await resolveWorkspaceFileHandle(rootHandle, link.sourceFile);
      const content = await (await fileHandle.getFile()).text();
      const result = convertMarkdownLinkToWikiInContent(content, link);
      if (!result.changed) {
        throw new Error("Link text is no longer available");
      }

      const writable = await fileHandle.createWritable();
      await writable.write(result.content);
      await writable.close();
      upsertWorkspaceMarkdownFile(link.sourceFile, result.content);
      emitVaultChange(link.sourceFile);
      toast.success(t("markdown.links.toast.convertedToWiki"), {
        description: link.sourceFile,
      });
    } catch (error) {
      toast.error(t("markdown.links.toast.convertToWikiFailed"), {
        description: error instanceof Error ? error.message : t("markdown.links.toast.createFailedDescription"),
      });
    }
  }, [rootHandle, t]);

  const handleReviewUnreferencedAttachment = useCallback((candidate: MarkdownAttachmentCleanupCandidate) => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `${t("markdown.links.confirmAttachmentCleanup")}\n\n${candidate.displayPath}`,
      );
      if (!confirmed) return;
    }

    toast.message(t("markdown.links.toast.attachmentReviewReady"), {
      description: candidate.displayPath,
    });
  }, [t]);

  const copyCurrentBlockAsMarkdown = useCallback(async () => {
    const copied = await editorRef.current?.copyCurrentBlockAsMarkdown();
    if (copied) {
      toast.success("Copied Markdown");
    }
  }, []);

  const copyCurrentBlockAsHtml = useCallback(async () => {
    const copied = await editorRef.current?.copyCurrentBlockAsHtml();
    if (copied) {
      toast.success("Copied HTML");
    }
  }, []);

  const copyPropertiesYaml = useCallback(async () => {
    const copied = await editorRef.current?.copyPropertiesYaml();
    if (copied) {
      toast.success("Copied properties YAML");
    } else {
      toast.error("No properties block found");
    }
  }, []);

  const pastePlainText = useCallback(async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
      toast.error("Clipboard read is not available");
      return;
    }
    const text = await navigator.clipboard.readText();
    runMarkdownCommand("insert.text", { text });
  }, [runMarkdownCommand]);

  const openQuantumKeyboard = useCallback(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("lattice-open-quantum-keyboard"));
  }, []);

  const copyFormulaAsLatex = useCallback((context: MarkdownEditorContext) => {
    const latex = context.blockText
      .replace(/^\s*\$\$\s*/, "")
      .replace(/\s*\$\$\s*$/, "")
      .replace(/^\s*\$/, "")
      .replace(/\$\s*$/, "")
      .trim();
    void copyText(latex, "Copied LaTeX");
  }, [copyText]);

  const buildMarkdownContextActions = useCallback((menu: MarkdownMenuState): WorkbenchMenuAction[] => {
    const { context } = menu;
    const hasSelection = context.selectedText.length > 0;
    const actions: WorkbenchMenuAction[] = [
      {
        id: "cut",
        label: "Cut",
        icon: <Trash2 className="h-4 w-4" />,
        shortcut: "Ctrl+X",
        disabled: !hasSelection,
        onSelect: () => {
          void copyText(context.selectedText, "Cut");
          runMarkdownCommand("selection.delete");
        },
      },
      {
        id: "copy",
        label: "Copy",
        icon: <Copy className="h-4 w-4" />,
        shortcut: "Ctrl+C",
        disabled: !hasSelection,
        onSelect: () => void copyText(context.selectedText),
      },
      {
        id: "paste-plain",
        label: "Paste as plain text",
        icon: <ClipboardPaste className="h-4 w-4" />,
        shortcut: "Ctrl+Shift+V",
        onSelect: () => void pastePlainText(),
      },
      {
        id: "select-all",
        label: "Select all",
        shortcut: "Ctrl+A",
        onSelect: () => runMarkdownCommand("selection.selectAll"),
      },
    ];

    if (hasSelection) {
      actions.push(
        {
          id: "format-bold",
          label: "Bold",
          icon: <Bold className="h-4 w-4" />,
          shortcut: "Ctrl+B",
          separatorBefore: true,
          onSelect: () => runMarkdownCommand("format.bold"),
        },
        {
          id: "format-italic",
          label: "Italic",
          icon: <Italic className="h-4 w-4" />,
          shortcut: "Ctrl+I",
          onSelect: () => runMarkdownCommand("format.italic"),
        },
        {
          id: "format-link",
          label: "Add link",
          icon: <LinkIcon className="h-4 w-4" />,
          shortcut: "Ctrl+K",
          onSelect: () => runMarkdownCommand("format.link"),
        },
        {
          id: "format-code",
          label: "Inline code",
          icon: <Code2 className="h-4 w-4" />,
          onSelect: () => runMarkdownCommand("format.code"),
        },
        {
          id: "format-quote",
          label: "Quote selection",
          icon: <Quote className="h-4 w-4" />,
          onSelect: () => runMarkdownCommand("format.quote"),
        },
      );
    }

    if (context.kind === "table") {
      actions.push(
        {
          id: "copy-table-markdown",
          label: "Table: Copy as Markdown",
          icon: <Table2 className="h-4 w-4" />,
          separatorBefore: true,
          onSelect: () => void copyCurrentBlockAsMarkdown(),
        },
        {
          id: "copy-table-html",
          label: "Table: Copy as HTML",
          onSelect: () => void copyCurrentBlockAsHtml(),
        },
        {
          id: "insert-table",
          label: "Table: Insert table",
          icon: <Table2 className="h-4 w-4" />,
          onSelect: () => runMarkdownCommand("insert.table"),
        },
      );
    }

    if (context.kind === "link" && context.linkTarget) {
      actions.push(
        {
          id: "copy-link-target",
          label: "Link: Copy target",
          icon: <LinkIcon className="h-4 w-4" />,
          separatorBefore: true,
          onSelect: () => void copyText(context.linkTarget ?? "", "Copied link"),
        },
        {
          id: "convert-markdown-link-to-wiki",
          label: "Link: Convert to wiki link",
          icon: <LinkIcon className="h-4 w-4" />,
          onSelect: () => runMarkdownCommand("link.convertMarkdownToWiki"),
        },
      );
    }

    if (context.kind === "image" && context.imageUrl) {
      actions.push(
        {
          id: "copy-image-target",
          label: "Image: Copy path",
          icon: <ImageIcon className="h-4 w-4" />,
          separatorBefore: true,
          onSelect: () => void copyText(context.imageUrl ?? "", "Copied image path"),
        },
        {
          id: "image-open-source",
          label: "Image: Open source",
          icon: <Code2 className="h-4 w-4" />,
          onSelect: () => runMarkdownCommand("image.openSource"),
        },
        {
          id: "image-replace-path",
          label: "Image: Replace path",
          icon: <ImageIcon className="h-4 w-4" />,
          onSelect: () => replacePromptedImagePath(context),
        },
        {
          id: "image-set-alt",
          label: "Image: Set alt text",
          icon: <Tags className="h-4 w-4" />,
          onSelect: () => setPromptedImageAlt(context),
        },
        {
          id: "image-set-width",
          label: "Image: Set width",
          icon: <ImageIcon className="h-4 w-4" />,
          onSelect: () => setPromptedImageWidth(context),
        },
        {
          id: "image-clear-width",
          label: "Image: Clear width",
          onSelect: () => runMarkdownCommand("image.clearWidth"),
        },
      );
    }

    if (context.kind === "math") {
      actions.push({
        id: "copy-latex",
        label: "Copy as LaTeX",
        icon: <Braces className="h-4 w-4" />,
        separatorBefore: true,
        onSelect: () => copyFormulaAsLatex(context),
      });
    }

    if (context.kind === "properties") {
      actions.push(
        {
          id: "properties-set",
          label: "Properties: Set property",
          icon: <Tags className="h-4 w-4" />,
          separatorBefore: true,
          onSelect: setPromptedProperty,
        },
        {
          id: "properties-copy",
          label: "Properties: Copy YAML",
          icon: <Copy className="h-4 w-4" />,
          onSelect: () => void copyPropertiesYaml(),
        },
        {
          id: "properties-convert-line",
          label: "Properties: Convert line to property",
          icon: <PanelTop className="h-4 w-4" />,
          onSelect: () => runMarkdownCommand("properties.convertLine"),
        },
      );
    }

    if (context.kind === "callout") {
      actions.push(
        {
          id: "callout-edit",
          label: "Callout: Edit type/title",
          separatorBefore: true,
          onSelect: () => updatePromptedCallout(context),
        },
        {
          id: "callout-copy",
          label: "Callout: Copy Markdown",
          onSelect: () => void copyCurrentBlockAsMarkdown(),
        },
        {
          id: "callout-copy-body",
          label: "Callout: Copy body",
          onSelect: () => runMarkdownCommand("callout.copyBody"),
        },
        {
          id: "callout-duplicate",
          label: "Callout: Duplicate",
          onSelect: () => runMarkdownCommand("callout.duplicate"),
        },
        {
          id: "callout-extract-body",
          label: "Callout: Extract body",
          onSelect: () => runMarkdownCommand("callout.extractBody"),
        },
        {
          id: "callout-split-body-line",
          label: "Callout: Split at body line",
          onSelect: () => runMarkdownCommand("callout.splitAtBodyLine"),
        },
      );
    }

    actions.push(
      {
        id: "copy-block-markdown",
        label: "Copy current block as Markdown",
        separatorBefore: true,
        onSelect: () => void copyCurrentBlockAsMarkdown(),
      },
      {
        id: "copy-block-html",
        label: "Copy current block as HTML",
        onSelect: () => void copyCurrentBlockAsHtml(),
      },
      {
        id: "more-tools",
        label: "More Tools",
        icon: <Sparkles className="h-4 w-4" />,
        separatorBefore: true,
        onSelect: () => {},
        children: markdownToolsActionsRef.current,
      },
    );

    return actions;
  }, [
    copyCurrentBlockAsHtml,
    copyCurrentBlockAsMarkdown,
    copyFormulaAsLatex,
    copyPropertiesYaml,
    copyText,
    insertPromptedCallout,
    insertPromptedCodeBlock,
    insertPromptedEmbed,
    insertPromptedBlockAnchorLink,
    insertPromptedHeadingAnchorLink,
    insertPromptedImage,
    insertPromptedWikiLink,
    insertProperties,
    openQuantumKeyboard,
    pastePlainText,
    replacePromptedImagePath,
    runMarkdownCommand,
    setPromptedImageAlt,
    setPromptedImageWidth,
    setPromptedProperty,
    updatePromptedCallout,
  ]);

  const buildMarkdownToolsActions = useCallback((): WorkbenchMenuAction[] => {
    const symbolGroups = [
      { label: "Recent", items: recentEmoji },
      { label: "Writing", items: ["\u2705", "\u26A0\uFE0F", "\u{1F4A1}", "\u{1F4CC}", "\u2B50", "\u2753"] },
      { label: "Math", items: ["\u221E", "\u2248", "\u2260", "\u2264", "\u2265", "\u2211", "\u220F", "\u222B"] },
      { label: "Greek", items: ["\u03B1", "\u03B2", "\u03B3", "\u03B4", "\u03BB", "\u03BC", "\u03C0", "\u03A9"] },
      { label: "Arrows", items: ["\u2192", "\u2190", "\u21D2", "\u21D4", "\u2191", "\u2193", "\u21A6", "\u21CC"] },
      { label: "Science", items: ["\u00B0", "\u00B1", "\u00D7", "\u00F7", "\u03BC", "\u212B", "\u210F", "\u2202"] },
      { label: "Mood", items: ["\u{1F642}", "\u{1F914}", "\u{1F389}", "\u{1F525}", "\u{1F680}", "\u{1F9EA}"] },
    ];

    const symbolActions: WorkbenchMenuAction[] = symbolGroups
      .filter((category) => category.items.length > 0)
      .map((category) => ({
        id: `symbols-${category.label.toLowerCase()}`,
        label: category.label,
        icon: <Smile className="h-4 w-4" />,
        onSelect: () => {},
        children: Array.from(new Set(category.items)).map((symbol, index) => ({
          id: `symbol-${category.label.toLowerCase()}-${index}`,
          label: symbol,
          icon: <Smile className="h-4 w-4" />,
          onSelect: () => {
            rememberEmoji(symbol);
            runMarkdownCommand("insert.emoji", { text: symbol });
          },
        })),
      }));

    return [
      {
        id: "voice-input",
        label: "Voice input",
        icon: <Mic className="h-4 w-4" />,
        onSelect: startVoiceInput,
      },
      {
        id: "tools-blocks",
        label: "Blocks",
        icon: <Quote className="h-4 w-4" />,
        separatorBefore: true,
        onSelect: () => {},
        children: [
          {
            id: "insert-callout",
            label: "Insert callout",
            icon: <Quote className="h-4 w-4" />,
            onSelect: insertPromptedCallout,
          },
          {
            id: "edit-callout",
            label: "Edit current callout",
            icon: <Quote className="h-4 w-4" />,
            onSelect: () => updatePromptedCallout(editorRef.current?.getMarkdownContext() ?? undefined),
          },
          {
            id: "insert-task-list",
            label: "Insert task list",
            icon: <ListChecks className="h-4 w-4" />,
            onSelect: () => runMarkdownCommand("insert.taskList"),
          },
          {
            id: "insert-footnote",
            label: "Insert footnote",
            icon: <Hash className="h-4 w-4" />,
            onSelect: () => runMarkdownCommand("insert.footnote"),
          },
          {
            id: "insert-code-block",
            label: "Insert code block",
            icon: <FileCode2 className="h-4 w-4" />,
            onSelect: insertPromptedCodeBlock,
          },
          {
            id: "insert-math-block",
            label: "Insert math block",
            icon: <Braces className="h-4 w-4" />,
            onSelect: () => runMarkdownCommand("insert.mathBlock"),
          },
        ],
      },
      {
        id: "tools-tables-properties",
        label: "Tables and properties",
        icon: <Table2 className="h-4 w-4" />,
        onSelect: () => {},
        children: [
          {
            id: "insert-table",
            label: "Insert table",
            icon: <Table2 className="h-4 w-4" />,
            onSelect: () => runMarkdownCommand("insert.table"),
          },
          {
            id: "insert-properties",
            label: "Insert properties",
            icon: <PanelTop className="h-4 w-4" />,
            onSelect: insertProperties,
          },
          {
            id: "set-property",
            label: "Set property",
            icon: <Tags className="h-4 w-4" />,
            onSelect: setPromptedProperty,
          },
          {
            id: "copy-properties-yaml",
            label: "Copy properties YAML",
            icon: <Copy className="h-4 w-4" />,
            onSelect: () => void copyPropertiesYaml(),
          },
          {
            id: "convert-line-to-property",
            label: "Convert line to property",
            icon: <PanelTop className="h-4 w-4" />,
            onSelect: () => runMarkdownCommand("properties.convertLine"),
          },
        ],
      },
      {
        id: "open-quantum-keyboard",
        label: "Quantum keyboard",
        icon: <Braces className="h-4 w-4" />,
        onSelect: openQuantumKeyboard,
      },
      {
        id: "tools-links",
        label: "Links",
        icon: <LinkIcon className="h-4 w-4" />,
        onSelect: () => {},
        children: [
          {
            id: "insert-wiki-link",
            label: "Insert wiki link",
            icon: <LinkIcon className="h-4 w-4" />,
            onSelect: insertPromptedWikiLink,
          },
          {
            id: "insert-heading-anchor-link",
            label: "Insert heading anchor link",
            icon: <Hash className="h-4 w-4" />,
            onSelect: insertPromptedHeadingAnchorLink,
          },
          {
            id: "insert-block-anchor-link",
            label: "Insert block anchor link",
            icon: <Pilcrow className="h-4 w-4" />,
            onSelect: insertPromptedBlockAnchorLink,
          },
        ],
      },
      {
        id: "tools-media",
        label: "Media",
        icon: <ImageIcon className="h-4 w-4" />,
        onSelect: () => {},
        children: [
          {
            id: "insert-image",
            label: "Insert image / attachment",
            icon: <ImageIcon className="h-4 w-4" />,
            onSelect: () => insertPromptedImage("image"),
          },
          {
            id: "insert-embed",
            label: "Insert embed",
            icon: <ImageIcon className="h-4 w-4" />,
            onSelect: insertPromptedEmbed,
          },
          {
            id: "insert-gif",
            label: "Insert GIF URL",
            icon: <Sparkles className="h-4 w-4" />,
            onSelect: () => insertPromptedImage("gif"),
          },
        ],
      },
      {
        id: "tools-symbols",
        label: "Symbols",
        icon: <Smile className="h-4 w-4" />,
        separatorBefore: true,
        onSelect: () => {},
        children: symbolActions,
      },
      {
        id: "tools-copy",
        label: "Copy",
        icon: <Copy className="h-4 w-4" />,
        onSelect: () => {},
        children: [
          {
            id: "copy-block-markdown",
            label: "Copy current block as Markdown",
            icon: <Copy className="h-4 w-4" />,
            onSelect: () => void copyCurrentBlockAsMarkdown(),
          },
          {
            id: "copy-block-html",
            label: "Copy current block as HTML",
            icon: <Copy className="h-4 w-4" />,
            onSelect: () => void copyCurrentBlockAsHtml(),
          },
        ],
      },
    ];
  }, [
    copyCurrentBlockAsHtml,
    copyCurrentBlockAsMarkdown,
    copyPropertiesYaml,
    insertPromptedCallout,
    insertPromptedCodeBlock,
    insertPromptedEmbed,
    insertPromptedBlockAnchorLink,
    insertPromptedHeadingAnchorLink,
    insertPromptedImage,
    insertPromptedWikiLink,
    insertProperties,
    recentEmoji,
    rememberEmoji,
    runMarkdownCommand,
    setPromptedProperty,
    startVoiceInput,
    updatePromptedCallout,
  ]);
  markdownToolsActionsRef.current = buildMarkdownToolsActions();

  const handleMarkdownContextMenu = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest(".live-preview-editor")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const currentContext = editorRef.current?.getMarkdownContext();
    if (!currentContext?.selectedText) {
      editorRef.current?.setCursorFromPoint(event.clientX, event.clientY);
    }

    const context = editorRef.current?.getMarkdownContext();
    if (!context) return;
    setMarkdownMenuState({ x: event.clientX, y: event.clientY, context });
  }, []);

  const commandBarState = useMemo<CommandBarState>(() => {
    const breadcrumbs = (filePath ?? fileName)
      .split("/")
      .filter(Boolean)
      .map((segment) => ({ label: segment }));
    return {
      breadcrumbs,
      actions: [
        {
          id: "save",
          label: t("common.save"),
          priority: 10,
          group: "primary",
          disabled: !onSave || saveStatus === "saving" || !isDirty,
          onTrigger: () => { void handleSave(); },
        },
        {
          id: "export",
          label: t("workbench.commandBar.export"),
          priority: 20,
          group: "secondary",
          onTrigger: () => setShowExportDialog(true),
        },
        {
          id: "search",
          label: t("workbench.search.title"),
          priority: 25,
          group: "secondary",
          onTrigger: () => editorRef.current?.openSearch(),
        },
        {
          id: "markdown-tools",
          label: "Markdown Tools",
          icon: "file-pen-line",
          priority: 26,
          group: "secondary",
          disabled: mode === "reading" || (variant === "system-index" && mode !== "source"),
          onTrigger: () => setMarkdownToolsMenuState({
            x: typeof window === "undefined" ? 80 : Math.max(16, window.innerWidth - 260),
            y: 64,
          }),
          onContextMenu: (position) => setMarkdownToolsMenuState(position),
        },
        {
          id: "outline",
          label: showOutline ? t("workbench.commandBar.hideOutline") : t("workbench.commandBar.showOutline"),
          priority: 30,
          group: "secondary",
          onTrigger: () => setShowOutline((value) => !value),
        },
        {
          id: "links",
          label: showLinks ? t("workbench.commandBar.hideLinks") : t("workbench.commandBar.showLinks"),
          priority: 31,
          group: "secondary",
          disabled: !filePath,
          onTrigger: () => setShowLinks((value) => !value),
        },
        {
          id: "mode-live",
          label: t("workbench.commandBar.live"),
          priority: 40,
          group: "primary",
          disabled: mode === "live",
          onTrigger: () => setMode("live"),
        },
        {
          id: "mode-source",
          label: t("workbench.commandBar.source"),
          priority: 41,
          group: "primary",
          disabled: mode === "source",
          onTrigger: () => setMode("source"),
        },
        {
          id: "mode-reading",
          label: t("workbench.commandBar.read"),
          priority: 42,
          group: "primary",
          disabled: mode === "reading",
          onTrigger: () => setMode("reading"),
        },
      ],
    };
  }, [
    fileName,
    filePath,
    handleSave,
    isDirty,
    mode,
    onSave,
    saveStatus,
    showLinks,
    showOutline,
    t,
    variant,
  ]);

  usePaneCommandBar({
    paneId,
    state: commandBarState,
  });

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

  const readingModeContent = useMemo(() => prepareMarkdownForReading(deferredLocalContent), [deferredLocalContent]);
  const attachmentCleanupCandidates = useMemo(
    () => {
      if (!showLinks) {
        return [];
      }
      return findUnreferencedMarkdownAttachments({
        root: workspaceFileTreeRoot,
        index: getWorkspaceMarkdownLinkIndex().index,
        workspaceRootName,
      });
    },
    [deferredLocalContent, showLinks, workspaceFileTreeRoot, workspaceRootName],
  );

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
      {showLinks && (
        <div className="w-64 border-r border-border flex-shrink-0">
          <MarkdownLinksPanel
            filePath={filePath}
            onNavigate={handleLinkNavigate}
            onNavigateToSource={handleSourceLinkNavigate}
            onCreateMissingNote={handleCreateMissingNote}
            onLinkUnlinkedMention={handleLinkUnlinkedMention}
            onLinkUnlinkedMentions={handleLinkUnlinkedMentions}
            onIgnoreUnlinkedMention={handleIgnoreUnlinkedMention}
            onRepairBrokenLink={handleRepairBrokenLink}
            onConvertMarkdownLinkToWiki={handleConvertMarkdownLinkToWiki}
            attachmentCleanupCandidates={attachmentCleanupCandidates}
            onReviewUnreferencedAttachment={handleReviewUnreferencedAttachment}
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-auto" onContextMenu={handleMarkdownContextMenu}>
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
    attachmentCleanupCandidates,
    fileId,
    fileName,
    filePath,
    handleCodeBlockRun,
    handleContentChange,
    handleLinkNavigate,
    handleModeChange,
    handleOutlineChange,
    handleOutlineNavigate,
    handleCreateMissingNote,
    handleConvertMarkdownLinkToWiki,
    handleIgnoreUnlinkedMention,
    handleLinkUnlinkedMention,
    handleLinkUnlinkedMentions,
    handleRepairBrokenLink,
    handleReviewUnreferencedAttachment,
    handleSourceLinkNavigate,
    handleSave,
    handleMarkdownContextMenu,
    localContent,
    mode,
    outline,
    paneId,
    readingModeContent,
    rootHandle,
    showLinks,
    showOutline,
    variant,
  ]);

  const renderRunDock = useCallback((expanded: boolean) => (
    <div className={expanded ? "flex h-full min-h-0 flex-col border-t border-border bg-background" : "border-t border-border bg-background"}>
      <HorizontalScrollStrip
        className="border-b border-border bg-muted/50"
        viewportClassName="px-3 py-1.5"
        contentClassName="min-w-full w-max justify-between gap-3"
        ariaLabel={t("workbench.runner.managerMarkdown")}
      >
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowRunDock((value) => !value)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showRunDock ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
            <span>{showRunDock ? t("workbench.dock.hide") : t("workbench.dock.show")}</span>
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
              {t("workbench.dock.run")}
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
              {t("workbench.dock.problems")}
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
          {summary.exitCode !== null ? <span>{t("workbench.runner.exit", { code: summary.exitCode })}</span> : null}
          {runnerHealthSnapshot.issues.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-yellow-700 dark:text-yellow-300">
              <AlertTriangle className="h-3 w-3" />
              <span>{t("workbench.runner.health", { count: runnerHealthSnapshot.issues.length })}</span>
            </span>
          ) : null}
          <WorkspaceRunnerManager
            cwd={runCwd}
            fileKey={currentDockFileKey}
            commands={currentDockCommand ? [currentDockCommand] : []}
            title={t("workbench.runner.managerMarkdown")}
            triggerLabel={t("workbench.runner.trigger")}
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
                  {t("workbench.runner.noOutput")}
                </p>
              ) : null}
            </>
          ) : (
            <>
              <ProblemsPanel problems={problems} onSelectProblem={navigateToProblem} />
              {problems.length === 0 ? (
                <p className="py-4 text-center text-xs text-muted-foreground">
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
    t,
  ]);

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-background">
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

      {markdownMenuState ? (
        <WorkbenchContextMenu
          x={markdownMenuState.x}
          y={markdownMenuState.y}
          actions={buildMarkdownContextActions(markdownMenuState)}
          onClose={() => setMarkdownMenuState(null)}
          minWidthClassName="min-w-[240px]"
        />
      ) : null}

      {markdownToolsMenuState ? (
        <WorkbenchContextMenu
          x={markdownToolsMenuState.x}
          y={markdownToolsMenuState.y}
          actions={buildMarkdownToolsActions()}
          onClose={() => setMarkdownToolsMenuState(null)}
          minWidthClassName="min-w-[250px]"
        />
      ) : null}

    </div>
  );
}

export default ObsidianMarkdownViewer;

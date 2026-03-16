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

import { useState, useCallback, useEffect, useRef } from "react";
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
} from "lucide-react";
import { useTextSelection } from "@/hooks/use-text-selection";
import { AiInlineMenu } from "@/components/ai/ai-inline-menu";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import type { ViewMode, OutlineItem } from "./codemirror/live-preview/types";
import type { LivePreviewEditorRef } from "./codemirror/live-preview/live-preview-editor";
import { useContentCacheStore } from "@/stores/content-cache-store";
import { clearDecorationCache } from "./codemirror/live-preview/decoration-coordinator";
import { emitFileSave } from "@/lib/plugins/runtime";
import { navigateLink } from "@/lib/link-router/navigate-link";
import { useLinkNavigationStore } from "@/stores/link-navigation-store";
import { parseHeadings, buildOutlineTree } from "./codemirror/live-preview/markdown-parser";
import type { PaneId } from "@/types/layout";

// Lazy load components
const LivePreviewEditor = dynamic(
  () => import("./codemirror/live-preview/live-preview-editor").then((mod) => mod.LivePreviewEditor),
  { ssr: false }
);

const OutlinePanel = dynamic(
  () => import("./codemirror/live-preview/outline-panel").then((mod) => mod.OutlinePanel),
  { ssr: false }
);

type SaveStatus = "idle" | "saving" | "saved" | "error";

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
}: ObsidianMarkdownViewerProps) {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [localContent, setLocalContent] = useState(content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [showOutline, setShowOutline] = useState(false);
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
  const saveEditorState = useContentCacheStore((state) => state.saveEditorState);
  const getEditorState = useContentCacheStore((state) => state.getEditorState);
  const pendingNavigation = useLinkNavigationStore((state) => state.pendingByPane[paneId]);
  const consumePendingNavigation = useLinkNavigationStore((state) => state.consumePendingNavigation);

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
    if (pendingNavigation.target.type !== "workspace_heading") return;

    const headingOutline = outline.length > 0
      ? outline
      : buildOutlineTree(parseHeadings(localContent));
    const line = findHeadingLine(headingOutline, pendingNavigation.target.heading);
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

  return (
    <div ref={containerRef} className="h-full flex flex-col bg-background">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground truncate max-w-[200px]">
            {fileName}
          </span>
          {isDirty && (
            <span className="text-xs text-muted-foreground">•</span>
          )}
          <SaveIndicator status={saveStatus} />
        </div>
        
        <div className="flex items-center gap-1">
          {/* Outline toggle */}
          <button
            onClick={() => setShowOutline(!showOutline)}
            className={cn(
              "p-1.5 rounded transition-colors",
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
          
          <div className="w-px h-4 bg-border mx-1" />
          
          {/* Mode toggle buttons */}
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
          
          {/* Save button */}
          {onSave && (
            <button
              onClick={handleSave}
              disabled={saveStatus === "saving" || !isDirty}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors ml-2",
                "hover:bg-accent",
                (saveStatus === "saving" || !isDirty) && "opacity-50 cursor-not-allowed"
              )}
              title="Save (Ctrl+S)"
            >
              <Save className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Save</span>
            </button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Outline panel */}
        {showOutline && (
          <div className="w-56 border-r border-border overflow-auto bg-muted/20 flex-shrink-0">
            <OutlinePanel
              items={outline}
              onNavigate={handleOutlineNavigate}
              activeHeading={activeHeading}
            />
          </div>
        )}
        
        {/* Editor */}
        <div className="flex-1 overflow-auto">
          <LivePreviewEditor
            key={fileId || fileName}
            ref={editorRef}
            content={localContent}
            onChange={handleContentChange}
            mode={mode}
            onModeChange={handleModeChange}
            showLineNumbers={mode === 'source'}
            showFoldGutter={mode === 'live'}
            readOnly={mode === 'reading'}
            onOutlineChange={handleOutlineChange}
            onWikiLinkClick={handleLinkNavigate}
            onLinkNavigate={handleLinkNavigate}
            onSave={handleSave}
            fileId={fileId || fileName}
            className="min-h-full"
            rootHandle={rootHandle}
            filePath={filePath}
          />
        </div>
      </div>

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

    </div>
  );
}

export default ObsidianMarkdownViewer;

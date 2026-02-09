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
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";
import type { ViewMode, OutlineItem } from "./codemirror/live-preview/types";
import type { LivePreviewEditorRef } from "./codemirror/live-preview/live-preview-editor";
import { useContentCacheStore } from "@/stores/content-cache-store";

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

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
}

function stripExtension(value: string): string {
  return value.replace(/\.[^/.]+$/, "");
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
  /** Initial view mode */
  initialMode?: ViewMode;
  /** Unique file identifier for proper re-mounting */
  fileId?: string;
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
  initialMode = "live",
  fileId, // Unique file identifier
}: ObsidianMarkdownViewerProps) {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [localContent, setLocalContent] = useState(content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [showOutline, setShowOutline] = useState(true);
  const [activeHeading, setActiveHeading] = useState<number | undefined>();
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<LivePreviewEditorRef>(null);
  const prevFileIdRef = useRef(fileId);
  const saveEditorState = useContentCacheStore((state) => state.saveEditorState);
  const getEditorState = useContentCacheStore((state) => state.getEditorState);

  // CRITICAL: Force content update when file changes
  // Use fileId instead of fileName for more reliable detection
  useEffect(() => {
    const currentFileId = fileId || fileName; // Fallback to fileName if no fileId
    console.log('[FileSwitch] useEffect triggered - fileId:', currentFileId, 'prevFileId:', prevFileIdRef.current);
    console.log('[FileSwitch] fileName:', fileName);
    console.log('[FileSwitch] Content length:', content.length, 'LocalContent length:', localContent.length, 'isDirty:', isDirty);
    
    if (currentFileId !== prevFileIdRef.current) {
      const previousFileId = prevFileIdRef.current;
      if (previousFileId) {
        const editorState = editorRef.current?.getEditorState();
        if (editorState) {
          saveEditorState(previousFileId, editorState);
        }
      }

      // File changed - force update with loading state
      console.log('[FileSwitch] ===== FILE CHANGED =====');
      console.log('[FileSwitch] From:', prevFileIdRef.current, 'To:', currentFileId);
      console.log('[FileSwitch] New content length:', content.length);
      console.log('[FileSwitch] First 100 chars:', content.substring(0, 100));
      
      prevFileIdRef.current = currentFileId;
      setLocalContent(content);
      setIsDirty(false);
      setSaveStatus('idle'); // Reset save status on file switch
      setOutline([]); // Clear outline
      setActiveHeading(undefined); // Clear active heading

      const cachedState = getEditorState(currentFileId);
      if (cachedState) {
        editorRef.current?.restoreEditorState(cachedState);
      }
      
      console.log('[FileSwitch] State reset complete - all cleared');
    } else if (content !== localContent && !isDirty) {
      // Content changed externally (not by user editing)
      console.log('[ContentSync] External content update, length:', content.length);
      setLocalContent(content);
    }
  }, [content, fileName, fileId, localContent, isDirty, getEditorState, saveEditorState]);

  // Persist editor state on unmount
  useEffect(() => {
    const editorInstance = editorRef.current;
    return () => {
      const currentFileId = fileId || fileName;
      const editorState = editorInstance?.getEditorState();
      if (editorState) {
        saveEditorState(currentFileId, editorState);
      }
    };
  }, [fileId, fileName, saveEditorState]);

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
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch {
      setSaveStatus("error");
      setTimeout(() => setSaveStatus("idle"), 3000);
    }
  }, [onSave]);

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

  // Handle wiki link click
  const handleWikiLinkClick = useCallback((target: string) => {
    const decodedTarget = safeDecode(target);
    const [pathPart, headingPart] = decodedTarget.split('#');
    const heading = headingPart ?? (decodedTarget.startsWith('#') ? decodedTarget.slice(1) : undefined);

    if (heading) {
      const pathFileName = (pathPart || "").split('/').pop() || '';
      const sameFile =
        !pathPart ||
        pathFileName === fileName ||
        stripExtension(pathFileName) === stripExtension(fileName);

      if (sameFile) {
        const line = findHeadingLine(outline, heading);
        if (line) {
          setActiveHeading(line);
          editorRef.current?.scrollToLine(line);
          return;
        }
      }
    }

    onNavigateToFile?.(decodedTarget);
  }, [onNavigateToFile, fileName, outline]);

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
            ref={editorRef}
            content={localContent}
            onChange={handleContentChange}
            mode={mode}
            onModeChange={handleModeChange}
            showLineNumbers={mode === 'source'}
            showFoldGutter={mode === 'live'}
            readOnly={mode === 'reading'}
            onOutlineChange={handleOutlineChange}
            onWikiLinkClick={handleWikiLinkClick}
            onSave={handleSave}
            fileId={fileId || fileName}
            className="min-h-full"
          />
        </div>
      </div>

      {/* Mode hint */}
      {mode === "live" && (
        <div className="absolute bottom-4 right-4 text-xs text-muted-foreground bg-background/80 backdrop-blur px-2 py-1 rounded border border-border/50">
          Live Preview • <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Ctrl+E</kbd> cycle modes
        </div>
      )}
    </div>
  );
}

export default ObsidianMarkdownViewer;

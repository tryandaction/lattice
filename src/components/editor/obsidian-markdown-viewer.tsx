"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { Edit3, Eye, Save, Loader2, Check, AlertCircle, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import dynamic from "next/dynamic";

// Lazy load the heavy components
const AdvancedMarkdownEditor = dynamic(
  () => import("./advanced-markdown-editor").then((mod) => mod.AdvancedMarkdownEditor),
  { ssr: false }
);

const MarkdownRenderer = dynamic(
  () => import("@/components/renderers/markdown-renderer").then((mod) => mod.MarkdownRenderer),
  { ssr: false }
);

type ViewMode = "render" | "edit" | "split";
type SaveStatus = "idle" | "saving" | "saved" | "error";

interface ObsidianMarkdownViewerProps {
  content: string;
  onChange: (content: string) => void;
  fileName: string;
  onSave?: () => Promise<void>;
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
 * ObsidianMarkdownViewer - Obsidian-like Markdown editing experience
 * 
 * Features:
 * - Default render mode (like Obsidian's reading view)
 * - Click anywhere to switch to edit mode
 * - Toggle between render/edit/split views
 * - Auto-save support
 * - Keyboard shortcuts (Ctrl+E to toggle edit, Ctrl+S to save)
 */
export function ObsidianMarkdownViewer({
  content,
  onChange,
  fileName,
  onSave,
}: ObsidianMarkdownViewerProps) {
  const [mode, setMode] = useState<ViewMode>("render");
  const [localContent, setLocalContent] = useState(content);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef(content);

  // Sync with external content changes
  useEffect(() => {
    if (content !== contentRef.current) {
      contentRef.current = content;
      setLocalContent(content);
      setIsDirty(false);
    }
  }, [content]);

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

  // Toggle between render and edit modes
  const toggleMode = useCallback(() => {
    setMode(prev => prev === "render" ? "edit" : "render");
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+E: Toggle edit mode
      if ((e.ctrlKey || e.metaKey) && e.key === "e") {
        e.preventDefault();
        toggleMode();
        return;
      }
      
      // Ctrl+S: Save
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [toggleMode, handleSave]);

  // Click to edit in render mode
  const handleRenderClick = useCallback(() => {
    setMode("edit");
  }, []);

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
          {/* Mode toggle buttons */}
          <div className="flex items-center rounded-md border border-border bg-muted/30 p-0.5">
            <button
              onClick={() => setMode("render")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                mode === "render" 
                  ? "bg-background text-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Reading view (Ctrl+E)"
            >
              <Eye className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Read</span>
            </button>
            <button
              onClick={() => setMode("edit")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                mode === "edit" 
                  ? "bg-background text-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Edit view (Ctrl+E)"
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Edit</span>
            </button>
            <button
              onClick={() => setMode("split")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
                mode === "split" 
                  ? "bg-background text-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="Split view"
            >
              <Maximize2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Split</span>
            </button>
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
      <div className="flex-1 overflow-hidden">
        {mode === "render" && (
          <div 
            className="h-full overflow-auto cursor-text"
            onClick={handleRenderClick}
            title="Click to edit"
          >
            <div className="mx-auto max-w-4xl p-6">
              <MarkdownRenderer content={localContent} fileName={fileName} />
            </div>
          </div>
        )}

        {mode === "edit" && (
          <div className="h-full">
            <AdvancedMarkdownEditor
              content={localContent}
              onChange={handleContentChange}
              fileName={fileName}
              onSave={onSave}
              useMathLive={true}
            />
          </div>
        )}

        {mode === "split" && (
          <div className="h-full flex">
            {/* Editor side */}
            <div className="flex-1 border-r border-border overflow-hidden">
              <AdvancedMarkdownEditor
                content={localContent}
                onChange={handleContentChange}
                fileName={fileName}
                onSave={onSave}
                useMathLive={true}
              />
            </div>
            {/* Preview side */}
            <div className="flex-1 overflow-auto">
              <div className="mx-auto max-w-4xl p-6">
                <MarkdownRenderer content={localContent} fileName={fileName} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Hint for render mode */}
      {mode === "render" && (
        <div className="absolute bottom-4 right-4 text-xs text-muted-foreground bg-background/80 backdrop-blur px-2 py-1 rounded border border-border/50">
          Click to edit • <kbd className="px-1 py-0.5 rounded bg-muted text-[10px]">Ctrl+E</kbd> toggle
        </div>
      )}
    </div>
  );
}

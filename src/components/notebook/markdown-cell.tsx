"use client";

import { useEffect, useRef, useState } from "react";
import { Code2, Eye } from "lucide-react";
import { LivePreviewEditor, type LivePreviewEditorRef } from "@/components/editor/codemirror/live-preview/live-preview-editor";
import type { ViewMode } from "@/components/editor/codemirror/live-preview/types";
import { cn } from "@/lib/utils";

interface MarkdownCellProps {
  source: string;
  isActive: boolean;
  onChange: (source: string) => void;
  onFocus: () => void;
  onLinkNavigate?: (target: string) => void;
  rootHandle?: FileSystemDirectoryHandle | null;
  filePath?: string;
  cellId?: string;
}

function ModeButton({
  mode,
  currentMode,
  onClick,
  icon: Icon,
  label,
}: {
  mode: ViewMode;
  currentMode: ViewMode;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
}) {
  const isActive = mode === currentMode;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-[11px] transition-colors",
        isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
    </button>
  );
}

export function MarkdownCell({
  source,
  isActive,
  onChange,
  onFocus,
  onLinkNavigate,
  rootHandle = null,
  filePath,
  cellId,
}: MarkdownCellProps) {
  const [mode, setMode] = useState<ViewMode>("live");
  const editorRef = useRef<LivePreviewEditorRef>(null);

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const timer = window.setTimeout(() => {
      editorRef.current?.focus();
    }, 30);

    return () => window.clearTimeout(timer);
  }, [isActive]);

  const effectiveMode: ViewMode = isActive ? mode : "reading";

  return (
    <div
      className={cn(
        "rounded-lg border bg-background transition-colors",
        isActive ? "border-primary shadow-sm" : "border-border hover:border-primary/40",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onFocus();
      }}
    >
      {isActive && (
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-2 py-1.5">
          <span className="text-[11px] text-muted-foreground">Markdown Cell</span>
          <div className="inline-flex items-center gap-1 rounded-md bg-muted p-1">
            <ModeButton mode="live" currentMode={mode} onClick={() => setMode("live")} icon={Eye} label="Live" />
            <ModeButton mode="source" currentMode={mode} onClick={() => setMode("source")} icon={Code2} label="Source" />
          </div>
        </div>
      )}

      <div className="px-3 py-2">
        <LivePreviewEditor
          ref={editorRef}
          content={source}
          onChange={onChange}
          mode={effectiveMode}
          showLineNumbers={effectiveMode === "source"}
          showFoldGutter={effectiveMode === "live"}
          readOnly={!isActive || effectiveMode === "reading"}
          autoHeight={true}
          className="min-h-[6rem]"
          fileId={cellId ? `${filePath ?? "notebook"}#${cellId}` : filePath}
          rootHandle={rootHandle}
          filePath={filePath}
          onLinkNavigate={onLinkNavigate}
        />
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { FileCode2 } from "lucide-react";
import { CodeEditor, type CodeEditorRef } from "@/components/editor/codemirror/code-editor";
import { cn } from "@/lib/utils";

interface RawCellProps {
  source: string;
  isActive: boolean;
  onChange: (source: string) => void;
  onFocus: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  cellId: string;
  notebookFilePath?: string;
}

export function RawCell({
  source,
  isActive,
  onChange,
  onFocus,
  onNavigateUp,
  onNavigateDown,
  cellId,
  notebookFilePath,
}: RawCellProps) {
  const [content, setContent] = useState(source);
  const editorRef = useRef<CodeEditorRef | null>(null);

  useEffect(() => {
    setContent(source);
  }, [source]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <FileCode2 className="h-3.5 w-3.5" />
        <span>Raw Cell</span>
      </div>

      <div
        className={cn(
          "overflow-hidden rounded-lg border-2 transition-colors",
          isActive ? "border-primary" : "border-border",
        )}
        onClick={onFocus}
      >
        <CodeEditor
          initialValue={content}
          language="markdown"
          onChange={(newContent) => {
            setContent(newContent);
            onChange(newContent);
          }}
          isReadOnly={!isActive}
          autoHeight={true}
          onNavigateUp={onNavigateUp}
          onNavigateDown={onNavigateDown}
          fileId={`${notebookFilePath ?? "notebook"}#${cellId}:raw`}
          editorRef={editorRef}
          basicCompletion={false}
          syntaxDiagnostics={false}
        />
      </div>
    </div>
  );
}

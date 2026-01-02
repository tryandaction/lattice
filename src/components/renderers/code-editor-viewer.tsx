"use client";

/**
 * CodeEditorViewer Component
 * 
 * A wrapper component that integrates CodeEditor into the file viewer system.
 * Handles file extension to language mapping and debounced save logic.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6
 */

import { useCallback, useMemo, useRef, useEffect } from "react";
import { CodeEditor, CodeEditorLanguage } from "@/components/editor/codemirror/code-editor";
import { getCodeEditorLanguage, getFileExtension } from "@/lib/file-utils";

interface CodeEditorViewerProps {
  /** File content as string */
  content: string;
  /** File name for language detection */
  fileName: string;
  /** Callback when content changes */
  onContentChange?: (content: string) => void;
  /** Callback to save the file */
  onSave?: () => Promise<void>;
  /** Whether the file is read-only */
  isReadOnly?: boolean;
}

/** Debounce delay in milliseconds */
const DEBOUNCE_DELAY = 500;

/**
 * CodeEditorViewer Component
 * 
 * Renders a CodeEditor for editable code files with:
 * - Automatic language detection from file extension
 * - Debounced save on content change
 * - Full-height scrollable editing
 */
export function CodeEditorViewer({
  content,
  fileName,
  onContentChange,
  onSave,
  isReadOnly = false,
}: CodeEditorViewerProps) {
  const extension = getFileExtension(fileName);
  const language = useMemo<CodeEditorLanguage>(
    () => getCodeEditorLanguage(extension),
    [extension]
  );
  
  // Debounce timer ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track if content has changed for save
  const hasChangedRef = useRef(false);
  
  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);
  
  /**
   * Handle content changes with debounced save
   * Requirements: 4.5
   */
  const handleChange = useCallback((newContent: string) => {
    // Notify parent of content change immediately
    onContentChange?.(newContent);
    hasChangedRef.current = true;
    
    // Clear existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    // Set new debounce timer for save
    if (onSave) {
      debounceTimerRef.current = setTimeout(() => {
        if (hasChangedRef.current) {
          onSave().catch((err) => {
            console.error("Failed to save file:", err);
          });
          hasChangedRef.current = false;
        }
      }, DEBOUNCE_DELAY);
    }
  }, [onContentChange, onSave]);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* File header */}
      <div className="sticky top-0 z-10 border-b border-border bg-muted/90 px-4 py-2 backdrop-blur flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-foreground">{fileName}</span>
          <span className="ml-2 text-xs text-muted-foreground">({language})</span>
        </div>
        {isReadOnly && (
          <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
            Read-only
          </span>
        )}
      </div>

      {/* Code editor - fills remaining height */}
      <div className="flex-1 overflow-hidden">
        <CodeEditor
          initialValue={content}
          language={language}
          onChange={handleChange}
          isReadOnly={isReadOnly || !onContentChange}
          autoHeight={false}
          fileId={fileName}
          className="h-full"
        />
      </div>
    </div>
  );
}

export default CodeEditorViewer;

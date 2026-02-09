"use client";

/**
 * CodeEditorViewer Component
 * 
 * A wrapper component that integrates CodeEditor into the file viewer system.
 * Handles file extension to language mapping and debounced save logic.
 * Supports Python file execution via Pyodide.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.6
 */

import { useCallback, useMemo, useRef, useEffect, useState } from "react";
import { Play, Loader2, Trash2, ChevronDown, ChevronUp, PlayCircle } from "lucide-react";
import { CodeEditor, CodeEditorLanguage, CodeEditorRef } from "@/components/editor/codemirror/code-editor";
import { getCodeEditorLanguage, getFileExtension } from "@/lib/file-utils";
import { useAnnotationNavigation } from "../../hooks/use-annotation-navigation";
import { usePythonRunner } from "@/hooks/use-python-runner";
import { OutputArea } from "@/components/notebook/output-area";
import { KernelStatus } from "@/components/notebook/kernel-status";

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
 * - Python file execution support
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
  
  // Check if this is a Python file
  const isPythonFile = language === "python";
  
  // Python runner hook
  const {
    status: kernelStatus,
    outputs,
    error: kernelError,
    runCode,
    clearOutputs,
    isRunning,
    isLoading,
  } = usePythonRunner();
  
  // Output panel visibility
  const [showOutput, setShowOutput] = useState(false);
  
  // Track current content for execution
  const currentContentRef = useRef(content);
  
  // Editor ref for accessing selection
  const editorRef = useRef<CodeEditorRef | null>(null);
  
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  
  // Debounce timer ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Track if content has changed for save
  const hasChangedRef = useRef(false);
  
  // Highlighted line state for annotation navigation
  const [, setHighlightedLine] = useState<number | null>(null);
  
  // Universal annotation navigation support
  useAnnotationNavigation({
    handlers: {
      onCodeLineNavigate: (line, _annotationId) => {
        // Highlight the line
        setHighlightedLine(line);
        
        // Clear highlight after 3 seconds
        setTimeout(() => setHighlightedLine(null), 3000);
      },
    },
  });
  
  // Update content ref when content changes
  useEffect(() => {
    currentContentRef.current = content;
  }, [content]);
  
  // Show output panel when there are outputs
  useEffect(() => {
    if (outputs.length > 0) {
      setShowOutput(true);
    }
  }, [outputs]);
  
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
    // Update content ref
    currentContentRef.current = newContent;
    
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
  
  /**
   * Run the Python file
   */
  const handleRun = useCallback(async () => {
    const code = currentContentRef.current.trim();
    if (!code) return;
    
    clearOutputs();
    setShowOutput(true);
    await runCode(code);
  }, [runCode, clearOutputs]);
  
  /**
   * Run selected code only
   */
  const handleRunSelection = useCallback(async () => {
    const selection = editorRef.current?.getSelection();
    if (!selection?.trim()) return;
    
    clearOutputs();
    setShowOutput(true);
    await runCode(selection);
    setContextMenu(null);
  }, [runCode, clearOutputs]);
  
  /**
   * Handle context menu (right-click)
   */
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!isPythonFile) return;
    
    // Only show context menu if there's a selection
    if (editorRef.current?.hasSelection()) {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY });
    }
  }, [isPythonFile]);
  
  // Close context menu on click outside
  useEffect(() => {
    if (contextMenu) {
      const handleClick = () => setContextMenu(null);
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);
  
  /**
   * Handle keyboard shortcut for running code
   */
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Shift+Enter to run Python code
    if (isPythonFile && e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
  }, [isPythonFile, handleRun]);

  return (
    <div className="h-full flex flex-col overflow-hidden" onKeyDown={handleKeyDown}>
      {/* Context menu for running selection */}
      {contextMenu && isPythonFile && (
        <div
          className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleRunSelection}
            disabled={isRunning || isLoading}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left
                       hover:bg-accent hover:text-accent-foreground
                       disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlayCircle className="w-4 h-4" />
            <span>Run Selection</span>
          </button>
        </div>
      )}
      
      {/* File header */}
      <div className="sticky top-0 z-10 border-b border-border bg-muted/90 px-4 py-2 backdrop-blur flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-foreground">{fileName}</span>
          <span className="ml-2 text-xs text-muted-foreground">({language})</span>
        </div>
        
        <div className="flex items-center gap-2">
          {/* Python Run button */}
          {isPythonFile && (
            <button
              onClick={handleRun}
              disabled={isRunning || isLoading}
              className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md
                         bg-primary/10 hover:bg-primary/20 text-primary
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors"
              title="Run file (Shift+Enter)"
            >
              {isRunning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              <span>Run</span>
            </button>
          )}
          
          {isReadOnly && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
              Read-only
            </span>
          )}
        </div>
      </div>

      {/* Code editor - fills remaining height (minus output panel) */}
      <div 
        className={`flex-1 overflow-hidden ${showOutput && isPythonFile ? 'h-1/2' : ''}`}
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
      
      {/* Python output panel */}
      {isPythonFile && (
        <div className={`border-t border-border bg-background ${showOutput ? 'h-1/2' : ''}`}>
          {/* Output panel header */}
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
              <span>Output</span>
              {outputs.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-primary/10 text-primary rounded text-[10px]">
                  {outputs.length}
                </span>
              )}
            </button>
            
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
          
          {/* Output content */}
          {showOutput && (
            <div className="h-[calc(100%-32px)] overflow-auto p-3">
              <KernelStatus status={kernelStatus} error={kernelError} />
              <OutputArea outputs={outputs} />
              {outputs.length === 0 && kernelStatus !== 'loading' && kernelStatus !== 'running' && (
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

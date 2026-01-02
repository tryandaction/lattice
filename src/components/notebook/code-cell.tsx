"use client";

/**
 * Code Cell Component
 * 
 * Renders a Jupyter notebook code cell with:
 * - View mode: Syntax highlighted code (default)
 * - Edit mode: CodeEditor (activated by double-click)
 * - Run button: Execute Python code via Pyodide
 * - Output area: Display execution results
 * 
 * Uses the unified CodeEditor component and on-demand Python kernel.
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 10.1-10.7
 */

import { useEffect, useRef, useState, memo, useCallback } from "react";
import { CodeEditor } from "@/components/editor/codemirror/code-editor";
import { highlightCode } from "@/lib/code-highlighter";
import type { JupyterOutput } from "@/lib/notebook-utils";
import { AnsiText } from "./ansi-text";
import { usePythonRunner } from "@/hooks/use-python-runner";
import { OutputArea } from "./output-area";
import { KernelStatus } from "./kernel-status";

interface CodeCellProps {
  source: string;
  outputs?: JupyterOutput[];
  executionCount?: number | null;
  isActive: boolean;
  onChange: (source: string) => void;
  onFocus: () => void;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
}

/**
 * Normalize text output to string
 */
function normalizeText(text: string | string[] | undefined): string {
  if (!text) return "";
  return Array.isArray(text) ? text.join("") : text;
}

/**
 * Render a single cell output (for notebook file outputs)
 */
function CellOutput({ output }: { output: JupyterOutput }) {
  if (output.output_type === "stream") {
    const text = normalizeText(output.text);
    return (
      <div className="rounded bg-muted p-3">
        <AnsiText text={text} />
      </div>
    );
  }

  if (output.output_type === "execute_result" || output.output_type === "display_data") {
    const data = output.data;
    if (!data) return null;

    // Image output
    if (data["image/png"]) {
      return (
        <img
          src={`data:image/png;base64,${data["image/png"]}`}
          alt="Output"
          className="max-w-full rounded"
        />
      );
    }
    if (data["image/jpeg"]) {
      return (
        <img
          src={`data:image/jpeg;base64,${data["image/jpeg"]}`}
          alt="Output"
          className="max-w-full rounded"
        />
      );
    }

    // Text output
    if (data["text/plain"]) {
      const text = normalizeText(data["text/plain"]);
      return (
        <div className="rounded bg-muted p-3">
          <AnsiText text={text} />
        </div>
      );
    }
  }

  if (output.output_type === "error") {
    const errorText = [
      `${output.ename}: ${output.evalue}`,
      ...(output.traceback || []),
    ].join("\n");
    
    return (
      <div className="rounded bg-destructive/10 p-3">
        <AnsiText text={errorText} className="text-destructive" />
      </div>
    );
  }

  return null;
}

/**
 * Rendered code view (read-only, syntax highlighted)
 */
function RenderedCode({ source }: { source: string }) {
  return (
    <pre className="rounded-lg bg-muted p-4 overflow-x-auto text-sm font-mono">
      <code dangerouslySetInnerHTML={{ __html: highlightCode(source, "python") }} />
    </pre>
  );
}

/**
 * Play icon for Run button
 */
function PlayIcon({ className = "" }: { className?: string }) {
  return (
    <svg 
      className={className}
      width="16" 
      height="16" 
      viewBox="0 0 24 24" 
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/**
 * Code Cell Component
 * 
 * Renders a code cell with editing, execution, and output display.
 */
export const CodeCell = memo(function CodeCell({
  source,
  outputs,
  executionCount,
  onChange,
  onFocus,
  onNavigateUp,
  onNavigateDown,
}: CodeCellProps) {
  const [isEditing, setIsEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Python runner hook for code execution
  const { 
    status, 
    outputs: executionOutputs, 
    runCode, 
    clearOutputs,
    isRunning,
    isLoading 
  } = usePythonRunner();
  
  // Store content in ref to preserve state across mode switches
  const contentRef = useRef(source);
  
  // Track if we're currently editing to ignore external source updates
  const isEditingRef = useRef(false);
  
  // Always sync contentRef with source when not editing
  // This ensures we have the latest source when entering edit mode
  useEffect(() => {
    if (!isEditingRef.current) {
      contentRef.current = source;
    }
  }, [source]);

  // Handle double-click to enter edit mode
  const handleDoubleClick = useCallback(() => {
    isEditingRef.current = true;
    setIsEditing(true);
    onFocus();
  }, [onFocus]);
  
  // Handle exiting edit mode
  const exitEditMode = useCallback(() => {
    isEditingRef.current = false;
    setIsEditing(false);
  }, []);

  // Handle content changes - update ref and notify parent
  const handleChange = useCallback((newContent: string) => {
    contentRef.current = newContent;
    onChange(newContent);
  }, [onChange]);

  // Handle Run button click
  const handleRun = useCallback(async () => {
    const code = contentRef.current.trim();
    if (!code) return;
    
    clearOutputs();
    await runCode(code);
  }, [runCode, clearOutputs]);

  // Handle Shift+Enter to run code
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.shiftKey && e.key === 'Enter') {
      e.preventDefault();
      handleRun();
    }
  }, [handleRun]);

  // Handle click outside to exit edit mode
  useEffect(() => {
    if (!isEditing) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        exitEditMode();
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isEditing, exitEditMode]);

  // Determine if we should show execution outputs or file outputs
  const hasExecutionOutputs = executionOutputs.length > 0;
  const hasFileOutputs = outputs && outputs.length > 0;

  return (
    <div ref={containerRef} className="space-y-2" onKeyDown={handleKeyDown}>
      {/* Toolbar with execution count and Run button */}
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground font-mono">
          [{executionCount ?? " "}]:
        </div>
        
        {/* Run button */}
        <button
          onClick={handleRun}
          disabled={isRunning || isLoading}
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md
                     bg-primary/10 hover:bg-primary/20 text-primary
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-colors"
          title="Run cell (Shift+Enter)"
        >
          <PlayIcon className="w-3 h-3" />
          <span>Run</span>
        </button>
      </div>
      
      {/* Code editor/viewer */}
      <div>
        {isEditing ? (
          <div className="rounded-lg overflow-hidden border-2 border-primary">
            <CodeEditor
              initialValue={contentRef.current}
              language="python"
              onChange={handleChange}
              autoHeight={true}
              onEscape={exitEditMode}
              onNavigateUp={onNavigateUp}
              onNavigateDown={onNavigateDown}
            />
          </div>
        ) : (
          <div
            onDoubleClick={handleDoubleClick}
            onClick={onFocus}
            className="cursor-pointer rounded-lg border border-border hover:border-primary/50 transition-colors"
          >
            <RenderedCode source={contentRef.current} />
          </div>
        )}
      </div>

      {/* Kernel status indicator (loading/running) */}
      <KernelStatus status={status} />

      {/* Execution outputs (from Python runner) */}
      {hasExecutionOutputs && (
        <OutputArea outputs={executionOutputs} />
      )}

      {/* File outputs (from notebook file) - show only if no execution outputs */}
      {!hasExecutionOutputs && hasFileOutputs && (
        <div className="space-y-2">
          {outputs!.map((output, i) => (
            <CellOutput key={i} output={output} />
          ))}
        </div>
      )}
    </div>
  );
});

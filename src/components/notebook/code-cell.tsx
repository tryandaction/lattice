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
import { OutputArea, HtmlOutput } from "./output-area";
import { KernelStatus } from "./kernel-status";
import { NotebookAiAssist } from "@/components/ai/notebook-ai-assist";

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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/png;base64,${data["image/png"]}`}
          alt="Output"
          className="max-w-full rounded"
        />
      );
    }
    if (data["image/jpeg"]) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`data:image/jpeg;base64,${data["image/jpeg"]}`}
          alt="Output"
          className="max-w-full rounded"
        />
      );
    }
    if (data["image/svg+xml"]) {
      const svg = normalizeText(data["image/svg+xml"] as string | string[]);
      return (
        <div
          className="rounded bg-white dark:bg-gray-900 p-2 max-w-full overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      );
    }
    if (data["text/html"]) {
      const html = normalizeText(data["text/html"] as string | string[]);
      return <HtmlOutput content={html} />;
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
  const [content, setContent] = useState(source);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Python runner hook for code execution
  const { 
    status, 
    outputs: executionOutputs, 
    error: kernelError,
    runCode, 
    clearOutputs,
    isRunning,
    isLoading 
  } = usePythonRunner();
  
  // Sync content when external source updates (skip while editing)
  useEffect(() => {
    if (isEditing) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setContent(source);
  }, [source, isEditing]);

  // Handle double-click to enter edit mode
  const handleDoubleClick = useCallback(() => {
    setContent(source);
    setIsEditing(true);
    onFocus();
  }, [onFocus, source]);
  
  // Handle exiting edit mode
  const exitEditMode = useCallback(() => {
    setIsEditing(false);
  }, []);

  // Handle content changes - update ref and notify parent
  const handleChange = useCallback((newContent: string) => {
    setContent(newContent);
    onChange(newContent);
  }, [onChange]);

  // Handle Run button click
  const handleRun = useCallback(async () => {
    const code = content.trim();
    if (!code) return;
    
    clearOutputs();
    await runCode(code);
  }, [runCode, clearOutputs, content]);

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
              initialValue={content}
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
            <RenderedCode source={content} />
          </div>
        )}
      </div>

      {/* Kernel status indicator (loading/running/error) */}
      <KernelStatus status={status} error={kernelError} />

      {/* Execution outputs (from Python runner) */}
      {hasExecutionOutputs && (
        <OutputArea outputs={executionOutputs} onClear={clearOutputs} />
      )}

      {/* File outputs (from notebook file) - show only if no execution outputs */}
      {!hasExecutionOutputs && hasFileOutputs && (
        <div className="space-y-2">
          {outputs!.map((output, i) => (
            <CellOutput key={i} output={output} />
          ))}
        </div>
      )}

      {/* AI Assist */}
      <NotebookAiAssist
        cellSource={content}
        cellOutput={
          hasExecutionOutputs
            ? executionOutputs.map(o => typeof o === 'string' ? o : JSON.stringify(o)).join("\n")
            : hasFileOutputs
              ? outputs!.filter(o => o.output_type !== 'error').map(o => normalizeText(o.text) || normalizeText(o.data?.["text/plain"])).join("\n")
              : undefined
        }
        cellError={
          kernelError
            ?? outputs?.find(o => o.output_type === 'error')?.evalue
            ?? undefined
        }
        onInsertCode={(code) => {
          setContent(code);
          onChange(code);
        }}
      />
    </div>
  );
});

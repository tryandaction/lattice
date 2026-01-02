"use client";

/**
 * Code Cell Component
 * 
 * Renders a Jupyter notebook code cell with two modes:
 * - View mode: Syntax highlighted code (default)
 * - Edit mode: CodeEditor (activated by double-click)
 * 
 * Uses the unified CodeEditor component for consistent editing experience.
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { useEffect, useRef, useState, memo, useCallback } from "react";
import { CodeEditor } from "@/components/editor/codemirror/code-editor";
import { highlightCode } from "@/lib/code-highlighter";
import type { JupyterOutput } from "@/lib/notebook-utils";
import { AnsiText } from "./ansi-text";

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
 * Render a single cell output
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
    // Error output often contains ANSI codes for colored tracebacks
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
 * Code Cell Component
 * 
 * Renders a code cell with two modes:
 * - View mode: Syntax highlighted code (default)
 * - Edit mode: CodeEditor (activated by double-click)
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
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
  
  // Store content in ref to preserve state across mode switches (Requirement 5.6)
  const contentRef = useRef(source);
  
  // Track if we're currently editing to ignore external source updates
  const isEditingRef = useRef(false);
  
  // Update content ref when source changes (only when not editing)
  if (!isEditingRef.current) {
    contentRef.current = source;
  }

  // Handle double-click to enter edit mode
  const handleDoubleClick = useCallback(() => {
    isEditingRef.current = true;
    setIsEditing(true);
    onFocus();
  }, [onFocus]);
  
  // Handle exiting edit mode (Requirement 5.3)
  const exitEditMode = useCallback(() => {
    isEditingRef.current = false;
    setIsEditing(false);
  }, []);

  // Handle content changes - update ref and notify parent
  const handleChange = useCallback((newContent: string) => {
    contentRef.current = newContent;
    onChange(newContent);
  }, [onChange]);

  // Handle click outside to exit edit mode
  useEffect(() => {
    if (!isEditing) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        exitEditMode();
      }
    };

    // Delay adding listener to avoid immediate trigger
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isEditing, exitEditMode]);

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Execution count label */}
      <div className="text-xs text-muted-foreground font-mono">
        [{executionCount ?? " "}]:
      </div>
      
      {/* Code editor/viewer */}
      <div>
        {isEditing ? (
          <div className="rounded-lg overflow-hidden border-2 border-primary">
            {/* 
              CodeEditor with auto-height mode for cells (Requirement 5.2)
              Navigation callbacks for cell navigation (Requirements 5.3, 5.4, 5.5)
            */}
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

      {/* Outputs */}
      {outputs && outputs.length > 0 && (
        <div className="space-y-2">
          {outputs.map((output, i) => (
            <CellOutput key={i} output={output} />
          ))}
        </div>
      )}
    </div>
  );
});
